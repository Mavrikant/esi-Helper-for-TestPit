import * as vscode from "vscode";
import { findMatchingTag } from "../lib/tagPairs";

/**
 * "Go to Matching Tag": from `[NAME]` to its `[/NAME]` and back; from inside
 * a block, to the opening tag of the innermost enclosing block.
 */
export function registerGotoMatchingTag(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.gotoMatchingTag", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "esi") {
      return;
    }
    const target = findMatchingTag(
      editor.document.getText(),
      editor.selection.active.line
    );
    if (!target) {
      vscode.window.setStatusBarMessage(
        "No matching section tag for this line.",
        3000
      );
      return;
    }
    const position = new vscode.Position(target.line, target.character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  });
}
