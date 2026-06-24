import * as vscode from "vscode";
import {
  getActiveProfileName,
  getProfiles,
  getTestpitExe,
  pickTestpitExe,
  setActiveProfile,
} from "../lib/profileRegistry";

const CHANGE_EXE_LABEL = "$(gear) Change TestPit executable…";

export function registerSelectProfile(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.selectProfile", async () => {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        "No TestPit profiles found in the registry. Reload from the registry now?",
        "Reload"
      );
      if (choice === "Reload") {
        await vscode.commands.executeCommand("extension.reloadRegistry");
      }
      return;
    }
    const active = getActiveProfileName();
    const items: vscode.QuickPickItem[] = profiles.map((name) => ({
      label: name,
      description: name === active ? "active" : undefined,
    }));
    // Let users also (re)point the TestPit.exe from the same picker the
    // status-bar item opens — it's otherwise only reachable via the palette.
    const exe = getTestpitExe();
    items.push({
      label: CHANGE_EXE_LABEL,
      description: exe ?? "not set",
    });
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select TestPit profile (or change the executable)",
    });
    if (!pick) {
      return;
    }
    if (pick.label === CHANGE_EXE_LABEL) {
      await pickTestpitExe();
      return;
    }
    await setActiveProfile(pick.label);
  });
}
