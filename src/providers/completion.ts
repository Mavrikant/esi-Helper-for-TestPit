import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";
import { computeTagCompletions } from "../lib/tagCompletion";
import {
  computeFieldNameCompletions,
  skeletonKeys,
} from "../lib/fieldCompletion";
import {
  csvFileEntries,
  csvTailEntry,
  csvValueContext,
  CsvValueEntry,
  listCsvFiles,
} from "../lib/csvValueCompletion";
import { PARAMETER_FIELDS } from "../lib/componentValidator";
import { resolveScriptRelative } from "../lib/fileRefs";
import { FieldDef } from "../lib/xmlIndex";
import {
  computeMacroCompletions,
  describeMacroDefinitions,
} from "../lib/macros";
import { createMacroResolver, macroFileLabel } from "./macroResolver";

// The only two values `match` accepts (TestPit checkMatchValue). Offered
// directly — `match` is a TestPit parameter, not an XML-indexed field, so
// there is no enum table to draw them from.
const MATCH_VALUE_HINTS: ReadonlyArray<[string, string]> = [
  ["next", "the default: the next record no other block has taken"],
  ["any", "any record of the window may answer this block"],
];

export function registerEsiCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    "esi",
    {
      provideCompletionItems(document, position, _token, context) {
        const index = getActiveProjectIndex();
        const ctx = resolveContext(
          document.getText(),
          position.line,
          position.character
        );
        // `/` is a trigger only so that `[/` offers the closing tags; a slash
        // typed anywhere else (a path, `<br/>`) must not pop a list open.
        if (context.triggerCharacter === "/" && ctx.kind !== "closeTagName") {
          return [];
        }

        switch (ctx.kind) {
          case "tagName":
          case "closeTagName": {
            // What to offer, the replace range and the inserted text are all
            // decided in lib/tagCompletion.ts; this only builds the items.
            // Structural section names and closing tags need no index.
            const tags = computeTagCompletions(
              document.getText(),
              position.line,
              position.character,
              ctx.partial,
              ctx.kind === "closeTagName",
              index ? index.connections.keys() : [],
              {
                // The "with fields" variant of a component block: `time` plus
                // the message's non-reserved fields (lib/fieldCompletion.ts).
                skeletonKeys: (name) =>
                  skeletonKeys(index?.resolveConnectionMessage(name)),
              }
            );
            if (!tags) {
              return [];
            }
            // The range is set explicitly: it starts at the typed partial
            // (VS Code's word-at-cursor heuristic mis-detects digit-leading
            // identifiers such as 1553_…/429_… and the list goes empty) and,
            // on a tag line, runs through the auto-closed `]`.
            const replaceRange = new vscode.Range(
              position.line,
              tags.startCol,
              position.line,
              tags.endCol
            );
            return tags.entries.map((entry) => {
              const item = new vscode.CompletionItem(
                entry.label,
                entry.source === "connection"
                  ? vscode.CompletionItemKind.Class
                  : entry.source === "section"
                    ? vscode.CompletionItemKind.Module
                    : vscode.CompletionItemKind.Keyword
              );
              item.detail = entry.detail;
              const conn =
                entry.source === "connection"
                  ? index?.connections.get(entry.connectionName ?? entry.label)
                  : undefined;
              if (conn && index) {
                // The "with fields" variant keeps its own detail (its keys).
                item.detail =
                  entry.detail ??
                  (conn.messageName ? `→ ${conn.messageName}` : conn.bus);
                item.documentation = renderConnection(conn, index);
              }
              item.range = replaceRange;
              item.filterText = entry.filterText;
              item.sortText = entry.sortText;
              item.preselect = entry.preselect;
              if (entry.isSnippet) {
                item.insertText = new vscode.SnippetString(entry.insertText);
                // Indentation is spelled out in the snippet; don't re-indent.
                item.keepWhitespace = true;
              } else {
                item.insertText = entry.insertText;
              }
              if (entry.lineIndent !== undefined) {
                // Closing tag: move it under its opening tag.
                item.additionalTextEdits = [
                  vscode.TextEdit.replace(
                    new vscode.Range(
                      position.line,
                      0,
                      position.line,
                      tags.bracketCol
                    ),
                    entry.lineIndent
                  ),
                ];
              }
              return item;
            });
          }
          case "fieldName": {
            // Which names to offer (already-assigned keys hidden, output-only
            // parameters kept out of [STEP INPUTS], reserved fields last) is
            // decided in lib/fieldCompletion.ts.
            const fieldRange = computeIdentifierRange(document, position);
            const message = index?.resolveConnectionMessage(ctx.messageName);
            return computeFieldNameCompletions(
              document.getText().split(/\r?\n/),
              position.line,
              message
            ).map((entry) => {
              if (entry.field && message) {
                const item = fieldToItem(entry.field, message, fieldRange);
                item.sortText = entry.sortText;
                return item;
              }
              const item = new vscode.CompletionItem(
                entry.name,
                vscode.CompletionItemKind.Keyword
              );
              item.detail = "TestPit parameter field";
              item.range = fieldRange;
              item.filterText = entry.name;
              item.sortText = entry.sortText;
              return item;
            });
          }
          case "fieldValue": {
            // `match` is answered without the index — it needs no config.
            if (ctx.fieldName === "match") {
              const matchRange = computeIdentifierRange(document, position);
              return MATCH_VALUE_HINTS.map(([name, detail]) => {
                const item = new vscode.CompletionItem(
                  name,
                  vscode.CompletionItemKind.EnumMember
                );
                item.detail = detail;
                item.range = matchRange;
                item.filterText = name;
                return item;
              });
            }
            const message = index?.resolveConnectionMessage(ctx.messageName);
            const field = message?.fields.find((f) => f.name === ctx.fieldName);
            // A message field's value may come from a CSV cell; a parameter's
            // (time, count, …) is not read that way by the validator, so the
            // CSV entries are kept to fields.
            const items: vscode.CompletionItem[] = PARAMETER_FIELDS.has(
              ctx.fieldName
            )
              ? []
              : csvValueItems(document, position);
            if (!field || !message) {
              return items;
            }
            const valueRange = computeIdentifierRange(document, position);
            if (field.enums && field.enums.length > 0) {
              for (const e of field.enums) {
                const item = new vscode.CompletionItem(
                  e.name,
                  vscode.CompletionItemKind.EnumMember
                );
                item.detail = `= ${e.value}`;
                item.documentation = renderEnum(e, field, message);
                item.range = valueRange;
                item.filterText = e.name;
                items.push(item);
              }
              return items;
            }
            const pushNumeric = (value: string | undefined, label: string): void => {
              if (value === undefined || value === "" || value === "-") {
                return;
              }
              const item = new vscode.CompletionItem(
                value,
                vscode.CompletionItemKind.Value
              );
              item.detail = label;
              item.range = valueRange;
              item.filterText = value;
              items.push(item);
            };
            pushNumeric(field.defaultValue, "default");
            pushNumeric(field.minValue, "min");
            pushNumeric(field.maxValue, "max");
            return items;
          }
          case "variableRef": {
            // Names, values, replace range and insert text all come from
            // lib/macros.ts. The range starts at the opening `%` and the
            // insert text is the whole `%NAME%`, so it comes out the same
            // whether or not a closing `%` is already there.
            const macros = computeMacroCompletions(
              document.getText(),
              position.line,
              position.character,
              createMacroResolver(document)
            );
            if (!macros) {
              return [];
            }
            const macroRange = new vscode.Range(
              position.line,
              macros.startCol,
              position.line,
              macros.endCol
            );
            return macros.entries.map((entry) => {
              const item = new vscode.CompletionItem(
                entry.name,
                vscode.CompletionItemKind.Variable
              );
              item.detail = entry.detail;
              item.documentation = new vscode.MarkdownString(
                describeMacroDefinitions(entry.definitions, macroFileLabel)
              );
              item.range = macroRange;
              item.insertText = entry.insertText;
              item.filterText = entry.filterText;
              return item;
            });
          }
          default:
            return [];
        }
      },
    },
    "[",
    "/",
    "%",
    "=",
    "."
  );
}

