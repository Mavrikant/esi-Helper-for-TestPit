import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { registerComponentDiagnostics } from "../../componentDiagnostics";
import {
  createMacroResolver,
  createOutsideIncludeWatchers,
  literalGlob,
} from "../../providers/macroResolver";

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
  /** Every watcher made: its pattern, listeners and whether it was disposed. */
  let watchers: Array<{ pattern: any; on: Record<string, (uri: any) => void>; disposed: boolean }>;
  const published = new Map<string, string[]>();
  /** How many times each document's diagnostics were set. */
  const passes = new Map<string, number>();
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
    passes.clear();
    watchers = [];
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
    patch(mock.workspace, "createFileSystemWatcher", (pattern: any) => {
      const w = { pattern, on: {} as Record<string, (uri: any) => void>, disposed: false };
      watchers.push(w);
      const listen = (event: string, key: string) => (l: any) => {
        w.on[event] = l;
        listeners[key] = l;
        return { dispose() {} };
      };
      return {
        onDidChange: listen("change", "diskChange"),
        onDidCreate: listen("create", "diskCreate"),
        onDidDelete: listen("delete", "diskDelete"),
        dispose() { w.disposed = true; },
      };
    });
    patch(mock.languages, "createDiagnosticCollection", () => ({
      set: (uri: any, diags: any[]) => {
        passes.set(uri.toString(), (passes.get(uri.toString()) ?? 0) + 1);
        published.set(uri.toString(), diags.map((d) => d.code));
      },
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

  it("re-checks the includers once typing in an included file pauses", async () => {
    const root = docOf("root.esi", () => ROOT);
    const included = docOf("common.esi", () => WITHOUT);
    mock.workspace.textDocuments = [root, included];
    live = registerComponentDiagnostics();
    const key = root.uri.toString();
    assert.strictEqual(passes.get(key), 1);
    // A key every 200 ms (t = 0, 200, 400): each one restarts the 300 ms
    // quiet period, so the one pass comes at t = 700.
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await sleep(200);
      }
      listeners.change({ document: included, contentChanges: [{ text: "x" }] });
    }
    await sleep(150);
    assert.strictEqual(passes.get(key), 1, "no pass while typing goes on");
    await sleep(300);
    assert.strictEqual(passes.get(key), 2);
  });

  it("does not let typing in a script nothing includes hold the includer pass back", async () => {
    const root = docOf("root.esi", () => ROOT);
    let common = WITHOUT;
    const included = docOf("common.esi", () => common);
    const other = docOf("other.esi", () => WITHOUT);
    mock.workspace.textDocuments = [root, included, other];
    live = registerComponentDiagnostics();
    assert.deepStrictEqual(codes(root), ["undefinedMacro"]);
    common = WITH;
    listeners.change({ document: included, contentChanges: [{ text: "x" }] });
    // Keys in another script every 100 ms meanwhile.
    for (let i = 0; i < 4; i++) {
      await sleep(100);
      listeners.change({ document: other, contentChanges: [{ text: "x" }] });
    }
    await sleep(100);
    assert.deepStrictEqual(codes(root), []);
  });

  it("writes an include's file name as a glob that matches only itself", () => {
    assert.strictEqual(literalGlob("common.esi"), "common.esi");
    assert.strictEqual(literalGlob("Common [v2].esi"), "Common [[]v2[]].esi");
    assert.strictEqual(literalGlob("Utils{A429}*?.esi"), "Utils[{]A429[}][*][?].esi");
  });

  it("makes no watcher once disposed", () => {
    const outsidePath = path.join(os.tmpdir(), "esi-outside-disposed", "lib.esi");
    const outside = createOutsideIncludeWatchers(() => []);
    outside.update([outsidePath]);
    assert.strictEqual(watchers.length, 1);
    outside.dispose();
    assert.strictEqual(watchers[0].disposed, true);
    // Work still in flight at deactivation.
    outside.update([outsidePath]);
    assert.strictEqual(watchers.length, 1);
  });

  it("watches an include outside the workspace folders on its own", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    fs.mkdirSync(path.join(dir, "lib"));
    const outsidePath = path.join(dir, "lib", "common.esi");
    fs.writeFileSync(outsidePath, WITHOUT);
    fs.writeFileSync(path.join(ws, "inner.esi"), WITHOUT);
    patch(mock.workspace, "workspaceFolders", [{ uri: vscode.Uri.file(ws) }]);
    const text = ROOT.replace("include file = common.esi", "include file = ..\\lib\\common.esi\r\n    include file = inner.esi");
    const root = docOf(path.join("ws", "root.esi"), () => text);
    mock.workspace.textDocuments = [root];
    live = registerComponentDiagnostics();
    assert.deepStrictEqual(codes(root), ["undefinedMacro"]);
    // The `**/*.esi` watcher, and one for the include outside `ws` only.
    const own = watchers.filter((w) => typeof w.pattern !== "string");
    assert.strictEqual(own.length, 1);
    assert.strictEqual(path.resolve(own[0].pattern.base), path.join(dir, "lib"));
    assert.strictEqual(own[0].pattern.pattern, "common.esi");

    fs.writeFileSync(outsidePath, WITH);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(outsidePath, later, later);
    own[0].on.change(vscode.Uri.file(outsidePath));
    await sleep(400);
    assert.deepStrictEqual(codes(root), []);

    // Nothing includes it any more: its watcher goes.
    mock.workspace.textDocuments = [];
    listeners.close(root);
    assert.strictEqual(own[0].disposed, true);
  });
});
