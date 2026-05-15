import * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { runValidityCheckSync } from "../lib/testpitRunner";
import { getOutputChannel } from "../lib/outputChannel";
import { withTempScript } from "../lib/withTempScript";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.runValidityCheck",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const configFolderpath =
        vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>("testpitConfigFolderpath") ?? "";

      await withTempScript(
        editor.document.uri.fsPath,
        editor.document.getText(),
        (tempPath) => {
          const output = runValidityCheckSync(configFolderpath, tempPath);
          const channel = getOutputChannel();
          channel.clear();
          channel.appendLine(output);
          channel.show(true);
        }
      );
    }
  );
}