/**
 * The value-from-CSV entries for the cursor: the `.csv` files beside the
 * script (or in the folder typed so far), or the ` line:N col:M` tail once a
 * `.csv` name stands there. What applies, and the replace range, come from
 * lib/csvValueCompletion.ts. Ranked below the field's own values.
 */
function csvValueItems(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const csv = csvValueContext(
    document.lineAt(position.line).text,
    position.character
  );
  if (!csv) {
    return [];
  }
  let entries: CsvValueEntry[];
  if (csv.kind === "tail") {
    entries = [csvTailEntry()];
  } else if (document.uri.scheme === "file") {
    entries = csvFileEntries(
      listCsvFiles(
        resolveScriptRelative(document.uri.fsPath, `${csv.dirPart}.`)
      )
    );
  } else {
    // An unsaved script has no folder to look in.
    entries = [];
  }
  const range = new vscode.Range(
    position.line,
    csv.startCol,
    position.line,
    csv.endCol
  );
  return entries.map((entry) => {
    const item = new vscode.CompletionItem(
      entry.label,
      entry.kind === "tail"
        ? vscode.CompletionItemKind.Snippet
        : vscode.CompletionItemKind.File
    );
    item.detail = entry.detail;
    item.insertText = new vscode.SnippetString(entry.insertText);
    item.range = range;
    item.filterText = entry.filterText;
    item.sortText = entry.sortText;
    return item;
  });
}

function fieldToItem(
  field: FieldDef,
  message: { name: string },
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    field.name,
    vscode.CompletionItemKind.Field
  );
  const type = field.dataType ?? message.name;
  // A reserved field is offered - it IS a field of the message and TestPit
  // accepts it - but it is worth knowing the value goes nowhere.
  item.detail = field.used === false ? `${type} · reserved` : type;
  item.documentation = renderField(field, undefined);
  item.range = range;
  // Spell out filterText so dotted field names (1553's `Mode.SelectedCourse`)
  // are matched even when VS Code's word-at-cursor heuristic disagrees.
  item.filterText = field.name;
  return item;
}

/**
 * Compute the range to replace when the user accepts a completion item:
 * the dotted-identifier word ending at the cursor. Bypasses VS Code's
 * default word-at-cursor heuristic, which mis-handles digit-leading
 * (`1553_…`) and dotted (`Mode.SelectedCourse`) tokens depending on
 * intersecting `wordPattern` and trigger-character defaults.
 */
function computeIdentifierRange(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Range {
  const lineText = document.lineAt(position.line).text;
  const before = lineText.slice(0, position.character);
  const m = before.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
  const start = m ? position.character - m[0].length : position.character;
  return new vscode.Range(position.line, start, position.line, position.character);
}
