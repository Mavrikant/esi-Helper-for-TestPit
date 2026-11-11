import * as vscode from "vscode";
import { describeStepRenumber, planStepRenumber } from "../lib/renumberSteps";

export function registerUpdateStepNumbers(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.updateStepNumbers",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const plan = planStepRenumber(editor.document.getText());
      if (plan.edits.length > 0) {
        // Only the digits are replaced, so the cursor, folding and every
        // other byte of the document stay where they are.
        const applied = await editor.edit((editBuilder) => {
          for (const e of plan.edits) {
            editBuilder.replace(
              new vscode.Range(e.line, e.startCol, e.line, e.endCol),
              e.newText
            );
          }
        });
        if (!applied) {
          void vscode.window.showWarningMessage(
            "Step numbers could not be updated — the document changed meanwhile."
          );
          return;
        }
      }
      void vscode.window.showInformationMessage(describeStepRenumber(plan));
    }
  );
}
