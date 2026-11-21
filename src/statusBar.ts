import * as vscode from "vscode";
import {
  getActiveProfileName,
  getProfiles,
  onActiveProfileChanged,
  getTestpitExe,
} from "./lib/profileRegistry";
import {
  countSeverities,
  renderValidationStatus,
  type LiveCheckState,
} from "./lib/validationStatus";
import {
  isLiveValidationEnabled,
  isValidityRunning,
  onDidChangeValidityRun,
} from "./diagnostics";
import { CONFIG_SECTION } from "./constants";

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

/**
 * Validation state of the active .esi editor, right next to the profile item:
 * a spinner while TestPit.exe runs for that document, otherwise the error /
 * warning counts of everything reported for the file (the "esi-testpit" and
 * "esi-components" collections both land in `languages.getDiagnostics(uri)`).
 * Click focuses the Problems panel. Hidden for any other editor.
 */
export function registerValidationStatusBar(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "esihelper.validationState",
    vscode.StatusBarAlignment.Right,
    // Just below the profile item's priority: drawn directly to its right.
    STATUS_BAR_PRIORITY - 1
  );
  item.name = "ESI Validation";
  item.command = "workbench.actions.view.problems";

  const activeEsiDocument = (): vscode.TextDocument | undefined => {
    const document = vscode.window.activeTextEditor?.document;
    return document && document.languageId === "esi" ? document : undefined;
  };

  const liveCheckState = (): LiveCheckState =>
    !isLiveValidationEnabled() ? "disabled" : getTestpitExe() ? "live" : "no-exe";

  const refresh = (): void => {
    const document = activeEsiDocument();
    if (!document) {
      item.hide();
      return;
    }
    const counts = countSeverities(
      vscode.languages.getDiagnostics(document.uri).map((d) => d.severity)
    );
    const status = renderValidationStatus({
      running: isValidityRunning(document.uri),
      errors: counts.errors,
      warnings: counts.warnings,
      liveCheck: liveCheckState(),
    });
    item.text = status.text;
    item.tooltip = status.tooltip;
    item.show();
  };

  const isActive = (uri: vscode.Uri): boolean =>
    activeEsiDocument()?.uri.toString() === uri.toString();

  refresh();

  return vscode.Disposable.from(
    item,
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    // A language-mode change re-opens the document under its new languageId.
    vscode.workspace.onDidOpenTextDocument(() => refresh()),
    vscode.languages.onDidChangeDiagnostics((event) => {
      if (event.uris.some(isActive)) {
        refresh();
      }
    }),
    onDidChangeValidityRun((event) => {
      if (isActive(event.uri)) {
        refresh();
      }
    }),
    // Profile switch / registry reload: a re-check is on its way.
    onActiveProfileChanged(() => refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        refresh();
      }
    })
  );
}
