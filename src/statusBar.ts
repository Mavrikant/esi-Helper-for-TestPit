import * as vscode from "vscode";
import {
  getActiveProfileName,
  getProfiles,
  onActiveProfileChanged,
} from "./lib/profileRegistry";

const STATUS_BAR_PRIORITY = 10000;

export function registerProjectStatusBar(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "esihelper.testpitProfile",
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );
  item.name = "TestPit Profile";
  item.command = "extension.selectProfile";

  const refresh = (): void => {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      item.text = "$(warning) No TestPit profiles";
      item.tooltip =
        "No TestPit profiles found in the registry (HKCU\\Software\\ESEN\\TestPit). Run “ESI Helper: Reload TestPit Settings”.";
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      return;
    }
    const active = getActiveProfileName();
    item.text = active ?? "Pick TestPit profile";
    item.tooltip = active
      ? `Active TestPit profile: ${active}. Click to switch.`
      : "No TestPit profile selected. Click to choose one.";
    item.backgroundColor = active
      ? undefined
      : new vscode.ThemeColor("statusBarItem.warningBackground");
  };

  refresh();
  item.show();

  const profileChangeSub = onActiveProfileChanged(() => refresh());

  return vscode.Disposable.from(item, profileChangeSub);
}
