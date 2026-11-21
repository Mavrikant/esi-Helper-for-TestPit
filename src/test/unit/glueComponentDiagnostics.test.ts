import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { registerComponentDiagnostics } from "../../componentDiagnostics";
import { createMacroResolver } from "../../providers/macroResolver";

// Glue for the live in-process checks (componentDiagnostics.ts), driven
// through the vscode mock (test/setup.js). The members it listens to are
// replaced for this file only and restored afterwards.
const mock = vscode as any;

const ROOT = [
  "[INCLUDE]",
  "    include file = common.esi",
  "[/INCLUDE]",
  "[TEST STEPS]",
  "    x = %SPEED%",
  "[/TEST STEPS]",
].join("\r\n");
const WITHOUT = "[VARIABLES]\r\n[/VARIABLES]\r\n";
const WITH = "[VARIABLES]\r\n    %SPEED% = 5\r\n[/VARIABLES]\r\n";

describe("component diagnostics (glue)", () => {
  const saved: Array<[any, string, PropertyDescriptor | undefined]> = [];
  const patch = (obj: any, key: string, value: unknown): void => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    obj[key] = value;
  };
  const listeners: Record<string, (arg: any) => void> = {};
  const published = new Map<string, string[]>();
  let dir: string;
  let live: vscode.Disposable | undefined;

  const docOf = (name: string, text: () => string): any => ({
    uri: vscode.Uri.file(path.join(dir, name)),
    languageId: "esi",
    version: 1,
    isClosed: false,
    getText: text,
  });
  const codes = (doc: any): string[] => published.get(doc.uri.toString()) ?? [];
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "esi-cd-"));
    published.clear();
    for (const [event, key] of [
      ["onDidChangeTextDocument", "change"],
      ["onDidOpenTextDocument", "open"],
      ["onDidCloseTextDocument", "close"],
    ]) {
      patch(mock.workspace, event, (l: any) => {
        listeners[key] = l;
        return { dispose() {} };
      });
    }
    patch(mock.workspace, "createFileSystemWatcher", () => ({
      onDidChange(l: any) { listeners.diskChange = l; return { dispose() {} }; },
      onDidCreate(l: any) { listeners.diskCreate = l; return { dispose() {} }; },
      onDidDelete(l: any) { listeners.diskDelete = l; return { dispose() {} }; },
      dispose() {},
    }));
    patch(mock.languages, "createDiagnosticCollection", () => ({
      set: (uri: any, diags: any[]) => published.set(uri.toString(), diags.map((d) => d.code)),
      delete: (uri: any) => published.delete(uri.toString()),
      clear() {},
      dispose() {},
    }));
    patch(mock.workspace, "textDocuments", []);
  });

  afterEach(() => {
    live?.dispose();
    live = undefined;
    for (const [obj, key, desc] of saved.reverse()) {
      if (desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete obj[key];
      }
    }
    saved.length = 0;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("re-checks a script when a file it includes is edited in its editor", async () => {
    let common = WITHOUT;
    const root = docOf("root.esi", () => ROOT);
    const included = docOf("common.esi", () => common);
    mock.workspace.textDocuments = [root, included];
    live = registerComponentDiagnostics();
    assert.deepStrictEqual(codes(root), ["undefinedMacro"]);

    common = WITH;
    listeners.change({ document: included, contentChanges: [{ text: "x" }] });
    await sleep(400);
    assert.deepStrictEqual(codes(root), []);

    // Closing it unsaved: the scripts including it read the disk again.
    fs.writeFileSync(path.join(dir, "common.esi"), WITHOUT);
    mock.workspace.textDocuments = [root];
    listeners.close(included);
    await sleep(400);
    assert.deepStrictEqual(codes(root), ["undefinedMacro"]);
  });

  it("reads an include from the file, never from a git: view of it; nothing for an untitled script", () => {
    const commonPath = path.join(dir, "common.esi");
    fs.writeFileSync(commonPath, WITH);
    // The HEAD side of a diff: same fsPath, older text.
    const head = {
      uri: { scheme: "git", fsPath: commonPath, toString: () => `git:${commonPath}` },
      languageId: "esi",
      getText: () => WITHOUT,
    };
    mock.workspace.textDocuments = [head];
    const resolver = createMacroResolver(docOf("root.esi", () => ROOT));
    assert.strictEqual(resolver.readInclude?.("common.esi", undefined)?.text, WITH);
    const untitled = {
      uri: { scheme: "untitled", fsPath: "Untitled-1", toString: () => "untitled:Untitled-1" },
      getText: () => ROOT,
    };
    assert.deepStrictEqual(createMacroResolver(untitled as any), {});
  });

  it("re-checks a script when a file it includes changes or appears on disk", async () => {
    const root = docOf("root.esi", () => ROOT);
    mock.workspace.textDocuments = [root];
    live = registerComponentDiagnostics();
    // common.esi does not exist yet: the include is unresolved, the macro
    // checks stand down.
    assert.deepStrictEqual(codes(root), []);

    const common = vscode.Uri.file(path.join(dir, "common.esi"));
    fs.writeFileSync(common.fsPath, WITHOUT);
    listeners.diskCreate(common);
    await sleep(400);
    assert.deepStrictEqual(codes(root), ["undefinedMacro"]);

    // The disk cache is keyed by modification time: make sure it moves.
    fs.writeFileSync(common.fsPath, WITH);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(common.fsPath, later, later);
    listeners.diskChange(common);
    await sleep(400);
    assert.deepStrictEqual(codes(root), []);
  });
});
