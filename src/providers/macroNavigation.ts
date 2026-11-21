import * as vscode from "vscode";
import {
  MacroOccurrence,
  buildMacroModel,
  computeMacroRename,
  findMacroDefinitions,
  findMacroOccurrences,
  macroAt,
  prepareMacroRename,
} from "../lib/macros";
import { createMacroResolver } from "./macroResolver";

/**
 * Go to Definition, Find All References, Rename and occurrence highlighting
 * for `%MACRO%` variables (their quick fixes are in codeActions.ts).
 * All logic is in lib/macros.ts; the language's wordPattern excludes `%`, so
 * the macro under the cursor is always found through `macroAt`, never through
 * `getWordRangeAtPosition`.
 */
export function registerEsiMacroProviders(): vscode.Disposable {
  const tokenRange = (o: MacroOccurrence): vscode.Range =>
    new vscode.Range(o.line, o.startCol, o.line, o.endCol);

  const definition = vscode.languages.registerDefinitionProvider("esi", {
    provideDefinition(document, position) {
      const text = document.getText();
      const at = macroAt(text, position.line, position.character);
      if (!at) {
        return undefined;
      }
      const model = buildMacroModel(text, createMacroResolver(document));
      return findMacroDefinitions(model, at.name).map(
        (d) =>
          new vscode.Location(
            d.file === undefined ? document.uri : vscode.Uri.file(d.file),
            new vscode.Range(d.line, d.startCol, d.line, d.endCol)
          )
      );
    },
  });

  const references = vscode.languages.registerReferenceProvider("esi", {
    provideReferences(document, position, context) {
      const text = document.getText();
      const at = macroAt(text, position.line, position.character);
      if (!at) {
        return undefined;
      }
      const model = buildMacroModel(text, createMacroResolver(document));
      const keep = (o: MacroOccurrence): boolean =>
        context.includeDeclaration || o.role !== "definition";
      const out = findMacroOccurrences(model.local, at.name)
        .filter(keep)
        .map((o) => new vscode.Location(document.uri, tokenRange(o)));
      for (const inc of model.included) {
        const uri = vscode.Uri.file(inc.key);
        for (const o of findMacroOccurrences(inc.scan, at.name).filter(keep)) {
          out.push(new vscode.Location(uri, tokenRange(o)));
        }
      }
      return out;
    },
  });

  const rename = vscode.languages.registerRenameProvider("esi", {
    prepareRename(document, position) {
      const target = prepareMacroRename(
        document.getText(),
        position.line,
        position.character,
        createMacroResolver(document)
      );
      if (!target.ok) {
        // A rejected promise is how VS Code shows the reason to the user.
        return Promise.reject(new Error(target.reason));
      }
      return {
        range: new vscode.Range(
          target.line,
          target.startCol,
          target.line,
          target.endCol
        ),
        placeholder: target.name,
      };
    },
    provideRenameEdits(document, position, newName) {
      const result = computeMacroRename(
        document.getText(),
        position.line,
        position.character,
        newName,
        createMacroResolver(document)
      );
      if (!result.ok) {
        return Promise.reject(new Error(result.reason));
      }
      const edit = new vscode.WorkspaceEdit();
      for (const e of result.edits) {
        edit.replace(
          document.uri,
          new vscode.Range(e.line, e.startCol, e.endLine, e.endCol),
          e.newText
        );
      }
      return edit;
    },
  });

  const highlights = vscode.languages.registerDocumentHighlightProvider("esi", {
    provideDocumentHighlights(document, position) {
      const text = document.getText();
      const at = macroAt(text, position.line, position.character);
      if (!at) {
        return undefined;
      }
      // Local occurrences only — no include is read on a cursor move.
      const model = buildMacroModel(text);
      return findMacroOccurrences(model.local, at.name).map(
        (o) =>
          new vscode.DocumentHighlight(
            tokenRange(o),
            o.role === "definition"
              ? vscode.DocumentHighlightKind.Write
              : vscode.DocumentHighlightKind.Read
          )
      );
    },
  });

  return vscode.Disposable.from(
    definition,
    references,
    rename,
    highlights
  );
}
