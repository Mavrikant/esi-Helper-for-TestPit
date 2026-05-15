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

export function registerProjectStatusBar(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  item.command = "extension.selectProject";
  item.tooltip = "TestPit project. Click to change.";

  const refresh = (): void => {
    const id = getActiveProjectId();
    if (!id) {
      item.text = "$(beaker) Pick project...";
      return;
    }
    const project = loadProjects().find((p) => p.id === id);
    item.text = project ? `$(beaker) ${project.label}` : `$(beaker) ${id}?`;
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
