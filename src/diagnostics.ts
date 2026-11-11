import * as vscode from "vscode";
import { parseValidityOutput, type ValidityIssue } from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";
import { toDiagnostic } from "./lib/toDiagnostic";
import { withTempScript } from "./lib/withTempScript";
import { createRunTracker, createVersionGate } from "./lib/validityResults";
import { createValidityScheduler } from "./lib/validityScheduler";
import {
  LIVE_VALIDATION_DELAY_KEY,
  LIVE_VALIDATION_KEY,
  normalizeLiveValidation,
  normalizeLiveValidationDelay,
} from "./lib/liveValidationSettings";
import {
  getActiveConfigs,
  getTestpitExe,
  onActiveProfileChanged,
} from "./lib/profileRegistry";
import { CONFIG_SECTION } from "./constants";
import { buildValidityCommand } from "./profiles";

// TestPit.exe diagnostics (heavy: one process per run). ONE collection for all
// files, fed by both the live check and the "Run Validity Check" command. It
// is separate from the in-process "esi-components" collection.
const COLLECTION_NAME = "esi-testpit";

let collection: vscode.DiagnosticCollection | undefined;
/** Set on teardown: a run still in flight then must not publish anything. */
let disposed = false;
const versionGate = createVersionGate<string>();
const scheduler = createValidityScheduler<string>({
  // Quiet period after the last keystroke before TestPit.exe is started.
  delayMs: getLiveValidationDelay,
  run: runLiveCheck,
  onError: (error) => console.error("Error in live TestPit validity check:", error),
});

/** A TestPit.exe run for a document started (`running`) or ended. */
export interface ValidityRunEvent {
  uri: vscode.Uri;
  running: boolean;
}

const runEmitter = new vscode.EventEmitter<ValidityRunEvent>();
const runUris = new Map<string, vscode.Uri>();
const runTracker = createRunTracker<string>((key, running) => {
  const uri = runUris.get(key);
  if (!running) {
    runUris.delete(key);
  }
  if (uri) {
    runEmitter.fire({ uri, running });
  }
});

/**
 * Fires when TestPit.exe starts or stops running for a document — live check
 * and the "Run Validity Check" command alike. The end event comes after the
 * diagnostics of that run were published (or discarded).
 */
export const onDidChangeValidityRun: vscode.Event<ValidityRunEvent> =
  runEmitter.event;

/** True while TestPit.exe is running for this document. */
export function isValidityRunning(uri: vscode.Uri): boolean {
  return runTracker.isRunning(uri.toString());
}

/** `esihelper.liveValidation`: false turns the live TestPit.exe check off. */
export function isLiveValidationEnabled(): boolean {
  return normalizeLiveValidation(
    vscode.workspace.getConfiguration(CONFIG_SECTION).get(LIVE_VALIDATION_KEY)
  );
}

function getLiveValidationDelay(): number {
  return normalizeLiveValidationDelay(
    vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get(LIVE_VALIDATION_DELAY_KEY)
  );
}

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
    // Other config files / flags now apply: results shown were produced with
    // the previous profile. Fired by a profile switch and a registry reload.
    onActiveProfileChanged(() => scheduleOpenDocuments()),
    vscode.workspace.onDidChangeConfiguration(handleConfigurationChange),
    {
      dispose: () => {
        disposed = true;
        scheduler.cancelAll();
        runTracker.clear();
        runUris.clear();
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
  if (!isLiveValidationEnabled() || !getTestpitExe()) {
    return;
  }
  scheduler.schedule(document.uri.toString());
}

/**
 * Queue a live check for every open .esi document, through the same debounce
 * as typing (so a burst of profile events yields one run per document, and a
 * run in flight is followed by exactly one more). Never prompts.
 */
function scheduleOpenDocuments(): void {
  if (disposed || !isLiveValidationEnabled() || !getTestpitExe()) {
    return;
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "esi" && !document.isClosed) {
      scheduler.schedule(document.uri.toString());
    }
  }
}

function handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
  if (!event?.affectsConfiguration?.(`${CONFIG_SECTION}.${LIVE_VALIDATION_KEY}`)) {
    return;
  }
  if (isLiveValidationEnabled()) {
    scheduleOpenDocuments();
  } else {
    // Drop debounced live runs. A run in flight finishes; explicit
    // "Run Validity Check" runs are unaffected by the setting.
    scheduler.cancelAll();
  }
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
  // Re-checked here: the setting may have been turned off during the debounce.
  const exe = getTestpitExe();
  if (!exe || !isLiveValidationEnabled()) {
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
  const key = document.uri.toString();
  runUris.set(key, document.uri);
  runTracker.begin(key);
  try {
    return await withTempScript(document.uri.fsPath, text, async (tempPath) => {
      const command = buildValidityCommand(exe, tempPath, getActiveConfigs());
      hooks?.onCommand?.(command);
      const output = await runValidityCheckAsync(command);
      const issues = parseValidityOutput(output, text.split(/\r?\n/));
      const published = publish(document, version, issues);
      return { command, output, issues, published };
    });
  } finally {
    runTracker.end(key);
  }
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
