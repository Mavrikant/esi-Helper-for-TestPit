import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  isValidityRunning,
  onDidChangeValidityRun,
  runValidityCheckForDocument,
} from "../../diagnostics";
import { registerValidationStatusBar } from "../../statusBar";

// Thin-glue check for the validation status-bar item and the run events of
// diagnostics.ts. The vscode mock is extended here, for this file only, with
// the few members the item needs; everything is restored afterwards.
const mock = vscode as any;

function fakeDocument(name: string, languageId: string): any {
  return {
    uri: vscode.Uri.file(path.join(os.tmpdir(), name)),
    languageId,
    version: 1,
    isClosed: false,
    getText: () => "[TEST STEPS]\r\n[/TEST STEPS]\r\n",
  };
}

describe("validation status bar glue", () => {
  const saved: Record<string, unknown> = {};
  let item: any;
  let editorEmitter: vscode.EventEmitter<unknown>;
  let diagnosticsEmitter: vscode.EventEmitter<{ uris: vscode.Uri[] }>;
  let diagnostics: Array<{ severity: number }>;

  beforeEach(() => {
    saved.createStatusBarItem = mock.window.createStatusBarItem;
    saved.onDidChangeActiveTextEditor = mock.window.onDidChangeActiveTextEditor;
    saved.activeTextEditor = mock.window.activeTextEditor;
    saved.onDidChangeDiagnostics = mock.languages.onDidChangeDiagnostics;
    saved.getDiagnostics = mock.languages.getDiagnostics;
    editorEmitter = new vscode.EventEmitter<unknown>();
    diagnosticsEmitter = new vscode.EventEmitter<{ uris: vscode.Uri[] }>();
    diagnostics = [];
    mock.window.createStatusBarItem = () =>
      (item = {
        text: "",
        tooltip: "",
        visible: false,
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() {},
      });
    mock.window.onDidChangeActiveTextEditor = editorEmitter.event;
    mock.languages.onDidChangeDiagnostics = diagnosticsEmitter.event;
    mock.languages.getDiagnostics = () => diagnostics;
  });

  afterEach(() => {
    mock.window.createStatusBarItem = saved.createStatusBarItem;
    mock.window.onDidChangeActiveTextEditor = saved.onDidChangeActiveTextEditor;
    mock.window.activeTextEditor = saved.activeTextEditor;
    mock.languages.onDidChangeDiagnostics = saved.onDidChangeDiagnostics;
    mock.languages.getDiagnostics = saved.getDiagnostics;
  });

  it("is hidden unless the active editor is an .esi document", () => {
    mock.window.activeTextEditor = undefined;
    const sub = registerValidationStatusBar();
    assert.strictEqual(item.visible, false);
    assert.strictEqual(item.command, "workbench.actions.view.problems");

    mock.window.activeTextEditor = { document: fakeDocument("a.txt", "plaintext") };
    editorEmitter.fire(undefined);
    assert.strictEqual(item.visible, false);

    mock.window.activeTextEditor = { document: fakeDocument("a.esi", "esi") };
    editorEmitter.fire(undefined);
    assert.strictEqual(item.visible, true);
    assert.strictEqual(item.text, "$(error) 0 $(warning) 0");
    sub.dispose();
  });

  it("follows diagnostics changes of the active file only", () => {
    const document = fakeDocument("b.esi", "esi");
    mock.window.activeTextEditor = { document };
    const sub = registerValidationStatusBar();
    diagnostics = [{ severity: 0 }, { severity: 1 }, { severity: 1 }, { severity: 2 }];
    diagnosticsEmitter.fire({ uris: [vscode.Uri.file("/elsewhere/x.esi")] });
    assert.strictEqual(item.text, "$(error) 0 $(warning) 0");
    diagnosticsEmitter.fire({ uris: [document.uri] });
    assert.strictEqual(item.text, "$(error) 1 $(warning) 2");
    sub.dispose();
  });

  it("shows the spinner between the run start and end events", async () => {
    const document = fakeDocument("c.esi", "esi");
    mock.window.activeTextEditor = { document };
    const sub = registerValidationStatusBar();
    const seen: string[] = [];
    const runSub = onDidChangeValidityRun((e) => {
      seen.push(`${e.running}:${isValidityRunning(e.uri)}:${item.text}`);
    });
    // "echo" stands in for TestPit.exe: a real, harmless child process.
    const result = await runValidityCheckForDocument(document, "echo");
    runSub.dispose();
    assert.deepStrictEqual(result.issues, []);
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[0], "true:true:$(sync~spin) validating…");
    assert.ok(seen[1].startsWith("false:false:$(error)"), seen[1]);
    assert.strictEqual(isValidityRunning(document.uri), false);
    sub.dispose();
  });
});
