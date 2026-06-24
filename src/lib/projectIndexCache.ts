import type * as vscode from "vscode";
import * as path from "path";
import { XmlIndex, parseConfigFiles } from "./xmlIndex";
import {
  getActiveConfigs,
  getActiveProfileName,
  onActiveProfileChanged,
} from "./profileRegistry";
import { getOutputChannel } from "./outputChannel";

/**
 * Builds and caches the XML index for the active profile. Config paths come
 * from the registry (via profileRegistry), routed to ingesters by role — not
 * by filename — so non-standard names (NEOCAS/RNEQual) are handled.
 *
 * Cached by profile name; invalidated on profile change, on registry reload
 * (which fires the same change event), and when any resolved config file
 * changes on disk.
 */

let cachedIndex: XmlIndex | undefined;
let cachedKey: string | undefined;

export function getActiveProjectIndex(): XmlIndex | undefined {
  const configs = getActiveConfigs();
  if (Object.keys(configs).length === 0) {
    return undefined;
  }
  const key = getActiveProfileName();
  if (cachedIndex && cachedKey === key) {
    return cachedIndex;
  }
  return rebuild(key);
}

function rebuild(key: string | undefined): XmlIndex {
  const index = parseConfigFiles(getActiveConfigs());
  cachedIndex = index;
  cachedKey = key;
  try {
    getOutputChannel().appendLine(
      `[index] profile ${key ?? "<none>"}: ${index.connections.size} connections, ${index.messages.size} messages`
    );
  } catch {
    // OutputChannel access can fail when vscode isn't fully mocked (tests).
  }
  return index;
}

export function registerIndexLifecycle(): vscode.Disposable {
  const vsc: typeof vscode = require("vscode");

  // Pre-build for the active profile so the first completion/hover is fast.
  if (Object.keys(getActiveConfigs()).length > 0) {
    rebuild(getActiveProfileName());
  }

  let watchers: vscode.FileSystemWatcher[] = [];
  const disposeWatchers = (): void => {
    for (const w of watchers) {
      w.dispose();
    }
    watchers = [];
  };
  const setupWatchers = (): void => {
    disposeWatchers();
    const onChange = (): void => {
      cachedKey = undefined; // force rebuild
      rebuild(getActiveProfileName());
    };
    for (const file of Object.values(getActiveConfigs())) {
      if (!file) {
        continue;
      }
      const pattern = new vsc.RelativePattern(
        path.dirname(file),
        path.basename(file)
      );
      const watcher = vsc.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      watchers.push(watcher);
    }
  };
  setupWatchers();

  const reload = (): void => {
    cachedKey = undefined;
    cachedIndex = undefined;
    if (Object.keys(getActiveConfigs()).length > 0) {
      rebuild(getActiveProfileName());
    }
    setupWatchers();
  };

  const profileChangeSub = onActiveProfileChanged(() => reload());

  return vsc.Disposable.from(profileChangeSub, {
    dispose: () => {
      disposeWatchers();
      cachedIndex = undefined;
      cachedKey = undefined;
    },
  });
}
