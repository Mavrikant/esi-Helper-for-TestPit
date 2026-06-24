import * as vscode from "vscode";
import { pickTestpitExe } from "../lib/profileRegistry";

export function registerPickExecutable(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.pickExecutable", async () => {
    const picked = await pickTestpitExe();
    if (picked) {
      vscode.window.showInformationMessage(`TestPit executable set: ${picked}`);
    }
  });
}
