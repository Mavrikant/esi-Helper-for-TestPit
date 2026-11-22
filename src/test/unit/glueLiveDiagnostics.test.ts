import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  onDidChangeValidityRun,
  registerLiveDiagnostics,
  runValidityCheckForDocument,
  tempBase,
} from "../../diagnostics";
import { registerRunValidityCheck } from "../../commands/runValidityCheck";
import {
  initPluginStore,
  notifyActiveProfileChanged,
  setTestpitExe,
} from "../../lib/pluginStore";
import { NOT_PUBLISHED_NOTE } from "../../lib/validityResults";

// Glue for the live TestPit check (diagnostics.ts), driven through the vscode
// mock (test/setup.js). The members the live check listens to are replaced
// for this file only and restored afterwards. "echo" stands in for
// TestPit.exe: a real, harmless child process on every OS.
const mock = vscode as any;

function fakeDocument(name: string): any {
  return {
    uri: vscode.Uri.file(path.join(os.tmpdir(), name)),
    languageId: "esi",
    version: 1,
    isClosed: false,
    getText: () => "[TEST STEPS]\r\n[/TEST STEPS]\r\n",
  };
}

/** Resolves with the next run-end event for `uri`, or rejects after `ms`. */
function nextRunEnd(uri: vscode.Uri, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error("no TestPit run ended"));
    }, ms);
    const sub = onDidChangeValidityRun((event) => {
      if (!event.running && event.uri.toString() === uri.toString()) {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("live TestPit check (glue)", () => {
  const saved: Array<[any, string, PropertyDescriptor | undefined]> = [];
  const patch = (obj: any, key: string, value: unknown): void => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    obj[key] = value;
  };
  let changeListener: ((e: unknown) => void) | undefined;
  let visibleListener: ((editors: unknown[]) => void) | undefined;
  let configListener: ((e: unknown) => void) | undefined;
  let closeListener: ((document: unknown) => void) | undefined;
  /** What `getConfiguration("esihelper").get(key)` returns. */
  let settings: Record<string, unknown>;
  /** What the "esi-testpit" collection was asked to do, in order. */
  let ops: string[];
  let live: vscode.Disposable | undefined;

  beforeEach(() => {
    ops = [];
    changeListener = undefined;
    visibleListener = undefined;
    configListener = undefined;
    closeListener = undefined;
    // Shortest debounce the setting allows.
    settings = { liveValidationDelay: 200 };
    patch(mock.workspace, "onDidChangeTextDocument", (l: any) => {
      changeListener = l;
      return { dispose: () => (changeListener = undefined) };
    });
    patch(mock.window, "onDidChangeVisibleTextEditors", (l: any) => {
      visibleListener = l;
      return { dispose: () => (visibleListener = undefined) };
    });
    patch(mock.workspace, "textDocuments", []);
    patch(mock.window, "visibleTextEditors", []);
    patch(mock.languages, "createDiagnosticCollection", () => ({
      set: (uri: vscode.Uri) => ops.push(`set ${path.basename(uri.fsPath)}`),
      delete: (uri: vscode.Uri) => ops.push(`delete ${path.basename(uri.fsPath)}`),
      clear() {},
      dispose() {},
    }));
    patch(mock.workspace, "getConfiguration", () => ({
      get: (key: string) => settings[key],
    }));
    patch(mock.workspace, "onDidChangeConfiguration", (l: any) => {
      configListener = l;
      return { dispose: () => (configListener = undefined) };
    });
    patch(mock.workspace, "onDidCloseTextDocument", (l: any) => {
      closeListener = l;
      return { dispose: () => (closeListener = undefined) };
    });
    // The profile / exe events live in the plugin store; with no storage
    // folder nothing is read or written.
    initPluginStore({ subscriptions: [] } as any);
    live = registerLiveDiagnostics();
  });

  afterEach(() => {
    live?.dispose();
    live = undefined;
    setTestpitExe(undefined);
    for (const [obj, key, desc] of saved.reverse()) {
      if (desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete obj[key];
      }
    }
    saved.length = 0;
  });

  it("does not publish a result produced with the previous profile", async () => {
    const document = fakeDocument("profile.esi");
    setTestpitExe("echo");
    const stale = await runValidityCheckForDocument(document, "echo", {
      // Fired after the run read the profile's config files.
      onCommand: () => notifyActiveProfileChanged(),
    });
    assert.strictEqual(stale.published, false);
    assert.deepStrictEqual(ops, []);
    const fresh = await runValidityCheckForDocument(document, "echo");
    assert.strictEqual(fresh.published, true);
    assert.deepStrictEqual(ops, ["set profile.esi"]);
  });

  it("checks a document changed with no editor showing it only once it is shown", async () => {
    const document = fakeDocument("hidden.esi");
    mock.workspace.textDocuments = [document];
    setTestpitExe("echo");
    let runs = 0;
    const sub = onDidChangeValidityRun((event) => {
      if (event.running) {
        runs++;
      }
    });
    try {
      await runValidityCheckForDocument(document, "echo");
      assert.strictEqual(runs, 1);
      assert.deepStrictEqual(ops, ["set hidden.esi"]);
      // E.g. reloaded from disk after a git checkout: no TestPit.exe is
      // started, and the results shown for the old text are dropped.
      assert.ok(changeListener, "listens to document changes");
      changeListener({ document, contentChanges: [{ text: "x" }] });
      await sleep(350);
      assert.strictEqual(runs, 1);
      assert.deepStrictEqual(ops, ["set hidden.esi", "delete hidden.esi"]);

      const ended = nextRunEnd(document.uri, 5000);
      const editor = { document };
      mock.window.visibleTextEditors = [editor];
      assert.ok(visibleListener, "listens to visible editors");
      visibleListener([editor]);
      await ended;
      assert.strictEqual(runs, 2);
      assert.deepStrictEqual(ops, [
        "set hidden.esi",
        "delete hidden.esi",
        "set hidden.esi",
      ]);
    } finally {
      sub.dispose();
    }
  });

  it("does not let a result for older text back in for a document left for later", async () => {
    const document = fakeDocument("older.esi");
    mock.workspace.textDocuments = [document];
    setTestpitExe("echo");
    await runValidityCheckForDocument(document, "echo");
    const result = await runValidityCheckForDocument(document, "echo", {
      // While TestPit runs, the file changes on disk with no editor open.
      onCommand: () => {
        document.version = 2;
        changeListener?.({ document, contentChanges: [{ text: "x" }] });
      },
    });
    assert.strictEqual(result.published, false);
    assert.deepStrictEqual(ops, ["set older.esi", "delete older.esi"]);
  });

  it("does not publish a result produced with a TestPit.exe replaced since", async () => {
    const document = fakeDocument("exe.esi");
    setTestpitExe("echo");
    // Repointed while TestPit runs…
    const inFlight = await runValidityCheckForDocument(document, "echo", {
      onCommand: () => setTestpitExe("echo-new"),
    });
    assert.strictEqual(inFlight.published, false);
    // …or before a run that read the old one (a Test Explorer run's later
    // scripts).
    const late = await runValidityCheckForDocument(document, "echo");
    assert.strictEqual(late.published, false);
    assert.deepStrictEqual(ops, []);
    setTestpitExe("echo");
    const fresh = await runValidityCheckForDocument(document, "echo");
    assert.strictEqual(fresh.published, true);
    assert.deepStrictEqual(ops, ["set exe.esi"]);
  });

  it("says so when a Run Validity Check result is not put in the Problems panel", async () => {
    const document = fakeDocument("command.esi");
    mock.workspace.textDocuments = [document];
    setTestpitExe("echo");
    const warnings: string[] = [];
    patch(mock.window, "showWarningMessage", (message: string) => {
      warnings.push(message);
      return Promise.resolve(undefined);
    });
    patch(mock.window, "activeTextEditor", { document });
    const command = registerRunValidityCheck();
    // The profile changes once TestPit has started.
    const sub = onDidChangeValidityRun((event) => {
      if (event.running) {
        notifyActiveProfileChanged();
      }
    });
    try {
      await mock.__registered.commands["extension.runValidityCheck"]();
    } finally {
      sub.dispose();
      command.dispose();
    }
    assert.deepStrictEqual(ops, []);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].endsWith(NOT_PUBLISHED_NOTE), warnings[0]);
  });

  it("checks a document validated without publishing once an editor shows it", async () => {
    const document = fakeDocument("unshown.esi");
    // Picked before the document is open: picking it marks the background
    // documents for a check of their own.
    setTestpitExe("echo");
    mock.workspace.textDocuments = [document];
    const result = await runValidityCheckForDocument(document, "echo", { publish: false });
    assert.strictEqual(result.published, false);
    assert.deepStrictEqual(ops, []);

    const ended = nextRunEnd(document.uri, 5000);
    const editor = { document };
    mock.window.visibleTextEditors = [editor];
    assert.ok(visibleListener, "listens to visible editors");
    visibleListener([editor]);
    await ended;
    assert.deepStrictEqual(ops, ["set unshown.esi"]);
  });

  it("checks such a script once shown even after VS Code let go of its document", async () => {
    // VS Code releases a document the extension opened within minutes (or
    // once some fifty others were opened): the user's open makes a new one.
    setTestpitExe("echo");
    const loaded = fakeDocument("released.esi");
    mock.workspace.textDocuments = [loaded];
    await runValidityCheckForDocument(loaded, "echo", { publish: false });
    assert.ok(closeListener, "listens to closed documents");
    mock.workspace.textDocuments = [];
    closeListener(loaded);

    const reopened = fakeDocument("released.esi");
    mock.workspace.textDocuments = [reopened];
    const ended = nextRunEnd(reopened.uri, 5000);
    const editor = { document: reopened };
    mock.window.visibleTextEditors = [editor];
    assert.ok(visibleListener, "listens to visible editors");
    visibleListener([editor]);
    await ended;
    assert.deepStrictEqual(ops, ["set released.esi"]);
  });

  it("checks such a script once shown even when VS Code let go of it during the run", async () => {
    setTestpitExe("echo");
    const loaded = fakeDocument("released-mid-run.esi");
    mock.workspace.textDocuments = [loaded];
    await runValidityCheckForDocument(loaded, "echo", {
      publish: false,
      // Released while TestPit runs (its 3-minute age timer ran out).
      onCommand: () => {
        loaded.isClosed = true;
        mock.workspace.textDocuments = [];
        closeListener?.(loaded);
      },
    });
    const reopened = fakeDocument("released-mid-run.esi");
    mock.workspace.textDocuments = [reopened];
    const ended = nextRunEnd(reopened.uri, 5000);
    const editor = { document: reopened };
    mock.window.visibleTextEditors = [editor];
    visibleListener?.([editor]);
    await ended;
    assert.deepStrictEqual(ops, ["set released-mid-run.esi"]);
  });

  it("publishes a result asked not to be if an editor shows the document by then", async () => {
    const document = fakeDocument("shown.esi");
    mock.workspace.textDocuments = [document];
    setTestpitExe("echo");
    const result = await runValidityCheckForDocument(document, "echo", {
      publish: false,
      onCommand: () => (mock.window.visibleTextEditors = [{ document }]),
    });
    assert.strictEqual(result.published, true);
    assert.deepStrictEqual(ops, ["set shown.esi"]);
  });

  it("with the live check turned off, takes an explicit result for a document left for later", async () => {
    const document = fakeDocument("liveoff.esi");
    mock.workspace.textDocuments = [document];
    setTestpitExe("echo");
    await runValidityCheckForDocument(document, "echo");
    // Changed with no editor showing it: its results are dropped, and it is
    // left to be checked when shown.
    document.version = 2;
    changeListener?.({ document, contentChanges: [{ text: "x" }] });
    assert.deepStrictEqual(ops, ["set liveoff.esi", "delete liveoff.esi"]);

    settings.liveValidation = false;
    assert.ok(configListener, "listens to settings");
    configListener({ affectsConfiguration: (key: string) => key === "esihelper.liveValidation" });
    // Shown now, but nothing checks it with the live check off: an explicit
    // run, typed into meanwhile, still puts its result up.
    const editor = { document };
    mock.window.visibleTextEditors = [editor];
    visibleListener?.([editor]);
    const result = await runValidityCheckForDocument(document, "echo", {
      onCommand: () => (document.version = 3),
    });
    assert.strictEqual(result.published, true);
    assert.deepStrictEqual(ops, ["set liveoff.esi", "delete liveoff.esi", "set liveoff.esi"]);
  });

  it("keeps the temp copy of a virtual document apart from the working copy's", () => {
    const file = vscode.Uri.file(path.join(os.tmpdir(), "a.esi"));
    assert.strictEqual(tempBase(file), file.fsPath);
    const head = { ...file, scheme: "git" } as vscode.Uri;
    assert.strictEqual(tempBase(head), `${file.fsPath}.git`);
    // Two revisions of one file (HEAD and the index of a staged diff) differ
    // only in the query.
    const atHead = { ...head, query: '{"path":"a.esi","ref":"HEAD"}' } as vscode.Uri;
    const inIndex = { ...head, query: '{"path":"a.esi","ref":""}' } as vscode.Uri;
    assert.match(tempBase(atHead), /\.git-[0-9a-f]{8}$/);
    assert.notStrictEqual(tempBase(atHead), tempBase(inIndex));
    assert.strictEqual(tempBase({ ...atHead } as vscode.Uri), tempBase(atHead));
    assert.ok(tempBase(atHead).startsWith(`${file.fsPath}.git`));
  });
});
