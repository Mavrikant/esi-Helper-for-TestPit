import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveScriptRelative } from "../lib/fileRefs";
import { IncludedFile, MacroResolver } from "../lib/macros";

/**
 * The fs / editor side of lib/macros.ts: reads the file an
 * `include file = <path>` names.
 *
 * The path is taken relative to the folder of the file that holds the
 * `[INCLUDE]` (an absolute path is used as is). TestPit's own rule is not
 * known to this extension — when the file is not found there, the include
 * counts as unresolved and the macro checks stand down, so a wrong guess can
 * only silence a diagnostic, never raise one.
 *
 * An included file that is open in an editor is read from the editor (unsaved
 * edits count); otherwise from disk, cached by modification time.
 */
const diskCache = new Map<string, { mtimeMs: number; text: string }>();

/**
 * One file, one key: Windows (where TestPit runs) and macOS file systems do
 * not tell `C:\\T\\a.esi` and `c:\\t\\A.esi` apart. The key itself keeps its
 * real spelling (file labels, Uri.file); this only decides "same file".
 */
export function includeIdentity(key: string): string {
  if (process.platform === "win32") {
    return path.win32.normalize(key).toLowerCase();
  }
  return process.platform === "darwin" ? key.toLowerCase() : key;
}

function readText(fullPath: string): string | undefined {
  const wanted = includeIdentity(fullPath);
  for (const doc of vscode.workspace.textDocuments) {
    // Only the file itself: a `git:` document (the HEAD side of a diff) has
    // the working copy's fsPath but older text.
    if (doc.uri.scheme === "file" && includeIdentity(doc.uri.fsPath) === wanted) {
      return doc.getText();
    }
  }
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return undefined;
    }
    const hit = diskCache.get(wanted);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      return hit.text;
    }
    const text = fs.readFileSync(fullPath, "utf-8");
    diskCache.set(wanted, { mtimeMs: stat.mtimeMs, text });
    return text;
  } catch {
    return undefined;
  }
}

/**
 * `onInclude` is told the full path of every file an include names, read or
 * not: what a check of the document depends on besides its own text (an
 * unreadable one may appear later).
 */
export function createMacroResolver(
  document: vscode.TextDocument,
  onInclude?: (fullPath: string) => void
): MacroResolver {
  if (document.uri.scheme !== "file") {
    // Untitled (its fsPath is a bare name), or a virtual document such as the
    // `git:` side of a diff: there is no folder of its own to resolve
    // includes from, so they stay unresolved and the macro checks stand down.
    return {};
  }
  const selfKey = path.resolve(document.uri.fsPath);
  return {
    selfKey,
    identity: includeIdentity,
    readInclude(includePath, fromKey): IncludedFile | undefined {
      // The ONE resolve-relative-to-the-script rule (lib/fileRefs.ts), shared
      // with CSV refs and document links; it accepts both slash styles.
      const fullPath = resolveScriptRelative(fromKey ?? selfKey, includePath);
      onInclude?.(fullPath);
      if (includeIdentity(fullPath) === includeIdentity(selfKey)) {
        return { key: selfKey, text: document.getText() };
      }
      const text = readText(fullPath);
      return text === undefined ? undefined : { key: fullPath, text };
    },
  };
}

/** File name rather than a full path, for hover / completion. */
export function macroFileLabel(key: string): string {
  return path.basename(key);
}

/** Watchers kept in step with the include targets a caller depends on. */
export interface OutsideIncludeWatchers extends vscode.Disposable {
  /** The full paths of every include target still depended on. */
  update(paths: Iterable<string>): void;
}

/**
 * File watchers for include targets outside every workspace folder. The
 * include re-checks listen to a `**\/*.esi` watcher, and a string glob only
 * reports events from the workspace folders (none at all with no folder
 * open), while includes often climb out of them (`..\Utilities\…`). Each such
 * file gets a watcher of its own — made and dropped as `update` is given the
 * current targets — whose events `wire` subscribes to, as for the main one.
 */
export function createOutsideIncludeWatchers(
  wire: (watcher: vscode.FileSystemWatcher) => vscode.Disposable[]
): OutsideIncludeWatchers {
  // includeIdentity → the watcher and its subscriptions.
  const watchers = new Map<string, vscode.Disposable>();
  const drop = (key: string): void => {
    watchers.get(key)?.dispose();
    watchers.delete(key);
  };
  return {
    update(paths) {
      const wanted = new Map<string, string>();
      for (const fullPath of paths) {
        if (!isInWorkspaceFolder(fullPath)) {
          wanted.set(includeIdentity(fullPath), fullPath);
        }
      }
      for (const key of Array.from(watchers.keys())) {
        if (!wanted.has(key)) {
          drop(key);
        }
      }
      for (const [key, fullPath] of wanted) {
        if (watchers.has(key)) {
          continue;
        }
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(path.dirname(fullPath), path.basename(fullPath))
        );
        watchers.set(key, vscode.Disposable.from(watcher, ...wire(watcher)));
      }
    },
    dispose() {
      for (const key of Array.from(watchers.keys())) {
        drop(key);
      }
    },
  };
}

/** True when `fullPath` lies inside one of the open (on-disk) workspace folders. */
function isInWorkspaceFolder(fullPath: string): boolean {
  const file = includeIdentity(path.resolve(fullPath));
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
    if (folder.uri.scheme !== "file") {
      return false;
    }
    const relative = path.relative(includeIdentity(path.resolve(folder.uri.fsPath)), file);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  });
}
