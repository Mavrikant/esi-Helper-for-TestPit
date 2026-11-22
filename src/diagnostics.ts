import { createHash } from "crypto";
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
  onDidChangeTestpitExe,
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
/**
 * Bumped on every profile switch / registry reload. A run started before one
 * used the previous profile's config files, so its result is not published.
 */
let profileGeneration = 0;
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
  /**
   * False: return the result without putting it in the Problems panel. For
   * a document no editor tab holds (Test Explorer): VS Code may dispose such
   * a document at any time, and closing it would remove its problems again.
   * It is published all the same if an editor shows the document by the time
   * TestPit is done; otherwise (live check on, an exe set) the live check
   * takes the script once an editor shows it, even after VS Code let go of
   * the document meanwhile (`checkOnShow`).
   */
  publish?: boolean;
}

export interface ValidityRunResult {
  command: string;
  /** Raw stdout+stderr of TestPit.exe. */
  output: string;
  issues: ValidityIssue[];
  /**
   * False when the result was not put in the Problems panel: a newer one was
   * already shown, the document was closed, the profile or the TestPit
   * executable changed during the run, the text of a document left for a
   * check on show (`notRechecked`) changed during it while no editor showed
   * it, or `hooks.publish` was false and no editor showed the document by
   * the end of the run.
   */
  published: boolean;
}

