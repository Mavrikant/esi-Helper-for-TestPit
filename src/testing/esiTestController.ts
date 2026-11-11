import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runValidityCheckForDocument } from "../diagnostics";
import type { ValidityIssue } from "../lib/parseValidityOutput";
import { getTestpitExe } from "../lib/profileRegistry";
import {
  CONTROLLER_LABEL,
  DiscoveredStep,
  NO_EXE_MESSAGE,
  RUN_DISCLAIMER,
  RUN_NAME,
  VALIDATE_PROFILE_LABEL,
  discoverSteps,
  formatIssue,
  mapValidityToSteps,
} from "../lib/testDiscovery";
import { summarizeValidity } from "../lib/validityResults";

// Test Explorer integration. Every .esi file of the workspace is a top-level
// item, its `[STEP <id>]` blocks are the children.
//
// There is exactly ONE run profile and it only VALIDATES: the extension can
// run TestPit's validity check headlessly (profiles.ts buildValidityCommand)
// but cannot execute a test. A green item therefore means "TestPit reported no
// error for this text" — see the wording in lib/testDiscovery.ts.
//
// The run goes through diagnostics.ts runValidityCheckForDocument, i.e. the
// same per-document queue, temp file and "esi-testpit" diagnostic collection
// as the live check and the "Run Validity Check" command. It never prompts:
// without a TestPit.exe the requested items are reported as skipped.

export const ESI_TEST_CONTROLLER_ID = "esihelper.testpitValidity";

const ESI_GLOB = "**/*.esi";
const STEP_ID_SEPARATOR = "::";
const DEFAULT_REPARSE_DELAY_MS = 300;

/** What a run needs from the rest of the extension (replaceable in tests). */
export interface EsiTestControllerDeps {
  /** The configured TestPit.exe, or undefined. Must never prompt. */
  getExe(): string | undefined;
  /** Run TestPit's validity check on a document. */
  validate(
    document: vscode.TextDocument,
    exe: string
  ): Promise<{ output: string; issues: ValidityIssue[] }>;
  /** Quiet period before an edited document's steps are re-listed. */
  reparseDelayMs?: number;
}

const DEFAULT_DEPS: EsiTestControllerDeps = {
  getExe: getTestpitExe,
  validate: (document, exe) => runValidityCheckForDocument(document, exe),
};

function isEsiFile(document: vscode.TextDocument): boolean {
  return document.languageId === "esi" && document.uri.scheme === "file";
}

