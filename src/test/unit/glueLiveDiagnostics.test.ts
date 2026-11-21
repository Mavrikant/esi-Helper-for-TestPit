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
import {
  initPluginStore,
  notifyActiveProfileChanged,
  setTestpitExe,
} from "../../lib/pluginStore";

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
  /** What the "esi-testpit" collection was asked to do, in order. */
  let ops: string[];
  let live: vscode.Disposable | undefined;

  beforeEach(() => {
    ops = [];
    changeListener = undefined;
    visibleListener = undefined;
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
    // Shortest debounce the setting allows.
    patch(mock.workspace, "getConfiguration", () => ({
      get: (key: string) => (key === "liveValidationDelay" ? 200 : undefined),
    }));
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

  it("keeps the temp copy of a virtual document apart from the working copy's", () => {
    const file = vscode.Uri.file(path.join(os.tmpdir(), "a.esi"));
    assert.strictEqual(tempBase(file), file.fsPath);
    const head = { ...file, scheme: "git" } as vscode.Uri;
    assert.strictEqual(tempBase(head), `${file.fsPath}.git`);
  });
});
