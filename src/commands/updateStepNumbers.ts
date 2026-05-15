import * as vscode from "vscode";
import { renumberSteps } from "../lib/renumberSteps";

export function registerUpdateStepNumbers(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.updateStepNumbers",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const original = editor.document.getText();
      const updated = renumberSteps(original);
      const fullRange = new vscode.Range(
        editor.document.lineAt(0).range.start,
        editor.document.lineAt(editor.document.lineCount - 1).range.end
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, updated);
      });
    }
  );
}
