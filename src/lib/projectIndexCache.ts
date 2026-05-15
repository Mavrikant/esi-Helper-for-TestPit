import type * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { BUILT_IN_IDS } from "../projects";
import { getActiveProjectId } from "./projectRegistry";
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
    `${CONFIG_SECTION}.activeProject`,
    `${CONFIG_SECTION}.customProjects`,
    ...BUILT_IN_IDS.map((id) => `${CONFIG_SECTION}.${id}.configFolderpath`),
  ];

  const configWatcher = vsc.workspace.onDidChangeConfiguration((event) => {
    if (watchedKeys.some((key) => event.affectsConfiguration(key))) {
      indexByConfigPath.clear();
      const folderpath = getActiveConfigFolderpath();
      if (folderpath) {
        rebuild(folderpath);
      }
    }
  });

  // File watcher: rebuild when any XML in the active project's config
  // folder changes. We use a single watcher and re-create it when the
  // active folder changes (above).
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

  // Re-create the file watcher if config folderpath changed.
  const fsWatcherRefresher = vsc.workspace.onDidChangeConfiguration((event) => {
    if (watchedKeys.some((key) => event.affectsConfiguration(key))) {
      setupFileWatcher();
    }
  });

  return vsc.Disposable.from(configWatcher, fsWatcherRefresher, {
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
  const vsc: typeof vscode = require("vscode");
  const id = getActiveProjectId();
  if (!id) {
    return undefined;
  }
  const config = vsc.workspace.getConfiguration(CONFIG_SECTION);
  // Built-in projects get their folderpath from `<id>.configFolderpath`.
  // Custom projects don't have one — they bake the full path into their
  // validityArgs templates, so component-data lookups don't apply to them
  // for now.
  const builtInPath = config.get<string>(`${id}.configFolderpath`);
  return builtInPath && builtInPath.length > 0 ? builtInPath : undefined;
}
