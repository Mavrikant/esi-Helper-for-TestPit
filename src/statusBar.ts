import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { BUILT_IN_IDS } from "./projects";
import { getActiveProjectId, loadProjects } from "./lib/projectRegistry";

const WATCHED_KEYS = [
  `${CONFIG_SECTION}.activeProject`,
  `${CONFIG_SECTION}.customProjects`,
  ...BUILT_IN_IDS.flatMap((id) => [
    `${CONFIG_SECTION}.${id}.executablePath`,
    `${CONFIG_SECTION}.${id}.configFolderpath`,
  ]),
];

const STATUS_BAR_PRIORITY = 10000;

export function registerProjectStatusBar(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "esihelper.activeProject",
    vscode.StatusBarAlignment.Left,
    STATUS_BAR_PRIORITY
  );
  item.name = "TestPit Project";
  item.command = "extension.selectProject";

  const refresh = (): void => {
    const id = getActiveProjectId();
    if (!id) {
      item.text = "$(beaker) Pick TestPit project";
      item.tooltip = "No TestPit project selected. Click to choose one.";
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      return;
    }
    const project = loadProjects().find((p) => p.id === id);
    item.text = project ? `$(beaker) ${project.label}` : `$(beaker) ${id} ?`;
    item.tooltip = project
      ? `Active TestPit project: ${project.label} (${id}). Click to change.`
      : `Active TestPit project id "${id}" is not defined. Click to pick another.`;
    item.backgroundColor = project
      ? undefined
      : new vscode.ThemeColor("statusBarItem.errorBackground");
  };

  refresh();
  item.show();

  const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (WATCHED_KEYS.some((key) => event.affectsConfiguration(key))) {
      refresh();
    }
  });

  return vscode.Disposable.from(item, watcher);
}
