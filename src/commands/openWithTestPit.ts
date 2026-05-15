import * as vscode from "vscode";
import { openInTestPit } from "../lib/testpitRunner";

export function registerOpenWithTestPit(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.openWithTestPit", () => {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
      return;
    }
    openInTestPit(filePath);
  });
}
