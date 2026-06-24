import * as vscode from "vscode";
import { runValidityCheckSync } from "../lib/testpitRunner";
import { getOutputChannel } from "../lib/outputChannel";
import { withTempScript } from "../lib/withTempScript";
import { ensureTestpitExe, getActiveConfigs } from "../lib/profileRegistry";
import { buildValidityCommand } from "../profiles";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.runValidityCheck",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const exe = await ensureTestpitExe();
      if (!exe) {
        return;
      }
      const configs = getActiveConfigs();
      await withTempScript(
        editor.document.uri.fsPath,
        editor.document.getText(),
        (tempPath) => {
          const command = buildValidityCommand(exe, tempPath, configs);
          const output = runValidityCheckSync(command);
          const channel = getOutputChannel();
          channel.clear();
          channel.appendLine(output);
          channel.show(true);
        }
      );
    }
  );
}
