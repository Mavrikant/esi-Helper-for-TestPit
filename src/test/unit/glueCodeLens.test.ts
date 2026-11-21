import * as assert from "assert";
import * as vscode from "vscode";

// Glue for the CodeLens provider, driven through the vscode mock
// (test/setup.js). The mock may not yet carry the CodeLens surface, so the
// pieces this suite needs are installed for its duration and restored after.
// `require` gives the mock object itself (the `import *` view is a snapshot
// that would not see a class added later).
const v = require("vscode") as any;

const SCRIPT = [
  "[TEST STEPS]", // 0
  "    [STEP 10]", // 1
  "        [STEP INPUTS]", // 2
  "            [DIS_A/]", // 3
  "        [/STEP INPUTS]", // 4
  "    [/STEP 10]", // 5
  "[/TEST STEPS]", // 6
].join("\r\n");

const URI = { scheme: "file", fsPath: "/x/a.esi", toString: () => "file:///x/a.esi" };

function fakeDocument(text: string): any {
  const lines = text.split(/\r?\n/);
  return {
    languageId: "esi",
    uri: URI,
    getText: () => text,
    lineCount: lines.length,
  };
}

function diag(line: number, severity: number, message: string): any {
  return {
    range: new vscode.Range(line, 0, line, 5),
    severity,
    message,
    source: "test",
  };
}

describe("codeLens provider (glue)", () => {
  let provider: any;
  let disposable: vscode.Disposable;
  let diagnostics: any[] = [];
  let enabled: boolean | undefined;
  let diagListener: ((e: { uris: any[] }) => void) | undefined;
  const commands: Record<string, (...args: any[]) => any> = {};
  const executed: string[] = [];
  let quickPick: { items: any[]; pick: (items: any[]) => any } | undefined;
  const saved: Array<[any, string, any]> = [];

  const patch = (obj: any, key: string, value: any): void => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    obj[key] = value;
  };

  before(() => {
    patch(v.languages, "registerCodeLensProvider", (_sel: any, p: any) => {
      provider = p;
      return { dispose() {} };
    });
    patch(v.languages, "onDidChangeDiagnostics", (l: any) => {
      diagListener = l;
      return { dispose: () => (diagListener = undefined) };
    });
    patch(v.languages, "getDiagnostics", () => diagnostics);
    patch(
      v,
      "CodeLens",
      class {
        constructor(public range: any, public command: any) {}
      }
    );
    patch(v.commands, "registerCommand", (id: string, h: any) => {
      commands[id] = h;
      return { dispose() {} };
    });
    patch(v.commands, "executeCommand", (id: string) => {
      executed.push(id);
      return Promise.resolve();
    });
    patch(v.workspace, "getConfiguration", () => ({
      get: (_k: string, dflt: unknown) => (enabled === undefined ? dflt : enabled),
    }));
    patch(v.workspace, "textDocuments", [fakeDocument(SCRIPT)]);
    patch(v.window, "showQuickPick", (items: any[]) => {
      quickPick = { items, pick: quickPick?.pick ?? (() => undefined) };
      return Promise.resolve(quickPick.pick(items));
    });

    // Loaded here so it binds to the patched mock at call time.
    const mod = require("../../providers/codeLens");
    disposable = mod.registerEsiCodeLensProvider();
  });

  after(() => {
    disposable.dispose();
    for (const [obj, key, desc] of saved.reverse()) {
      if (desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete obj[key];
      }
    }
  });

  beforeEach(() => {
    diagnostics = [];
    enabled = undefined;
    executed.length = 0;
    quickPick = undefined;
    v.window.activeTextEditor = undefined;
  });

  const lensesOf = (): any[] => provider.provideCodeLenses(fakeDocument(SCRIPT));

  it("maps the script lenses to the real command ids", () => {
    const lenses = lensesOf();
    assert.deepStrictEqual(
      lenses.map((l) => l.command.command),
      [
        "extension.runValidityCheck",
        "extension.openWithTestPit",
        "extension.esiLens.toggleStepFold",
      ]
    );
    assert.strictEqual(lenses[2].command.title, "1 input · 0 outputs");
    assert.deepStrictEqual(lenses[2].command.arguments, [URI, 1]);
    assert.strictEqual(lenses[2].range.start.line, 1);
  });

  it("adds a problem lens from the document's diagnostics", () => {
    diagnostics = [
      diag(3, v.DiagnosticSeverity.Error, "bad"),
      diag(0, v.DiagnosticSeverity.Error, "outside the step"),
    ];
    const lenses = lensesOf();
    const last = lenses[lenses.length - 1];
    assert.strictEqual(last.command.title, "$(error) 1 error");
    assert.strictEqual(last.command.command, "extension.esiLens.showStepProblems");
    assert.deepStrictEqual(last.command.arguments, [URI, 1, 5]);
  });

  it("returns nothing when esihelper.codeLens.enabled is false", () => {
    enabled = false;
    assert.deepStrictEqual(lensesOf(), []);
  });

  it("refreshes, debounced, when an esi document's diagnostics change", async () => {
    let fired = 0;
    const sub = provider.onDidChangeCodeLenses(() => fired++);
    assert.ok(diagListener);
    diagListener({ uris: [{ toString: () => "file:///other.txt" }] });
    diagListener({ uris: [URI] });
    diagListener({ uris: [URI] });
    assert.strictEqual(fired, 0);
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(fired, 1);
    sub.dispose();
  });

  function fakeEditor(): any {
    return {
      document: fakeDocument(SCRIPT),
      selection: undefined,
      revealed: undefined as any,
      revealRange(range: any) {
        this.revealed = range;
      },
    };
  }

  it("toggle-fold moves the cursor to the step and toggles the fold", async () => {
    const editor = fakeEditor();
    v.window.activeTextEditor = editor;
    await commands["extension.esiLens.toggleStepFold"](URI, 1);
    assert.strictEqual(editor.selection.active.line, 1);
    assert.deepStrictEqual(executed, ["editor.toggleFold"]);
  });

  it("toggle-fold does nothing for another document", async () => {
    v.window.activeTextEditor = fakeEditor();
    await commands["extension.esiLens.toggleStepFold"](
      { toString: () => "file:///elsewhere.esi" },
      1
    );
    assert.deepStrictEqual(executed, []);
  });

  it("show-problems jumps straight to a single problem", async () => {
    const editor = fakeEditor();
    v.window.activeTextEditor = editor;
    diagnostics = [
      diag(3, v.DiagnosticSeverity.Warning, "w"),
      diag(6, v.DiagnosticSeverity.Error, "outside"),
      diag(2, v.DiagnosticSeverity.Information, "info is not listed"),
    ];
    await commands["extension.esiLens.showStepProblems"](URI, 1, 5);
    assert.strictEqual(quickPick, undefined);
    assert.strictEqual(editor.selection.active.line, 3);
    assert.strictEqual(editor.revealed.start.line, 3);
  });

  it("show-problems lists several problems in line order and jumps to the pick", async () => {
    const editor = fakeEditor();
    v.window.activeTextEditor = editor;
    diagnostics = [
      diag(4, v.DiagnosticSeverity.Warning, "second\nmore detail"),
      diag(2, v.DiagnosticSeverity.Error, "first"),
    ];
    quickPick = { items: [], pick: (items) => items[1] };
    await commands["extension.esiLens.showStepProblems"](URI, 1, 5);
    assert.deepStrictEqual(
      quickPick.items.map((i) => `${i.label} | ${i.description}`),
      ["$(error) first | line 3", "$(warning) second | line 5"]
    );
    assert.strictEqual(editor.selection.active.line, 4);
  });
});
