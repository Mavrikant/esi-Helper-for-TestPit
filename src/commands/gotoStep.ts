import * as vscode from "vscode";
import { findStepLine } from "../lib/findStepLine";

export function registerGotoStep(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.gotoStep", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const searchQuery = await vscode.window.showInputBox({
      placeHolder: "Step number",
      prompt: "Enter the step number you want to go to",
    });
    if (!searchQuery) {
      return;
    }
    const stepNumber = String(searchQuery);
    const lineNumber = findStepLine(editor.document.getText(), stepNumber);
    if (lineNumber === -1) {
      vscode.window.showInformationMessage(
        `😔 Step "${stepNumber}" not found!`
      );
      return;
    }
    const range = editor.document.lineAt(lineNumber).range;
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  });
}
