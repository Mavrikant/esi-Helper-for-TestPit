import type * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { BUILT_IN_IDS } from "../projects";
import { getActiveProject, onActiveProjectChanged } from "./projectRegistry";
import { XmlIndex, parseConfigFolder } from "./xmlIndex";
import { getOutputChannel } from "./outputChannel";

const indexByConfigPath = new Map<string, XmlIndex>();

export function getActiveProjectIndex(): XmlIndex | undefined {
  const folderpath = getActiveConfigFolderpath();
  if (!folderpath) {
    return undefined;
  }
  let index = indexByConfigPath.get(folderpath);
  if (!index) {
    index = rebuild(folderpath);
  }
  return index;
}

export function registerIndexLifecycle(): vscode.Disposable {
  const vsc: typeof vscode = require("vscode");

  // Pre-build for the currently active project (if any) so the first
  // completion / hover request is fast.
  const initial = getActiveConfigFolderpath();
  if (initial) {
    rebuild(initial);
  }

  const watchedKeys = [
    `${CONFIG_SECTION}.customProjects`,
    ...BUILT_IN_IDS.map((id) => `${CONFIG_SECTION}.${id}.configFolderpath`),
  ];

  // File watcher: rebuild when any XML in the active project's config
  // folder changes. We use a single watcher and re-create it when the
  // active folder changes (below).
  let fsWatcher: vscode.FileSystemWatcher | undefined;
  const setupFileWatcher = (): void => {
    fsWatcher?.dispose();
    fsWatcher = undefined;
    const folderpath = getActiveConfigFolderpath();
    if (!folderpath) {
      return;
    }
    const pattern = new vsc.RelativePattern(folderpath, "*.xml");
    fsWatcher = vsc.workspace.createFileSystemWatcher(pattern);
    const onChange = (): void => {
      indexByConfigPath.delete(folderpath);
      rebuild(folderpath);
    };
    fsWatcher.onDidChange(onChange);
    fsWatcher.onDidCreate(onChange);
    fsWatcher.onDidDelete(onChange);
  };
  setupFileWatcher();

  const reloadIndex = (): void => {
    indexByConfigPath.clear();
    const folderpath = getActiveConfigFolderpath();
    if (folderpath) {
      rebuild(folderpath);
    }
    setupFileWatcher();
  };

  const configWatcher = vsc.workspace.onDidChangeConfiguration((event) => {
    if (watchedKeys.some((key) => event.affectsConfiguration(key))) {
      reloadIndex();
    }
  });

  const projectChangeSub = onActiveProjectChanged(() => reloadIndex());

  return vsc.Disposable.from(configWatcher, projectChangeSub, {
    dispose: () => {
      fsWatcher?.dispose();
      indexByConfigPath.clear();
    },
  });
}

function rebuild(folderpath: string): XmlIndex {
  const index = parseConfigFolder(folderpath);
  indexByConfigPath.set(folderpath, index);
  try {
    const ch = getOutputChannel();
    ch.appendLine(
      `[index] ${folderpath}: ${index.connections.size} connections, ${index.messages.size} messages`
    );
  } catch {
    // OutputChannel access can fail in test contexts where vscode isn't
    // fully mocked; the index is still usable.
  }
  return index;
}

function getActiveConfigFolderpath(): string | undefined {
  // Read it off the resolved Project rather than re-deriving from settings.
  // Built-in projects (RNE / VORILS) get configFolderpath populated by
  // buildBuiltInProject; custom projects leave it undefined and are
  // skipped (they bake full paths into their validityArgs instead).
  const project = getActiveProject();
  const folderpath = project?.configFolderpath;
  return folderpath && folderpath.length > 0 ? folderpath : undefined;
}
