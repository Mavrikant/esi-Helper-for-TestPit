import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { INCLUDER_DELAY_MS, toDiagnostic } from "../componentDiagnostics";
import { createCsvCellLookup } from "../lib/csv";
import { getOutputChannel } from "../lib/outputChannel";
import { getActiveProfileName } from "../lib/profileRegistry";
import { getActiveProjectIndex, onIndexChanged } from "../lib/projectIndexCache";
import {
  EsiIssue,
  FileOutcome,
  checkedFile,
  collectEsiIssues,
  formatReport,
  formatSummary,
  progressLabel,
  stripBom,
  summarizeWorkspace,
  unreadableFile,
} from "../lib/workspaceValidation";
import {
  createMacroResolver,
  createOutsideIncludeWatchers,
  includeIdentity,
  sameIncludeKeys,
} from "../providers/macroResolver";

export const VALIDATE_WORKSPACE_COMMAND = "extension.validateWorkspace";
export const CLEAR_WORKSPACE_VALIDATION_COMMAND = "extension.clearWorkspaceValidation";

// A collection of its OWN, not the live "esi-components" one (which lives
// inside componentDiagnostics.ts and deletes a file's entry when its document
// closes). The two never hold the same file at the same time:
//   - a file open as an `esi` document is validated live, so this collection
//     holds nothing for it (it is still counted in the run's summary, from the
//     editor buffer — unsaved edits included);
//   - when a file from the last run is opened, its entry here is dropped (the
//     live collection takes over); when it is closed again it is re-checked
//     from disk, so its problems do not vanish from the Problems panel.
// Hence no duplicate rows, and no stale row next to a live one.
const COLLECTION_NAME = "esi-workspace";
const ESI_GLOB = "**/*.esi";

const ACTION_SHOW = "Show Problems";
const ACTION_CLEAR = "Clear";

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
}

type CheckResult =
  | {
      issues: EsiIssue[];
      /** Every file an include names, read or not: includeIdentity → path. */
      includes: Map<string, string>;
    }
  | { error: string };

/**
 * Run every in-process check on one file. Never opens an editor or a
 * TextDocument: the text is the buffer of an already-open document, or the
 * file on disk. Never runs TestPit.exe.
 */
