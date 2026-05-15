import * as vscode from "vscode";
import { refactorWhitespace } from "../lib/refactorWhitespace";

export function registerRefactorDocument(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.refactorDocument",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const original = editor.document.getText();
      const updated = refactorWhitespace(original);
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(original.length)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, updated);
      });
    }
  );
}
