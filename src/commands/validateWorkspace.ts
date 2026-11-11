import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { toDiagnostic } from "../componentDiagnostics";
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
import { createMacroResolver } from "../providers/macroResolver";

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

type CheckResult = { issues: EsiIssue[] } | { error: string };

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
  try {
    return {
      issues: collectEsiIssues(text, {
        // Per file, never cached here (projectIndexCache owns the cache).
        index: getActiveProjectIndex(),
        csvLookup: createCsvCellLookup(uri.fsPath),
        macroResolver: createMacroResolver(scriptLike),
      }),
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
  // Bumped whenever results are invalidated; a run in flight notices and stops.
  let generation = 0;
  let running = false;

  const clear = (): void => {
    generation++;
    covered.clear();
    collection.clear();
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
    const open = fromDisk ? undefined : findOpenDocument(uri);
    const result = await checkFile(uri, open);
    if (mine !== generation || !covered.has(uri.toString())) {
      return;
    }
    publish(uri, "issues" in result ? result.issues : [], isLive(open));
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
          if (mine !== generation) {
            invalidated = true;
            return;
          }
          if ("error" in result) {
            outcomes.push(unreadableFile(uri.fsPath, result.error));
            continue;
          }
          covered.set(uri.toString(), uri);
          publish(uri, result.issues, isLive(open));
          outcomes.push(checkedFile(uri.fsPath, result.issues));
        }
      }
    );

    if (invalidated) {
      void vscode.window.showWarningMessage(
        "Workspace validation stopped: the active TestPit configuration changed while it was running. Run it again."
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
    const choice = await show(message, ...actions);
    if (choice === ACTION_SHOW) {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
    } else if (choice === ACTION_CLEAR && mine === generation) {
      // (An old notification must not clear a newer run's results.)
      clear();
    }
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
  });

  // Keep the snapshot honest when a covered file changes on disk.
  const watcher = vscode.workspace.createFileSystemWatcher(ESI_GLOB);
  const onDiskChange = watcher.onDidChange((uri) => {
    if (covered.has(uri.toString())) {
      void recheck(uri, false);
    }
  });
  const onDiskDelete = watcher.onDidDelete((uri) => {
    if (covered.delete(uri.toString())) {
      collection.delete(uri);
    }
  });

  // Results were computed against the old index (profile switch, registry
  // reload, config XML edited): showing them on would be misleading, and
  // re-running the whole workspace unasked is not this command's call.
  const onIndexChange = onIndexChanged(() => {
    if (covered.size > 0 || running) {
      clear();
      getOutputChannel().appendLine(
        "[validate-workspace] results cleared: the active TestPit configuration changed — run the command again"
      );
    }
  });

  return vscode.Disposable.from(
    collection,
    vscode.commands.registerCommand(VALIDATE_WORKSPACE_COMMAND, run),
    vscode.commands.registerCommand(CLEAR_WORKSPACE_VALIDATION_COMMAND, clear),
    onOpen,
    onClose,
    watcher,
    onDiskChange,
    onDiskDelete,
    onIndexChange
  );
}
