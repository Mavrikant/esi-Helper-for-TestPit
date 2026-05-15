import * as vscode from "vscode";
import { resolveContext } from "../lib/esiContext";
import { getActiveProjectIndex } from "../lib/projectIndexCache";

const SOURCE = "esi Helper";
const FIXABLE_CODES = new Set(["unknownEnum"]);

export function registerEsiCodeActionsProvider(): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    "esi",
    {
      provideCodeActions(document, _range, context) {
        const actions: vscode.CodeAction[] = [];
        const index = getActiveProjectIndex();
        if (!index) {
          return actions;
        }

        for (const diag of context.diagnostics) {
          if (diag.source !== SOURCE) {
            continue;
          }
          const code = typeof diag.code === "string" ? diag.code : "";
          if (!FIXABLE_CODES.has(code)) {
            continue;
          }

          // Re-derive the field's enum list at the diagnostic position so we
          // can offer one quick-fix per valid enum value.
          const ctx = resolveContext(
            document.getText(),
            diag.range.start.line,
            diag.range.start.character
          );
          if (ctx.kind !== "fieldValue") {
            continue;
          }
          const message = index.resolveConnectionMessage(ctx.messageName);
          const field = message?.fields.find((f) => f.name === ctx.fieldName);
          if (!field?.enums || field.enums.length === 0) {
            continue;
          }

          for (const e of field.enums) {
            const fix = new vscode.CodeAction(
              `Replace with '${e.name}' (= ${e.value})`,
              vscode.CodeActionKind.QuickFix
            );
            fix.diagnostics = [diag];
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(document.uri, diag.range, e.name);
            actions.push(fix);
          }
        }
        return actions;
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );
}
