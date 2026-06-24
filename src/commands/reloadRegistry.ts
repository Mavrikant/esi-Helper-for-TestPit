import * as vscode from "vscode";
import { getActiveProfileName, reloadRegistry } from "../lib/profileRegistry";

export function registerReloadRegistry(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.reloadRegistry", () => {
    const model = reloadRegistry();
    if (!model || model.profiles.length === 0) {
      vscode.window.showWarningMessage(
        "Could not read TestPit profiles from the registry (HKEY_CURRENT_USER\\Software\\ESEN\\TestPit). Is TestPit installed and run at least once?"
      );
      return;
    }
    vscode.window.showInformationMessage(
      `Reloaded ${model.profiles.length} TestPit profile(s). Active: ${getActiveProfileName() ?? "<none>"}.`
    );
  });
}
