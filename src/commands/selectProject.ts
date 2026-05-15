import * as vscode from "vscode";
import { loadProjects, setActiveProjectId } from "../lib/projectRegistry";

export function registerSelectProject(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.selectProject",
    async () => {
      const projects = loadProjects();
      const pick = await vscode.window.showQuickPick(
        projects.map((p) => ({
          label: p.label,
          description: p.id,
          id: p.id,
        })),
        { placeHolder: "Select TestPit project" }
      );
      if (pick) {
        await setActiveProjectId(pick.id);
      }
    }
  );
}