async function checkFile(
  uri: vscode.Uri,
  openDocument: vscode.TextDocument | undefined
): Promise<CheckResult> {
  let text: string;
  if (openDocument) {
    text = openDocument.getText();
  } else {
    try {
      text = stripBom(await fs.promises.readFile(uri.fsPath, "utf-8"));
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  // createMacroResolver only needs the path and the text of the script.
  const scriptLike = { uri, getText: () => text } as vscode.TextDocument;
  const includes = new Map<string, string>();
  try {
    return {
      issues: collectEsiIssues(text, {
        // Per file, never cached here (projectIndexCache owns the cache).
        index: getActiveProjectIndex(),
        csvLookup: createCsvCellLookup(uri.fsPath),
        macroResolver: createMacroResolver(scriptLike, (fullPath) =>
          includes.set(includeIdentity(fullPath), fullPath)
        ),
      }),
      includes,
    };
  } catch (err) {
    // A check that throws means the file was NOT validated — say so rather
    // than let it pass as clean.
    return { error: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function registerValidateWorkspace(): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  // Files of the last run (uri string -> uri); empty once cleared.
  const covered = new Map<string, vscode.Uri>();
  // Covered file (uri string) -> the files its check read through includes
  // (includeIdentity -> full path): its %MACRO% results depend on their text
  // too.
  const includesOf = new Map<string, Map<string, string>>();
  // Per covered file (uri string): the number of its latest re-check. An
  // older one still reading must not overwrite what a newer one found.
  const recheckSeq = new Map<string, number>();
  // Bumped whenever results are invalidated; a run in flight notices and stops.
  let generation = 0;
  // Set on teardown: work still in flight then publishes and watches nothing.
  let disposed = false;
  let running = false;
  // Why the results were last invalidated: what a run that stopped says.
  let clearReason: "cleared" | "configChanged" = "cleared";

  const clear = (reason: "cleared" | "configChanged" = "cleared"): void => {
    clearReason = reason;
    generation++;
    covered.clear();
    includesOf.clear();
    recheckSeq.clear();
    changedIds.clear();
    collection.clear();
    watchOutside();
  };

  const isLive = (doc: vscode.TextDocument | undefined): boolean =>
    !!doc && doc.languageId === "esi";

  /** Publish one file's result, leaving live-validated documents alone. */
  const publish = (uri: vscode.Uri, issues: EsiIssue[], live: boolean): void => {
    if (live || issues.length === 0) {
      collection.delete(uri);
    } else {
      collection.set(uri, issues.map(toDiagnostic));
    }
  };

  /** Re-check one file of the last run from disk (closed / changed on disk). */
  const recheck = async (uri: vscode.Uri, fromDisk: boolean): Promise<void> => {
    const mine = generation;
    const key = uri.toString();
    const seq = (recheckSeq.get(key) ?? 0) + 1;
    recheckSeq.set(key, seq);
    const open = fromDisk ? undefined : findOpenDocument(uri);
    const result = await checkFile(uri, open);
    if (disposed || mine !== generation || !covered.has(key) || recheckSeq.get(key) !== seq) {
      return;
    }
    if ("includes" in result) {
      const before = includesOf.get(key);
      includesOf.set(key, result.includes);
      // Rarely changes; when it does, one sync for the whole burst — each one
      // walks every covered file's includes.
      if (!sameIncludeKeys(before, result.includes)) {
        watchOutsideSoon();
      }
    }
    // Re-read the open state: the file may have been (re)opened as esi while
    // it was being read, and then the live collection owns it.
    publish(uri, "issues" in result ? result.issues : [], isLive(findOpenDocument(uri)));
  };

  const run = async (): Promise<void> => {
    if (running) {
      void vscode.window.showInformationMessage(
        "Workspace validation is already running."
      );
      return;
    }
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
    }
  };

  const runOnce = async (): Promise<void> => {
    const outcomes: FileOutcome[] = [];
    let totalFiles = 0;
    let cancelled = false;
    let invalidated = false;
    let hasIndex = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Validating .esi files",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: "finding files…" });
        // `exclude` left undefined = the default excludes, i.e. files.exclude.
        const found = await vscode.workspace.findFiles(ESI_GLOB, undefined, undefined, token);
        if (token.isCancellationRequested) {
          cancelled = true;
          return;
        }
        const uris = found.slice().sort((a, b) => (a.fsPath < b.fsPath ? -1 : a.fsPath > b.fsPath ? 1 : 0));
        totalFiles = uris.length;

        // Fresh run: drop the previous one's results.
        clear();
        const mine = generation;
        hasIndex = getActiveProjectIndex() !== undefined;

        for (let i = 0; i < uris.length; i++) {
          // Let the UI breathe (progress repaint, Cancel click, index events).
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (mine !== generation) {
            invalidated = true;
            return;
          }
          if (token.isCancellationRequested) {
            cancelled = true;
            return;
          }
          const uri = uris[i];
          progress.report({
            message: progressLabel(i + 1, uris.length, path.basename(uri.fsPath)),
            increment: 100 / uris.length,
          });
          const open = findOpenDocument(uri);
          const result = await checkFile(uri, open);
          if (disposed) {
            return;
          }
          if (mine !== generation) {
            invalidated = true;
            return;
          }
          if ("error" in result) {
            outcomes.push(unreadableFile(uri.fsPath, result.error));
            continue;
          }
          covered.set(uri.toString(), uri);
          includesOf.set(uri.toString(), result.includes);
          // Re-read the open state, as recheck does: the file may have been
          // opened as esi while it was read, and the live collection owns it.
          publish(uri, result.issues, isLive(findOpenDocument(uri)));
          outcomes.push(checkedFile(uri.fsPath, result.issues));
        }
      }
    );
    if (disposed) {
      return;
    }
    // Once per run rather than per file: the union of every covered file's
    // includes.
    watchOutside();

    if (invalidated) {
      void vscode.window.showWarningMessage(
        clearReason === "cleared"
          ? "Workspace validation stopped: its results were cleared."
          : "Workspace validation stopped: the active TestPit configuration changed while it was running. Run it again."
      );
      return;
    }

    const summary = summarizeWorkspace(outcomes, {
      totalFiles,
      cancelled,
      hasIndex,
      profile: getActiveProfileName(),
    });
    const channel = getOutputChannel();
    for (const line of formatReport(outcomes, summary)) {
      channel.appendLine(line);
    }

    const { level, message } = formatSummary(summary);
    const actions = totalFiles > 0 ? [ACTION_SHOW, ACTION_CLEAR] : [];
    const show =
      level === "error"
        ? vscode.window.showErrorMessage
        : level === "warning"
          ? vscode.window.showWarningMessage
          : vscode.window.showInformationMessage;
    const mine = generation;
    // Not awaited: the notification settles only when a button is clicked or
    // it is closed (one that times out moves to the Notification Center and
    // stays open). Awaited, the run would count as "already running" until
    // then.
    void show(message, ...actions).then((choice) => {
      if (choice === ACTION_SHOW) {
        void vscode.commands.executeCommand("workbench.actions.view.problems");
      } else if (choice === ACTION_CLEAR && mine === generation) {
        // (An old notification must not clear a newer run's results.)
        clear();
      }
    });
  };

  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (isLive(doc)) {
      collection.delete(doc.uri);
    }
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    if (covered.has(doc.uri.toString())) {
      void recheck(doc.uri, true);
    }
    // A covered file's check reads an include from its editor while it is
    // open: with the buffer gone (unsaved edits too), the disk counts again.
    recheckIncluders(doc.uri);
  });
  const onEdit = vscode.workspace.onDidChangeTextDocument((event) => {
    // Back to its text on disk (File: Revert, undo to the saved state, a
    // save): what a covered file read from this buffer may be out of date.
    // Not per keystroke — a dirty buffer is followed again once it is saved,
    // reverted or closed.
    if (!event.document.isDirty) {
      recheckIncluders(event.document.uri);
    }
  });

  // Included files changed since the last includer pass (includeIdentity).
  const changedIds = new Set<string>();
  let includerTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * A file changed: re-check (debounced, as the live check does) the covered
   * files that include it — each once per burst, however many of its
   * includes changed (a checkout rewriting the shared utility scripts).
   */
  const recheckIncluders = (uri: vscode.Uri): void => {
    if (uri.scheme !== "file" || includesOf.size === 0) {
      return;
    }
    const id = includeIdentity(path.resolve(uri.fsPath));
    // Only a file some covered file includes: any other change must not keep
    // pushing the pass back — the debounce restarts on every call.
    if (!Array.from(includesOf.values()).some((includes) => includes.has(id))) {
      return;
    }
    changedIds.add(id);
    if (includerTimer) {
      clearTimeout(includerTimer);
    }
    includerTimer = setTimeout(() => {
      includerTimer = undefined;
      const ids = Array.from(changedIds);
      changedIds.clear();
      for (const [key, includes] of includesOf) {
        const includer = covered.get(key);
        if (!includer) {
          continue;
        }
        // Also a covered file that changed itself in the burst: its own
        // re-check read its includes as they were then. Not for naming
        // itself, though.
        const own = includeIdentity(path.resolve(includer.fsPath));
        if (ids.some((id) => id !== own && includes.has(id))) {
          void recheck(includer, false);
        }
      }
    }, INCLUDER_DELAY_MS);
  };

  // Keep the snapshot honest when a covered file — or a file one of them
  // includes — changes on disk.
  const onDiskChange = (uri: vscode.Uri): void => {
    if (covered.has(uri.toString())) {
      void recheck(uri, false);
    }
    recheckIncluders(uri);
  };
  const onDiskDelete = (uri: vscode.Uri): void => {
    if (covered.delete(uri.toString())) {
      recheckSeq.delete(uri.toString());
      if (includesOf.delete(uri.toString())) {
        watchOutsideSoon();
      }
      collection.delete(uri);
    }
    recheckIncluders(uri);
  };
  const wire = (watcher: vscode.FileSystemWatcher): vscode.Disposable[] => [
    watcher.onDidChange(onDiskChange),
    // A created file may resolve an include that could not be read before.
    watcher.onDidCreate(recheckIncluders),
    watcher.onDidDelete(onDiskDelete),
  ];
  const watcher = vscode.workspace.createFileSystemWatcher(ESI_GLOB);
  const onDisk = wire(watcher);
  // Included files outside the workspace folders, which `watcher` does not
  // see.
  const outside = createOutsideIncludeWatchers(wire);
  // One sync for a batch of events (VS Code delivers a branch switch's
  // deletes together): watchOutside walks every covered file's includes.
  let outsideTimer: ReturnType<typeof setTimeout> | undefined;
  function watchOutside(): void {
    if (outsideTimer) {
      clearTimeout(outsideTimer);
      outsideTimer = undefined;
    }
    outside.update(
      Array.from(includesOf.values()).flatMap((includes) => Array.from(includes.values()))
    );
  }
  function watchOutsideSoon(): void {
    outsideTimer ??= setTimeout(watchOutside, 0);
  }
  const onFolders = vscode.workspace.onDidChangeWorkspaceFolders(() => watchOutside());

  // Results were computed against the old index (profile switch, registry
  // reload, config XML edited): showing them on would be misleading, and
  // re-running the whole workspace unasked is not this command's call.
  const onIndexChange = onIndexChanged(() => {
    if (covered.size > 0 || running) {
      clear("configChanged");
      getOutputChannel().appendLine(
        "[validate-workspace] results cleared: the active TestPit configuration changed — run the command again"
      );
    }
  });

  return vscode.Disposable.from(
    collection,
    vscode.commands.registerCommand(VALIDATE_WORKSPACE_COMMAND, run),
    vscode.commands.registerCommand(CLEAR_WORKSPACE_VALIDATION_COMMAND, () =>
      clear("cleared")
    ),
    onOpen,
    onClose,
    onEdit,
    watcher,
    ...onDisk,
    outside,
    onFolders,
    onIndexChange,
    {
      dispose: () => {
        disposed = true;
        if (includerTimer) {
          clearTimeout(includerTimer);
          includerTimer = undefined;
        }
        if (outsideTimer) {
          clearTimeout(outsideTimer);
          outsideTimer = undefined;
        }
      },
    }
  );
}
