import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";
import { computeTagCompletions } from "../lib/tagCompletion";
import { FieldDef } from "../lib/xmlIndex";

// Common cross-bus parameter fields offered in every message block. The
// validator (componentValidator.PARAMETER_FIELDS) accepts a wider set incl.
// bus-specific params (parity/value/angle/duration/image/…); those are left out
// of completion so suggestions stay relevant to the typical case.
const COMMON_PARAMETER_FIELDS = [
  "time",
  "period",
  "interval",
  "occurrence",
  "count",
  "match",
];

// The only two values `match` accepts (TestPit checkMatchValue). Offered
// directly — `match` is a TestPit parameter, not an XML-indexed field, so
// there is no enum table to draw them from.
const MATCH_VALUE_HINTS: ReadonlyArray<[string, string]> = [
  ["next", "the default: the next record no other block has taken"],
  ["any", "any record of the window may answer this block"],
];

const VARIABLE_BLOCK = /\[VARIABLES\]([\s\S]*?)\[\/VARIABLES\]/g;
const VARIABLE_DECL = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

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
              index ? index.connections.keys() : []
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
                  ? index?.connections.get(entry.label)
                  : undefined;
              if (conn && index) {
                item.detail = conn.messageName ? `→ ${conn.messageName}` : conn.bus;
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
            const fieldRange = computeIdentifierRange(document, position);
            const items: vscode.CompletionItem[] = COMMON_PARAMETER_FIELDS.map((name) => {
              const item = new vscode.CompletionItem(
                name,
                vscode.CompletionItemKind.Keyword
              );
              item.detail = "TestPit parameter field";
              item.range = fieldRange;
              item.filterText = name;
              return item;
            });
            if (!index) {
              return items;
            }
            const message = index.resolveConnectionMessage(ctx.messageName);
            if (!message) {
              return items;
            }
            for (const field of message.fields) {
              items.push(fieldToItem(field, message, fieldRange));
            }
            return items;
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
            if (!index) {
              return [];
            }
            const message = index.resolveConnectionMessage(ctx.messageName);
            const field = message?.fields.find((f) => f.name === ctx.fieldName);
            if (!field) {
              return [];
            }
            const valueRange = computeIdentifierRange(document, position);
            if (field.enums && field.enums.length > 0) {
              return field.enums.map((e) => {
                const item = new vscode.CompletionItem(
                  e.name,
                  vscode.CompletionItemKind.EnumMember
                );
                item.detail = `= ${e.value}`;
                item.documentation = renderEnum(e, field, message);
                item.range = valueRange;
                item.filterText = e.name;
                return item;
              });
            }
            const items: vscode.CompletionItem[] = [];
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
            const variables = collectInScopeVariables(document.getText());
            return variables.map((name) => {
              const item = new vscode.CompletionItem(
                name,
                vscode.CompletionItemKind.Variable
              );
              item.detail = "[VARIABLES] declaration";
              item.insertText = `${name}%`;
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

function collectInScopeVariables(documentText: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  VARIABLE_BLOCK.lastIndex = 0;
  while ((match = VARIABLE_BLOCK.exec(documentText)) !== null) {
    const block = match[1];
    let inner: RegExpExecArray | null;
    VARIABLE_DECL.lastIndex = 0;
    while ((inner = VARIABLE_DECL.exec(block)) !== null) {
      names.add(inner[1]);
    }
  }
  return Array.from(names).sort();
}
