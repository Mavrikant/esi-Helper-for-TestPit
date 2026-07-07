import * as vscode from "vscode";
import { runValidityCheckSync } from "../lib/testpitRunner";
import { getOutputChannel } from "../lib/outputChannel";
import { withTempScript } from "../lib/withTempScript";
import {
  ensureTestpitExe,
  getActiveConfigs,
  getActiveProfileName,
} from "../lib/profileRegistry";
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
      const channel = getOutputChannel();
      await withTempScript(
        editor.document.uri.fsPath,
        editor.document.getText(),
        (tempPath) => {
          const command = buildValidityCommand(exe, tempPath, configs);
          channel.clear();
          channel.appendLine(`[profile]   ${getActiveProfileName() ?? "<none>"}`);
          channel.appendLine(`[script]    ${editor.document.uri.fsPath}`);
          channel.appendLine(
            "[temp copy] validated against a temp copy of the current buffer (see --sf below)"
          );
          channel.appendLine(`[command]   ${command}`);
          channel.appendLine("");
          channel.appendLine("--- TestPit output ---");
          const output = runValidityCheckSync(command);
          channel.appendLine(output);
          channel.show(true);
        }
      );
    }
  );
}
