import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";
import { ConnectionDef, FieldDef } from "../lib/xmlIndex";

const TIMING_FIELDS = ["time", "interval", "occurrence", "period"];

const VARIABLE_BLOCK = /\[VARIABLES\]([\s\S]*?)\[\/VARIABLES\]/g;
const VARIABLE_DECL = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

export function registerEsiCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    "esi",
    {
      provideCompletionItems(document, position) {
        const index = getActiveProjectIndex();
        const ctx = resolveContext(
          document.getText(),
          position.line,
          position.character
        );

        switch (ctx.kind) {
          case "tagName": {
            if (!index) {
              return [];
            }
            // Explicitly tell VS Code that the partial typed text after
            // the `[` is what should be replaced. Without this, VS Code's
            // word-at-cursor heuristic mis-detects the boundary for
            // digit-leading identifiers (1553_..., 429_...) and the
            // filter list goes empty.
            const replaceRange = new vscode.Range(
              position.line,
              position.character - ctx.partial.length,
              position.line,
              position.character
            );
            const items: vscode.CompletionItem[] = [];
            for (const conn of index.connections.values()) {
              items.push(connectionToItem(conn, index, replaceRange));
            }
            return items;
          }
          case "fieldName": {
            const fieldRange = computeIdentifierRange(document, position);
            const items: vscode.CompletionItem[] = TIMING_FIELDS.map((name) => {
              const item = new vscode.CompletionItem(
                name,
                vscode.CompletionItemKind.Keyword
              );
              item.detail = "TestPit timing field";
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
    "%",
    "=",
    "."
  );
}

function connectionToItem(
  conn: ConnectionDef,
  index: ReturnType<typeof getActiveProjectIndex> & object,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    conn.fullName,
    vscode.CompletionItemKind.Class
  );
  item.detail = conn.messageName ? `→ ${conn.messageName}` : conn.bus;
  item.documentation = renderConnection(conn, index);
  item.range = range;
  // filterText spelled out so digit-leading prefixes (1553_…, 429_…) match
  // even when VS Code's default word-pattern heuristic disagrees.
  item.filterText = conn.fullName;
  return item;
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
  item.detail = field.dataType ?? message.name;
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
