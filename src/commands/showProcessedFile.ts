import * as vscode from "vscode";
import * as os from "os";

export function registerShowProcessedFile(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.showProcessedFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const username = os.userInfo().username;
      const filePath = `C:\\Users\\${username}\\Documents\\Testpit\\Preprocessed.esi`;
      const fileUri = vscode.Uri.file(filePath);
      try {
        await vscode.window.showTextDocument(fileUri, {
          viewColumn: vscode.ViewColumn.Beside,
        });
      } catch {
        vscode.window.showErrorMessage("Could not open file.");
      }
    }
  );
}
