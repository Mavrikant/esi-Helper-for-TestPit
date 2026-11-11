import * as vscode from "vscode";
import * as os from "os";
import {
  preprocessedEsiPath,
  preprocessedOpenFailureMessage,
} from "../lib/preprocessedPath";

export function registerShowProcessedFile(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.showProcessedFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const filePath = preprocessedEsiPath(os.homedir());
      const fileUri = vscode.Uri.file(filePath);
      try {
        await vscode.window.showTextDocument(fileUri, {
          viewColumn: vscode.ViewColumn.Beside,
        });
      } catch {
        vscode.window.showErrorMessage(
          preprocessedOpenFailureMessage(filePath)
        );
      }
    }
  );
}
