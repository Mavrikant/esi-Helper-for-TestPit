import * as vscode from "vscode";
import { runCommandDetached } from "../lib/testpitRunner";
import { getOrPromptForProject } from "../lib/projectRegistry";
import { buildOpenCommand } from "../projects";

export function registerOpenWithTestPit(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.openWithTestPit",
    async () => {
      const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!filePath) {
        return;
      }
      const project = await getOrPromptForProject();
      if (!project) {
        return;
      }
      runCommandDetached(buildOpenCommand(project, filePath));
    }
  );
}
