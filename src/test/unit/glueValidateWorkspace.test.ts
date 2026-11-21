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
  /** The summary stays open: neither a button nor a close settles it. */
  let summaryStaysOpen = false;
  /** Called with each progress report, after it is recorded. */
  let onReport: (() => void) | undefined;
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
      onDidCreate(l: any) { listeners.create = l; return { dispose() {} }; },
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
      return Promise.resolve(
        task({ report(r: any) { reports.push(r); onReport?.(); } }, token)
      );
    });
    for (const [fn, level] of [
      ["showInformationMessage", "info"],
      ["showWarningMessage", "warning"],
      ["showErrorMessage", "error"],
    ]) {
      patch(v.window, fn, (message: string, ...actions: string[]) => {
        messages.push({ level, message, actions });
        return summaryStaysOpen && actions.length > 0
          ? new Promise<string | undefined>(() => undefined)
          : Promise.resolve(answer);
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
    summaryStaysOpen = false;
    onReport = undefined;
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

  it("does not republish a file reopened as esi while its close re-check ran", async () => {
    // A language-mode switch fires close(old document) then open(new one).
    const uri = write("reopen.esi", BROKEN);
    found = [uri];
    await run();
    assert.strictEqual(published.size, 1);
    const esiDoc = { uri, languageId: "esi", getText: () => BROKEN };
    listeners.close({ uri, languageId: "plaintext", getText: () => BROKEN });
    v.workspace.textDocuments = [esiDoc];
    listeners.open(esiDoc);
    assert.strictEqual(published.size, 0);
    await settle();
    assert.strictEqual(published.size, 0);
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

  it("re-checks a covered file when a file it includes appears or changes on disk", async () => {
    const root = write(
      "inc-root.esi",
      "[INCLUDE]\r\n    include file = inc-common.esi\r\n[/INCLUDE]\r\n[TEST STEPS]\r\n    x = %SPEED%\r\n[/TEST STEPS]\r\n"
    );
    found = [root];
    await run();
    // inc-common.esi is missing: the include is unresolved, the macro checks
    // stand down.
    assert.strictEqual(published.size, 0);
    const common = write("inc-common.esi", "[VARIABLES]\r\n[/VARIABLES]\r\n");
    listeners.create(common);
    await settle();
    assert.deepStrictEqual(
      (published.get(root.toString()) ?? []).map((d: any) => d.code),
      ["undefinedMacro"]
    );
    write("inc-common.esi", "[VARIABLES]\r\n    %SPEED% = 5\r\n[/VARIABLES]\r\n");
    // The include cache is keyed by modification time: make sure it moves.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(common.fsPath, later, later);
    listeners.change(common);
    await settle();
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

  it("a summary left open does not block the next run", async () => {
    // A notification settles only on a click or when it is closed; one that
    // timed out sits in the Notification Center, still open.
    found = [write("open-summary.esi", BROKEN)];
    summaryStaysOpen = true;
    await run();
    await run();
    assert.strictEqual(messages.length, 2);
    assert.ok(
      messages.every((m) => m.message.includes("Checked 1 .esi file")),
      JSON.stringify(messages)
    );
  });

  it("a Clear during a run stops it, saying so", async () => {
    found = [write("cl1.esi", BROKEN), write("cl2.esi", BROKEN)];
    onReport = () => {
      if (reports.length === 2) {
        v.__registered.commands[CLEAR_WORKSPACE_VALIDATION_COMMAND]();
      }
    };
    await run();
    assert.deepStrictEqual(messages.map((m) => m.message), [
      "Workspace validation stopped: its results were cleared.",
    ]);
    assert.strictEqual(published.size, 0);
  });

  it("does not publish a file opened as esi while it was being read", async () => {
    const uri = write("opened-during-read.esi", BROKEN);
    found = [uri];
    const esiDoc = { uri, languageId: "esi", getText: () => BROKEN };
    const promises = fs.promises as any;
    const readFile = promises.readFile;
    promises.readFile = (...args: any[]) => {
      v.workspace.textDocuments = [esiDoc];
      return readFile.apply(promises, args);
    };
    try {
      await run();
    } finally {
      promises.readFile = readFile;
    }
    // The live collection owns it now: no second row here.
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