function fileLabel(uri: vscode.Uri): string {
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative && relative !== uri.fsPath ? relative : path.basename(uri.fsPath);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Test output wants CRLF line ends. */
function outputLines(text: string): string {
  return text.split(/\r?\n/).join("\r\n");
}

export function registerEsiTestController(
  deps: EsiTestControllerDeps = DEFAULT_DEPS
): vscode.Disposable {
  const controller = vscode.tests.createTestController(
    ESI_TEST_CONTROLLER_ID,
    CONTROLLER_LABEL
  );
  /** File items whose steps were listed at least once (ids = uri strings). */
  const resolved = new Set<string>();
  const reparseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** True once the workspace was searched: only then do new files get items. */
  let discovered = false;
  let disposed = false;

  const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined => {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === key && isEsiFile(doc)
    );
  };

  const getOrCreateFile = (uri: vscode.Uri): vscode.TestItem => {
    const id = uri.toString();
    const existing = controller.items.get(id);
    if (existing) {
      return existing;
    }
    const item = controller.createTestItem(id, fileLabel(uri), uri);
    item.canResolveChildren = true;
    controller.items.add(item);
    return item;
  };

  const removeFile = (uri: vscode.Uri): void => {
    const id = uri.toString();
    resolved.delete(id);
    controller.items.delete(id);
  };

  const stepItemId = (file: vscode.TestItem, step: DiscoveredStep): string =>
    file.id + STEP_ID_SEPARATOR + step.id;

  /** Make the children of `file` mirror `steps`, updating items in place. */
  const syncSteps = (file: vscode.TestItem, steps: readonly DiscoveredStep[]): void => {
    const wanted = new Set(steps.map((step) => stepItemId(file, step)));
    const stale: string[] = [];
    file.children.forEach((child) => {
      if (!wanted.has(child.id)) {
        stale.push(child.id);
      }
    });
    stale.forEach((id) => file.children.delete(id));

    steps.forEach((step, index) => {
      const id = stepItemId(file, step);
      let child = file.children.get(id);
      if (!child) {
        child = controller.createTestItem(id, step.label, file.uri);
        file.children.add(child);
      }
      child.description = step.description || undefined;
      child.sortText = String(index).padStart(6, "0");
      // The range is what puts the gutter icon on the step's opening tag.
      child.range = new vscode.Range(step.line, 0, step.endLine, 0);
    });
    resolved.add(file.id);
  };

  /** List a file's steps from its open buffer, or from disk. */
  const resolveFile = async (file: vscode.TestItem): Promise<void> => {
    const uri = file.uri;
    if (!uri) {
      return;
    }
    const open = findOpenDocument(uri);
    if (open) {
      file.error = undefined;
      syncSteps(file, discoverSteps(open.getText()));
      return;
    }
    try {
      const raw = await fs.promises.readFile(uri.fsPath, "utf-8");
      if (disposed) {
        return;
      }
      // A file on disk may start with a BOM; an editor buffer never does.
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      file.error = undefined;
      syncSteps(file, discoverSteps(text));
    } catch (err) {
      file.error = `Could not read the script: ${errorText(err)}`;
    }
  };

  const discoverWorkspace = async (): Promise<void> => {
    // `exclude` left undefined = the default excludes, i.e. files.exclude.
    const found = await vscode.workspace.findFiles(ESI_GLOB);
    if (disposed) {
      return;
    }
    const keep = new Set<string>();
    for (const uri of found) {
      keep.add(uri.toString());
      getOrCreateFile(uri);
    }
    // Drop items whose file is gone — but not a script that is open in an
    // editor (it may live outside the workspace folders).
    const gone: vscode.Uri[] = [];
    controller.items.forEach((item) => {
      if (!keep.has(item.id) && item.uri && !findOpenDocument(item.uri)) {
        gone.push(item.uri);
      }
    });
    gone.forEach(removeFile);
    discovered = true;
  };

  controller.resolveHandler = async (item) => {
    if (!item) {
      await discoverWorkspace();
    } else if (!item.parent) {
      await resolveFile(item);
    }
  };

  controller.refreshHandler = async () => {
    await discoverWorkspace();
    const pending: Promise<void>[] = [];
    controller.items.forEach((item) => {
      if (resolved.has(item.id)) {
        pending.push(resolveFile(item));
      }
    });
    await Promise.all(pending);
  };

  // ---- keeping items in step with editors and the disk ---------------------

  /** An open script always has an item with its steps: gutter icons need it. */
  const trackDocument = (document: vscode.TextDocument): void => {
    if (!isEsiFile(document)) {
      return;
    }
    const file = getOrCreateFile(document.uri);
    file.error = undefined;
    syncSteps(file, discoverSteps(document.getText()));
  };

  const cancelReparse = (key: string): void => {
    const timer = reparseTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      reparseTimers.delete(key);
    }
  };

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event?.document;
    if (!document || !isEsiFile(document)) {
      return;
    }
    const key = document.uri.toString();
    cancelReparse(key);
    reparseTimers.set(
      key,
      setTimeout(() => {
        reparseTimers.delete(key);
        if (!disposed && !document.isClosed) {
          trackDocument(document);
        }
      }, deps.reparseDelayMs ?? DEFAULT_REPARSE_DELAY_MS)
    );
  });

  const onOpen = vscode.workspace.onDidOpenTextDocument(trackDocument);

  const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isEsiFile(document)) {
      return;
    }
    const key = document.uri.toString();
    cancelReparse(key);
    // The buffer (and any unsaved edit) is gone: show what is on disk.
    const file = controller.items.get(key);
    if (file && resolved.has(key)) {
      void resolveFile(file);
    }
  });

  const watcher = vscode.workspace.createFileSystemWatcher(ESI_GLOB);
  const onDiskCreate = watcher.onDidCreate((uri) => {
    if (discovered) {
      getOrCreateFile(uri);
    }
  });
  const onDiskChange = watcher.onDidChange((uri) => {
    const file = controller.items.get(uri.toString());
    // An open document is tracked through its buffer instead.
    if (file && resolved.has(file.id) && !findOpenDocument(uri)) {
      void resolveFile(file);
    }
  });
  const onDiskDelete = watcher.onDidDelete(removeFile);

  for (const document of vscode.workspace.textDocuments) {
    trackDocument(document);
  }

  // ---- the validity run ----------------------------------------------------

  /** Requested script → "all" (script and every step) or the step item ids. */
  type Targets = Map<vscode.TestItem, "all" | Set<string>>;

  const collectTargets = (request: vscode.TestRunRequest): Targets => {
    const excluded = new Set((request.exclude ?? []).map((item) => item.id));
    const targets: Targets = new Map();
    const include: vscode.TestItem[] = [];
    if (request.include) {
      include.push(...request.include);
    } else {
      controller.items.forEach((item) => include.push(item));
    }
    for (const item of include) {
      if (excluded.has(item.id)) {
        continue;
      }
      const file = item.parent;
      if (!file) {
        targets.set(item, "all");
        continue;
      }
      if (excluded.has(file.id)) {
        continue;
      }
      const current = targets.get(file);
      if (current === "all") {
        continue;
      }
      if (current) {
        current.add(item.id);
      } else {
        targets.set(file, new Set([item.id]));
      }
    }
    return targets;
  };

  const locationOf = (uri: vscode.Uri, issue: ValidityIssue): vscode.Location =>
    new vscode.Location(
      uri,
      new vscode.Range(issue.lineNumber, issue.startCol, issue.lineNumber, issue.endCol)
    );

  const toMessage = (uri: vscode.Uri, issue: ValidityIssue): vscode.TestMessage => {
    const message = new vscode.TestMessage(formatIssue(issue));
    message.location = locationOf(uri, issue);
    return message;
  };

  const validateFile = async (
    run: vscode.TestRun,
    file: vscode.TestItem,
    wanted: "all" | Set<string>,
    exe: string,
    excluded: ReadonlySet<string>
  ): Promise<void> => {
    const uri = file.uri;
    if (!uri) {
      return;
    }
    run.started(file);

    let document: vscode.TextDocument;
    try {
      // A TextDocument, not an editor: nothing is shown. An already open
      // script is validated from its buffer, unsaved edits included.
      document = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      run.errored(
        file,
        new vscode.TestMessage(`Not validated - could not open the script: ${errorText(err)}`)
      );
      return;
    }

    const versionBefore = document.version;
    const steps = discoverSteps(document.getText());
    syncSteps(file, steps);
    const requested = (step: DiscoveredStep): vscode.TestItem | undefined => {
      const child = file.children.get(stepItemId(file, step));
      if (!child || excluded.has(child.id)) {
        return undefined;
      }
      return wanted === "all" || wanted.has(child.id) ? child : undefined;
    };
    for (const step of steps) {
      const child = requested(step);
      if (child) {
        run.started(child);
      }
    }

    let result: { output: string; issues: ValidityIssue[] };
    try {
      result = await deps.validate(document, exe);
    } catch (err) {
      run.errored(
        file,
        new vscode.TestMessage(`Not validated - the TestPit validity check could not be run: ${errorText(err)}`)
      );
      for (const step of steps) {
        const child = requested(step);
        if (child) {
          run.skipped(child);
        }
      }
      return;
    }

    run.appendOutput(`--- ${uri.fsPath} ---\r\n`, undefined, file);
    run.appendOutput(outputLines(result.output) + "\r\n", undefined, file);
    if (document.version !== versionBefore) {
      run.appendOutput(
        "Note: the script was edited while TestPit was running; an issue may be shown against the wrong step.\r\n",
        undefined,
        file
      );
    }

    const verdict = summarizeValidity(result.output, result.issues);
    const outcome = mapValidityToSteps(steps, result.issues, verdict);

    // A passed item cannot carry messages, so warnings go to the run output,
    // located on their line and attributed to their item.
    const reportWarnings = (item: vscode.TestItem, warnings: readonly ValidityIssue[]): void => {
      for (const warning of warnings) {
        run.appendOutput(formatIssue(warning) + "\r\n", locationOf(uri, warning), item);
      }
    };

    reportWarnings(file, outcome.warnings);
    if (outcome.status === "notChecked") {
      // No validation log: the script was NOT checked. Never a pass.
      run.errored(file, new vscode.TestMessage(outcome.message));
    } else if (outcome.status === "failed") {
      run.failed(file, [
        new vscode.TestMessage(outcome.message),
        ...outcome.errors.map((issue) => toMessage(uri, issue)),
      ]);
    } else {
      run.passed(file);
    }

    steps.forEach((step, index) => {
      const child = requested(step);
      if (!child) {
        return;
      }
      const stepOutcome = outcome.steps[index];
      reportWarnings(child, stepOutcome.warnings);
      if (stepOutcome.status === "notChecked") {
        run.skipped(child);
      } else if (stepOutcome.status === "failed") {
        run.failed(
          child,
          stepOutcome.errors.map((issue) => toMessage(uri, issue))
        );
      } else {
        run.passed(child);
      }
    });
  };

  const runHandler = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> => {
    // "Validate all" before the Test Explorer ever listed the workspace.
    if (!request.include && !discovered) {
      await discoverWorkspace();
    }
    const run = controller.createTestRun(request, RUN_NAME);
    try {
      for (const line of RUN_DISCLAIMER) {
        run.appendOutput(line + "\r\n");
      }
      const targets = collectTargets(request);
      const excluded = new Set((request.exclude ?? []).map((item) => item.id));

      const exe = deps.getExe();
      if (!exe) {
        // Never a dialog from a test run: say what to do and skip everything.
        run.appendOutput(NO_EXE_MESSAGE + "\r\n");
        for (const [file, wanted] of targets) {
          if (wanted === "all") {
            run.skipped(file);
          }
          file.children.forEach((child) => {
            if (!excluded.has(child.id) && (wanted === "all" || wanted.has(child.id))) {
              run.skipped(child);
            }
          });
        }
        return;
      }

      for (const [file, wanted] of targets) {
        if (token.isCancellationRequested) {
          run.appendOutput("Cancelled - the remaining scripts were not validated.\r\n");
          break;
        }
        await validateFile(run, file, wanted, exe, excluded);
      }
    } finally {
      run.end();
    }
  };

  const profile = controller.createRunProfile(
    VALIDATE_PROFILE_LABEL,
    vscode.TestRunProfileKind.Run,
    runHandler,
    true
  );

  return vscode.Disposable.from(
    {
      dispose: () => {
        disposed = true;
        for (const timer of reparseTimers.values()) {
          clearTimeout(timer);
        }
        reparseTimers.clear();
      },
    },
    onChange,
    onOpen,
    onClose,
    watcher,
    onDiskCreate,
    onDiskChange,
    onDiskDelete,
    profile,
    controller
  );
}