export function registerLiveDiagnostics(): vscode.Disposable {
  disposed = false;
  return vscode.Disposable.from(
    vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
    vscode.workspace.onDidCloseTextDocument(handleDocumentClose),
    // Other config files / flags now apply: results shown were produced with
    // the previous profile. Fired by a profile switch and a registry reload.
    onActiveProfileChanged(() => {
      profileGeneration++;
      scheduleOpenDocuments(true);
    }),
    // TestPit.exe picked (or repointed): the shown documents can be checked.
    onDidChangeTestpitExe(() => scheduleOpenDocuments(false)),
    // A document that was in the background then is checked when it is
    // shown again.
    vscode.window.onDidChangeVisibleTextEditors((editors) =>
      scheduleUncheckedVisible(editors)
    ),
    vscode.workspace.onDidChangeConfiguration(handleConfigurationChange),
    {
      dispose: () => {
        disposed = true;
        scheduler.cancelAll();
        runTracker.clear();
        runUris.clear();
        notRechecked.clear();
        checkOnShow.clear();
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

/**
 * Live validation is for on-disk .esi documents only. An untitled one has no
 * folder for the temp copy (its relative includes could not resolve), and a
 * virtual document (`git:` side of a diff, …) is a snapshot nobody types
 * into — the explicit "Run Validity Check" still takes it.
 */
export function isLiveTarget(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  return (
    !!document &&
    document.languageId === "esi" &&
    document.uri.scheme === "file" &&
    !document.isClosed
  );
}

function handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
  const document = event?.document;
  // Only .esi buffers: other documents (incl. our own output channel) also
  // raise this event, and validating them would leave orphan .temp files.
  if (!isLiveTarget(document)) {
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
  const key = document.uri.toString();
  if (!isVisible(key)) {
    // Changed without an editor showing it: reloaded from disk (git checkout,
    // pull, stash, Discard All…), Replace All, a multi-file edit. Each such
    // event would start a TestPit.exe at the same moment — the scheduler
    // serializes runs per document only. Its shown results no longer match
    // its text; it is checked when it is shown again (or edited there).
    collection?.delete(document.uri);
    notRechecked.add(key);
    return;
  }
  scheduler.schedule(key);
}

function isVisible(key: string): boolean {
  return vscode.window.visibleTextEditors.some(
    (editor) => editor.document.uri.toString() === key
  );
}

/**
 * Queue a live check for every .esi document shown in an editor, through the
 * same debounce as typing (so a burst of profile events yields one run per
 * document, and a run in flight is followed by exactly one more). Never
 * prompts.
 *
 * Only VISIBLE documents are re-run: `workspace.textDocuments` also holds
 * background documents (e.g. every script a Test Explorer run opened), and
 * the scheduler serializes runs per document only — re-running all of them
 * would start one TestPit.exe (and write one `.temp` file) per document at
 * the same moment. The other documents are checked when they are shown again
 * (or on their next edit); after a profile change their TestPit results were
 * produced with the previous profile, so those are dropped meanwhile.
 */
function scheduleOpenDocuments(profileChanged: boolean): void {
  if (disposed || !isLiveValidationEnabled() || !getTestpitExe()) {
    return;
  }
  for (const document of vscode.workspace.textDocuments) {
    if (!isLiveTarget(document)) {
      continue;
    }
    const key = document.uri.toString();
    if (isVisible(key)) {
      scheduler.schedule(key);
    } else {
      if (profileChanged) {
        collection?.delete(document.uri);
      }
      notRechecked.add(key);
    }
  }
}

/**
 * Background documents whose check scheduleOpenDocuments or
 * handleDocumentChange put off until they are shown again. Results shown for
 * them that went stale (other profile, other text) were dropped, and while
 * no editor shows them only a result for their current text is published
 * for them (see publish). A mark goes with its document (on close).
 */
const notRechecked = new Set<string>();

/**
 * Scripts validated without publishing (checkWhenShown), by uri: checked
 * once an editor shows them. Unlike a notRechecked mark, this one outlives
 * the document — VS Code lets go of a document the extension opened within
 * minutes (or once some fifty others were opened after it), and opening the
 * script later makes a new one.
 */
const checkOnShow = new Set<string>();

function scheduleUncheckedVisible(editors: readonly vscode.TextEditor[]): void {
  if (disposed || !isLiveValidationEnabled() || !getTestpitExe()) {
    return;
  }
  for (const editor of editors) {
    const document = editor.document;
    const key = document.uri.toString();
    // Both marks go: neither is wanted once the check is scheduled.
    const marked = notRechecked.delete(key);
    const asked = checkOnShow.delete(key);
    if ((marked || asked) && isLiveTarget(document)) {
      scheduler.schedule(key);
    }
  }
}

function handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
  if (!event?.affectsConfiguration?.(`${CONFIG_SECTION}.${LIVE_VALIDATION_KEY}`)) {
    return;
  }
  if (isLiveValidationEnabled()) {
    scheduleOpenDocuments(false);
  } else {
    // Drop debounced live runs. A run in flight finishes; explicit
    // "Run Validity Check" runs are unaffected by the setting. Nothing checks
    // a document when it is shown any more, so the marks go too: turning the
    // setting back on marks the background documents again.
    scheduler.cancelAll();
    notRechecked.clear();
    checkOnShow.clear();
  }
}

function handleDocumentClose(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  scheduler.cancel(key);
  versionGate.forget(key);
  notRechecked.delete(key);
  collection?.delete(document.uri);
}

async function runLiveCheck(key: string): Promise<void> {
  const document = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === key
  );
  if (!isLiveTarget(document)) {
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
  // Text, version and profile are captured together, before the (slow) run:
  // getActiveConfigs() below is read in the same tick.
  const version = document.version;
  const text = document.getText();
  const generation = profileGeneration;
  const key = document.uri.toString();
  runUris.set(key, document.uri);
  runTracker.begin(key);
  try {
    return await withTempScript(tempBase(document.uri), text, async (tempPath) => {
      const command = buildValidityCommand(exe, tempPath, getActiveConfigs());
      hooks?.onCommand?.(command);
      const output = await runValidityCheckAsync(command);
      const issues = parseValidityOutput(output, text.split(/\r?\n/));
      if (hooks?.publish === false && !isVisible(key)) {
        checkWhenShown(document);
        return { command, output, issues, published: false };
      }
      const published = publish(document, version, generation, exe, issues);
      return { command, output, issues, published };
    });
  } finally {
    runTracker.end(key);
  }
}

/**
 * A document validated without publishing (no editor tab holds it): the live
 * check takes the script once an editor shows it, so its problems then
 * appear in the Problems panel — and stay, the editor keeping it open.
 */
function checkWhenShown(document: vscode.TextDocument): void {
  // Not isLiveTarget: the document may have been closed — VS Code letting go
  // of it — while TestPit ran. The mark is per uri, and the document an editor
  // shows later is checked for being a live target then.
  if (
    disposed ||
    document.languageId !== "esi" ||
    document.uri.scheme !== "file" ||
    !isLiveValidationEnabled() ||
    !getTestpitExe()
  ) {
    return;
  }
  checkOnShow.add(document.uri.toString());
}

/**
 * Where the temp copy goes: beside the script, so its relative includes
 * resolve as for the script itself. A virtual document (`git:` side of a
 * diff, …) has the working copy's fsPath but is another document to the
 * scheduler, so a run for each can be in flight at once: the scheme — and
 * for two revisions of one file (`git:` HEAD and index, Timeline), which
 * differ only in the query — a hash of the query keep their `.temp` files
 * apart.
 */
export function tempBase(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    return uri.fsPath;
  }
  const revision =
    uri.query || uri.fragment
      ? "-" +
        createHash("sha1")
          .update(`${uri.query ?? ""}#${uri.fragment ?? ""}`)
          .digest("hex")
          .slice(0, 8)
      : "";
  return `${uri.fsPath}.${uri.scheme}${revision}`;
}

function publish(
  document: vscode.TextDocument,
  version: number,
  generation: number,
  exe: string,
  issues: ValidityIssue[]
): boolean {
  // Closed while TestPit was running: its diagnostics were cleared on close.
  // Disposed likewise: publishing would re-create a collection nobody disposes.
  if (disposed || document.isClosed) {
    return false;
  }
  // Started before a profile switch / registry reload (so produced with the
  // previous profile's config files), or run with a TestPit.exe that is no
  // longer the configured one — repointed during the run, or after a Test
  // Explorer run read it. While the live check is on, a shown document gets
  // a re-run (scheduleOpenDocuments) and a background one is checked when
  // shown.
  if (generation !== profileGeneration || exe !== getTestpitExe()) {
    return false;
  }
  const key = document.uri.toString();
  // The stale results of a background document were dropped: a result for
  // older text must not bring them back, nor cancel its check on show. A
  // shown document is left to the version gate, as any other: its newer
  // text gets a run of its own.
  if (notRechecked.has(key) && !isVisible(key) && version !== document.version) {
    return false;
  }
  if (!versionGate.accept(key, version)) {
    return false;
  }
  collection ??= vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  collection.set(document.uri, issues.map(toDiagnostic));
  notRechecked.delete(key);
  checkOnShow.delete(key);
  return true;
}
