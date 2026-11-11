import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  CLEAR_WORKSPACE_VALIDATION_COMMAND,
  VALIDATE_WORKSPACE_COMMAND,
  registerValidateWorkspace,
} from "../../commands/validateWorkspace";

// Glue for the workspace-validation command, driven through the vscode mock
// (test/setup.js). The pieces the mock lacks (findFiles, executeCommand, a
// recording diagnostic collection, …) are installed for this suite only and
// restored afterwards. `require` gives the mock object itself.
const v = require("vscode") as any;

const BROKEN = "﻿[TEST STEPS]\r\n[/TEST STEPS]\r\n[/ORPHAN]\r\n";
const CLEAN = "[TEST STEPS]\r\n[/TEST STEPS]\r\n";

describe("validateWorkspace command (glue)", () => {
  let dir: string;
  let disposable: vscode.Disposable;
  let found: any[] = [];
  let findArgs: any[] = [];
  let cancelAfterReports = Infinity;
  let reports: any[] = [];
  let messages: Array<{ level: string; message: string; actions: string[] }> = [];
  let answer: string | undefined;
  let executed: string[] = [];
  let collectionName = "";
  const published = new Map<string, any[]>();
  const listeners: Record<string, (arg: any) => void> = {};
  const saved: Array<[any, string, PropertyDescriptor | undefined]> = [];

  const patch = (obj: any, key: string, value: any): void => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    obj[key] = value;
  };
  const uriOf = (name: string): any => vscode.Uri.file(path.join(dir, name));
  const write = (name: string, text: string): any => {
    fs.writeFileSync(path.join(dir, name), text, "utf-8");
    return uriOf(name);
  };
  const run = (): Promise<void> => v.__registered.commands[VALIDATE_WORKSPACE_COMMAND]();
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "esi-ws-"));
    patch(v.workspace, "findFiles", (...args: any[]) => {
      findArgs = args;
      return Promise.resolve(found);
    });
    patch(v.workspace, "textDocuments", []);
    patch(v.workspace, "onDidOpenTextDocument", (l: any) => {
      listeners.open = l;
      return { dispose() {} };
    });
    patch(v.workspace, "onDidCloseTextDocument", (l: any) => {
      listeners.close = l;
      return { dispose() {} };
    });
    patch(v.workspace, "createFileSystemWatcher", () => ({
      onDidChange(l: any) { listeners.change = l; return { dispose() {} }; },
      onDidCreate() { return { dispose() {} }; },
      onDidDelete(l: any) { listeners.delete = l; return { dispose() {} }; },
      dispose() {},
    }));
    patch(v.languages, "createDiagnosticCollection", (name: string) => {
      collectionName = name;
      return {
        set(uri: any, diags: any[]) { published.set(uri.toString(), diags); },
        delete(uri: any) { published.delete(uri.toString()); },
        clear() { published.clear(); },
        dispose() {},
      };
    });
    patch(v.commands, "executeCommand", (id: string) => {
      executed.push(id);
      return Promise.resolve();
    });
    patch(v.window, "withProgress", (options: any, task: any) => {
      assert.strictEqual(options.cancellable, true);
      const token = {
        get isCancellationRequested() { return reports.length > cancelAfterReports; },
        onCancellationRequested() { return { dispose() {} }; },
      };
      return Promise.resolve(task({ report(r: any) { reports.push(r); } }, token));
    });
    for (const [fn, level] of [
      ["showInformationMessage", "info"],
      ["showWarningMessage", "warning"],
      ["showErrorMessage", "error"],
    ]) {
      patch(v.window, fn, (message: string, ...actions: string[]) => {
        messages.push({ level, message, actions });
        return Promise.resolve(answer);
      });
    }
    disposable = registerValidateWorkspace();
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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    v.__registered.commands[CLEAR_WORKSPACE_VALIDATION_COMMAND]();
    found = [];
    reports = [];
    messages = [];
    executed = [];
    answer = undefined;
    cancelAfterReports = Infinity;
    v.workspace.textDocuments = [];
  });

  it("uses its own collection, not the live one", () => {
    assert.strictEqual(collectionName, "esi-workspace");
  });

  it("reports an empty workspace", async () => {
    await run();
    assert.deepStrictEqual(messages, [
      { level: "info", message: "No .esi files found in the workspace.", actions: [] },
    ]);
    // Default excludes (files.exclude): the exclude argument stays undefined.
    assert.strictEqual(findArgs[0], "**/*.esi");
    assert.strictEqual(findArgs[1], undefined);
  });

  it("publishes problems for closed files only where there are any", async () => {
    const broken = write("broken.esi", BROKEN);
    const clean = write("clean.esi", CLEAN);
    found = [clean, broken];
    await run();
    assert.deepStrictEqual(Array.from(published.keys()), [broken.toString()]);
    const diags = published.get(broken.toString()) as any[];
    // The BOM must not turn line 0 into a problem: only the orphan closer.
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].source, "esi Helper");
    assert.strictEqual(diags[0].code, "unbalancedTag");
    assert.strictEqual(diags[0].range.start.line, 2);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0].actions, ["Show Problems", "Clear"]);
    assert.ok(messages[0].message.includes("Checked 2 .esi files:"));
    assert.ok(messages[0].message.includes("in 1 file."));
    // Sorted by path; one progress report per file after "finding files".
    assert.deepStrictEqual(
      reports.slice(1).map((r) => r.message),
      ["1/2 broken.esi", "2/2 clean.esi"]
    );
  });

  it("counts an open esi document from its buffer but leaves publishing to the live collection", async () => {
    const uri = write("open.esi", CLEAN);
    v.workspace.textDocuments = [{ uri, languageId: "esi", getText: () => BROKEN.slice(1) }];
    found = [uri];
    await run();
    assert.strictEqual(published.size, 0);
    assert.ok(messages[0].message.includes("in 1 file."), messages[0].message);
  });

  it("hands a file over on open and takes it back from disk on close", async () => {
    const uri = write("handover.esi", BROKEN);
    found = [uri];
    await run();
    assert.strictEqual(published.size, 1);
    listeners.open({ uri, languageId: "esi", getText: () => BROKEN });
    assert.strictEqual(published.size, 0);
    listeners.close({ uri, languageId: "esi", getText: () => BROKEN });
    await settle();
    assert.strictEqual(published.size, 1);
  });

  it("follows a covered file changing or disappearing on disk", async () => {
    const uri = write("disk.esi", BROKEN);
    found = [uri];
    await run();
    assert.strictEqual(published.size, 1);
    write("disk.esi", CLEAN);
    listeners.change(uri);
    await settle();
    assert.strictEqual(published.size, 0);
    write("disk.esi", BROKEN);
    listeners.change(uri);
    await settle();
    assert.strictEqual(published.size, 1);
    listeners.delete(uri);
    assert.strictEqual(published.size, 0);
  });

  it("an unreadable file is reported, not passed as clean", async () => {
    found = [uriOf("missing.esi")];
    await run();
    assert.strictEqual(messages[0].level, "warning");
    assert.ok(messages[0].message.includes("1 file could not be read"));
  });

  it("stops on cancel and keeps what it has", async () => {
    found = [write("c1.esi", BROKEN), write("c2.esi", BROKEN), write("c3.esi", BROKEN)];
    cancelAfterReports = 1; // cancel once the first file has been reported
    await run();
    assert.strictEqual(published.size, 1);
    assert.ok(messages[0].message.startsWith("Cancelled after 1 of 3 .esi files"));
  });

  it("Clear and Show Problems actions", async () => {
    found = [write("act.esi", BROKEN)];
    answer = "Show Problems";
    await run();
    assert.deepStrictEqual(executed, ["workbench.actions.view.problems"]);
    assert.strictEqual(published.size, 1);
    answer = "Clear";
    await run();
    assert.strictEqual(published.size, 0);
  });

  it("the clear command empties the collection", async () => {
    found = [write("cmd.esi", BROKEN)];
    await run();
    assert.strictEqual(published.size, 1);
    v.__registered.commands[CLEAR_WORKSPACE_VALIDATION_COMMAND]();
    assert.strictEqual(published.size, 0);
  });
});
