import * as vscode from "vscode";
import { parseValidityOutput, type ValidityIssue } from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";
import { toDiagnostic } from "./lib/toDiagnostic";
import { withTempScript } from "./lib/withTempScript";
import { createVersionGate } from "./lib/validityResults";
import { createValidityScheduler } from "./lib/validityScheduler";
import { getActiveConfigs, getTestpitExe } from "./lib/profileRegistry";
import { buildValidityCommand } from "./profiles";

// TestPit.exe diagnostics (heavy: one process per run). ONE collection for all
// files, fed by both the live check and the "Run Validity Check" command. It
// is separate from the in-process "esi-components" collection.
const COLLECTION_NAME = "esi-testpit";

/** Quiet period after the last keystroke before TestPit.exe is started. */
const LIVE_DEBOUNCE_MS = 600;

let collection: vscode.DiagnosticCollection | undefined;
/** Set on teardown: a run still in flight then must not publish anything. */
let disposed = false;
const versionGate = createVersionGate<string>();
const scheduler = createValidityScheduler<string>({
  delayMs: LIVE_DEBOUNCE_MS,
  run: runLiveCheck,
  onError: (error) => console.error("Error in live TestPit validity check:", error),
});

export interface ValidityRunHooks {
  /** Called with the exact command line just before TestPit.exe starts. */
  onCommand?: (command: string) => void;
}

export interface ValidityRunResult {
  command: string;
  /** Raw stdout+stderr of TestPit.exe. */
  output: string;
  issues: ValidityIssue[];
  /** False when a newer result was already shown, or the document was closed. */
  published: boolean;
}

export function registerLiveDiagnostics(): vscode.Disposable {
  disposed = false;
  return vscode.Disposable.from(
    vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
    vscode.workspace.onDidCloseTextDocument(handleDocumentClose),
    {
      dispose: () => {
        disposed = true;
        scheduler.cancelAll();
        collection?.dispose();
        collection = undefined;
      },
    }
  );
}

/**
 * Explicit validity run (the "Run Validity Check" command). Shares the queue
 * and the diagnostic collection with the live check: it never overlaps a live
 * run of the same document and its issues land in the same place.
 */
export function runValidityCheckForDocument(
  document: vscode.TextDocument,
  exe: string,
  hooks?: ValidityRunHooks
): Promise<ValidityRunResult> {
  return scheduler.runExclusive(document.uri.toString(), () =>
    validateDocument(document, exe, hooks)
  );
}

function handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
  const document = event?.document;
  // Only .esi buffers: other documents (incl. our own output channel) also
  // raise this event, and validating them would leave orphan .temp files.
  if (!document || document.languageId !== "esi") {
    return;
  }
  // Fired without changes when only the dirty state flips (e.g. on save).
  if (event.contentChanges && event.contentChanges.length === 0) {
    return;
  }
  // Live path: never prompt for the exe — silently skip if it isn't
  // configured yet. The explicit "Run Validity Check" command prompts via
  // ensureTestpitExe instead.
  if (!getTestpitExe()) {
    return;
  }
  scheduler.schedule(document.uri.toString());
}

function handleDocumentClose(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  scheduler.cancel(key);
  versionGate.forget(key);
  collection?.delete(document.uri);
}

async function runLiveCheck(key: string): Promise<void> {
  const document = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === key
  );
  if (!document || document.languageId !== "esi") {
    return;
  }
  const exe = getTestpitExe();
  if (!exe) {
    return;
  }
  await validateDocument(document, exe);
}

async function validateDocument(
  document: vscode.TextDocument,
  exe: string,
  hooks?: ValidityRunHooks
): Promise<ValidityRunResult> {
  // Text and version are captured together, before the (slow) run.
  const version = document.version;
  const text = document.getText();
  return withTempScript(document.uri.fsPath, text, async (tempPath) => {
    const command = buildValidityCommand(exe, tempPath, getActiveConfigs());
    hooks?.onCommand?.(command);
    const output = await runValidityCheckAsync(command);
    const issues = parseValidityOutput(output, text.split(/\r?\n/));
    const published = publish(document, version, issues);
    return { command, output, issues, published };
  });
}

function publish(
  document: vscode.TextDocument,
  version: number,
  issues: ValidityIssue[]
): boolean {
  // Closed while TestPit was running: its diagnostics were cleared on close.
  // Disposed likewise: publishing would re-create a collection nobody disposes.
  if (disposed || document.isClosed) {
    return false;
  }
  if (!versionGate.accept(document.uri.toString(), version)) {
    return false;
  }
  collection ??= vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  collection.set(document.uri, issues.map(toDiagnostic));
  return true;
}
