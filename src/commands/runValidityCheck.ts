import * as vscode from "vscode";
import { runValidityCheckSync } from "../lib/testpitRunner";
import { getOutputChannel } from "../lib/outputChannel";
import { withTempScript } from "../lib/withTempScript";
import { getOrPromptForProject } from "../lib/projectRegistry";
import { buildValidityCommand } from "../projects";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.runValidityCheck",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const project = await getOrPromptForProject();
      if (!project) {
        return;
      }
      await withTempScript(
        editor.document.uri.fsPath,
        editor.document.getText(),
        (tempPath) => {
          const command = buildValidityCommand(project, tempPath);
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
