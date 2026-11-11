import * as vscode from "vscode";
import { createCsvCellLookup, renderCsvCellMarkdown } from "../lib/csv";
import { csvCellRefAt, resolveScriptRelative } from "../lib/fileRefs";

/**
 * Hover for a `<file>.csv line:<N> col:<M>` reference: the cell's value with
 * its column / row context, or what is missing. Separate from the component
 * hover (providers/hover.ts) — VS Code merges the two.
 */
export function registerEsiCsvHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider("esi", {
    provideHover(document, position) {
      if (document.uri.scheme !== "file") {
        return undefined;
      }
      const ref = csvCellRefAt(document.lineAt(position.line).text, position.character);
      if (!ref || ref.csvLine === undefined || ref.csvCol === undefined) {
        return undefined;
      }
      const scriptPath = document.uri.fsPath;
      // Fresh lookup per request so an edited CSV is re-read.
      const result = createCsvCellLookup(scriptPath)(ref.path, ref.csvLine, ref.csvCol);
      const markdown = renderCsvCellMarkdown(
        { file: ref.path, line: ref.csvLine, col: ref.csvCol },
        result,
        resolveScriptRelative(scriptPath, ref.path)
      );
      return new vscode.Hover(
        new vscode.MarkdownString(markdown),
        new vscode.Range(
          position.line,
          ref.startCol,
          position.line,
          ref.refEndCol ?? ref.endCol
        )
      );
    },
  });
}
