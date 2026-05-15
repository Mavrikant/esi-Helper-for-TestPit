import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";
import { ConnectionDef, FieldDef } from "../lib/xmlIndex";

const TIMING_FIELDS = ["time", "delay"];

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
            const items: vscode.CompletionItem[] = [];
            for (const conn of index.connections.values()) {
              items.push(connectionToItem(conn, index));
            }
            return items;
          }
          case "fieldName": {
            const items: vscode.CompletionItem[] = TIMING_FIELDS.map((name) => {
              const item = new vscode.CompletionItem(
                name,
                vscode.CompletionItemKind.Keyword
              );
              item.detail = "TestPit timing field";
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
              items.push(fieldToItem(field, message));
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
            if (field.dataType === "Enum" && field.enums) {
              return field.enums.map((e) => {
                const item = new vscode.CompletionItem(
                  e.name,
                  vscode.CompletionItemKind.EnumMember
                );
                item.detail = `= ${e.value}`;
                item.documentation = renderEnum(e, field, message);
                return item;
              });
            }
            const items: vscode.CompletionItem[] = [];
            if (field.defaultValue !== undefined && field.defaultValue !== "") {
              const item = new vscode.CompletionItem(
                field.defaultValue,
                vscode.CompletionItemKind.Value
              );
              item.detail = "default";
              items.push(item);
            }
            if (field.minValue !== undefined && field.minValue !== "-") {
              const item = new vscode.CompletionItem(
                field.minValue,
                vscode.CompletionItemKind.Value
              );
              item.detail = "min";
              items.push(item);
            }
            if (field.maxValue !== undefined && field.maxValue !== "-") {
              const item = new vscode.CompletionItem(
                field.maxValue,
                vscode.CompletionItemKind.Value
              );
              item.detail = "max";
              items.push(item);
            }
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
    "="
  );
}

function connectionToItem(
  conn: ConnectionDef,
  index: ReturnType<typeof getActiveProjectIndex> & object
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    conn.fullName,
    vscode.CompletionItemKind.Class
  );
  item.detail = conn.messageName ? `→ ${conn.messageName}` : conn.bus;
  item.documentation = renderConnection(conn, index);
  return item;
}

function fieldToItem(
  field: FieldDef,
  message: { name: string }
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    field.name,
    vscode.CompletionItemKind.Field
  );
  item.detail = field.dataType ?? message.name;
  item.documentation = renderField(field, undefined);
  return item;
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
