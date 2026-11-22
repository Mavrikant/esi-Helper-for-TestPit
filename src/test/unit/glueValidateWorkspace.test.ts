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
/** A root script using %SPEED%, which it gets from the files it includes. */
const rootIncluding = (...files: string[]): string =>
  "[INCLUDE]\r\n" +
  files.map((f) => `    include file = ${f}\r\n`).join("") +
  "[/INCLUDE]\r\n[TEST STEPS]\r\n    x = %SPEED%\r\n[/TEST STEPS]\r\n";
const WITHOUT_SPEED = "[VARIABLES]\r\n[/VARIABLES]\r\n";
const WITH_SPEED = "[VARIABLES]\r\n    %SPEED% = 5\r\n[/VARIABLES]\r\n";

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
  /** Set / delete calls per uri: one per (re-)check of a covered file. */
  const writes = new Map<string, number>();
  const listeners: Record<string, (arg: any) => void> = {};
  /** Every watcher made: its pattern, listeners and whether it was disposed. */
  const watchers: Array<{ pattern: any; on: Record<string, (uri: any) => void>; disposed: boolean }> = [];
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
  /** Past the includer debounce (300 ms) and the re-check it starts. */
  const settleIncluders = (): Promise<void> => new Promise((r) => setTimeout(r, 400));
  const codesOf = (uri: any): string[] =>
    (published.get(uri.toString()) ?? []).map((d: any) => d.code);
  const touch = (uri: any): void => {
    // The include cache is keyed by modification time: make sure it moves.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(uri.fsPath, later, later);
  };

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
    patch(v.workspace, "onDidChangeTextDocument", (l: any) => {
      listeners.edit = l;
      return { dispose() {} };
    });
    patch(v.workspace, "createFileSystemWatcher", (pattern: any) => {
      const w = { pattern, on: {} as Record<string, (uri: any) => void>, disposed: false };
      watchers.push(w);
      const listen = (key: string) => (l: any) => {
        w.on[key] = l;
        listeners[key] = l;
        return { dispose() {} };
      };
      return {
        onDidChange: listen("change"),
        onDidCreate: listen("create"),
        onDidDelete: listen("delete"),
        dispose() { w.disposed = true; },
      };
    });
    const wrote = (uri: any): void => {
      writes.set(uri.toString(), (writes.get(uri.toString()) ?? 0) + 1);
    };
    patch(v.languages, "createDiagnosticCollection", (name: string) => {
      collectionName = name;
      return {
        set(uri: any, diags: any[]) { wrote(uri); published.set(uri.toString(), diags); },
        delete(uri: any) { wrote(uri); published.delete(uri.toString()); },
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
    writes.clear();
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
    await settleIncluders();
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
    write("inc-common.esi", "[VARIABLES]\r\n    %SPEED% = 5\r\n[/VARIABLES]\r\n");
    touch(common);
    listeners.change(common);
    await settleIncluders();
    assert.strictEqual(published.size, 0);
  });

  it("re-checks a covered file from disk once an include's unsaved buffer is closed", async () => {
    const root = write("buf-root.esi", rootIncluding("buf-common.esi"));
    const common = write("buf-common.esi", WITHOUT_SPEED);
    // Open, with an unsaved definition of %SPEED%: the run reads the buffer.
    const doc = { uri: common, languageId: "esi", isDirty: true, getText: () => WITH_SPEED };
    v.workspace.textDocuments = [doc];
    found = [root, common];
    await run();
    assert.deepStrictEqual(codesOf(root), []);
    // Closed without saving: the disk text is what counts again.
    v.workspace.textDocuments = [];
    listeners.close(doc);
    await settleIncluders();
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
  });

  it("re-checks a covered file when an include's buffer is reverted, not per keystroke", async () => {
    const root = write("rev-root.esi", rootIncluding("rev-common.esi"));
    const common = write("rev-common.esi", WITHOUT_SPEED);
    let text = WITH_SPEED;
    const doc = { uri: common, languageId: "esi", isDirty: true, getText: () => text };
    v.workspace.textDocuments = [doc];
    found = [root];
    await run();
    assert.deepStrictEqual(codesOf(root), []);
    writes.clear();
    // Typing on (still unsaved): nothing to re-check yet.
    listeners.edit({ document: doc, contentChanges: [{ text: "x" }] });
    await settleIncluders();
    assert.strictEqual(writes.get(root.toString()), undefined);
    // File: Revert: the buffer is the disk text again.
    text = WITHOUT_SPEED;
    doc.isDirty = false;
    listeners.edit({ document: doc, contentChanges: [{ text: "" }] });
    await settleIncluders();
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
  });

  it("re-checks a covered file once when several of its includes change together", async () => {
    // A checkout rewriting the shared utility scripts.
    const root = write("many-root.esi", rootIncluding("many-a.esi", "many-b.esi"));
    const a = write("many-a.esi", WITH_SPEED);
    const b = write("many-b.esi", WITHOUT_SPEED);
    found = [root];
    await run();
    assert.deepStrictEqual(codesOf(root), []);
    writes.clear();
    write("many-a.esi", WITHOUT_SPEED);
    touch(a);
    listeners.change(a);
    listeners.change(b);
    await settleIncluders();
    assert.strictEqual(writes.get(root.toString()), 1);
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
  });

  it("re-checks a covered file again when an include changes after it in the same burst", async () => {
    // A checkout writes the script first, its include ~100 ms later: the
    // script's own re-check read the old include.
    const root = write("burst-root.esi", rootIncluding("burst-common.esi"));
    const common = write("burst-common.esi", WITH_SPEED);
    found = [root];
    await run();
    assert.deepStrictEqual(codesOf(root), []);
    touch(root);
    listeners.change(root);
    await new Promise((r) => setTimeout(r, 100));
    write("burst-common.esi", WITHOUT_SPEED);
    touch(common);
    listeners.change(common);
    await settleIncluders();
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
  });

  it("does not let changes to files nothing includes hold the includer pass back", async () => {
    const root = write("quiet-root.esi", rootIncluding("quiet-common.esi"));
    const common = write("quiet-common.esi", WITH_SPEED);
    const log = write("quiet-other.esi", CLEAN);
    found = [root];
    await run();
    write("quiet-common.esi", WITHOUT_SPEED);
    touch(common);
    listeners.change(common);
    // Another file, included by nothing, changing every 100 ms meanwhile.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 100));
      listeners.change(log);
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
  });

  it("does not walk every covered file's includes once per re-check", async () => {
    // Each sync of the outside-workspace watchers looks at every include of
    // every covered file; a pass re-checking all includers must not run one
    // per file (O(N²) on a large suite).
    const shared = write("walk-shared.esi", WITH_SPEED);
    const roots: any[] = [];
    for (let i = 0; i < 15; i++) {
      roots.push(write(`walk-root-${i}.esi`, rootIncluding("walk-shared.esi")));
    }
    found = roots;
    await run();
    let reads = 0;
    saved.push([v.workspace, "workspaceFolders", Object.getOwnPropertyDescriptor(v.workspace, "workspaceFolders")]);
    Object.defineProperty(v.workspace, "workspaceFolders", {
      configurable: true,
      get: () => {
        reads++;
        return undefined;
      },
    });
    try {
      writes.clear();
      touch(shared);
      listeners.change(shared);
      await settleIncluders();
      assert.strictEqual(writes.size, 15, "every includer re-checked");
      assert.ok(reads < 15, `workspace folders read ${reads} times`);
    } finally {
      const [obj, key, desc] = saved.pop()!;
      Object.defineProperty(obj, key, desc!);
    }
  });

  it("watches an include outside the workspace folders on its own", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "esi-ws-out-"));
    try {
      const outside = vscode.Uri.file(path.join(elsewhere, "lib.esi"));
      fs.writeFileSync(outside.fsPath, WITH_SPEED);
      write("near.esi", WITH_SPEED);
      patch(v.workspace, "workspaceFolders", [{ uri: vscode.Uri.file(dir) }]);
      const root = write("out-root.esi", rootIncluding(outside.fsPath, "near.esi"));
      found = [root];
      const before = watchers.length;
      await run();
      assert.deepStrictEqual(codesOf(root), []);
      // One watcher, for the include outside `dir` only.
      const own = watchers.slice(before);
      assert.strictEqual(own.length, 1);
      assert.strictEqual(path.resolve(own[0].pattern.base), elsewhere);
      assert.strictEqual(own[0].pattern.pattern, "lib.esi");

      fs.writeFileSync(outside.fsPath, WITHOUT_SPEED);
      fs.writeFileSync(path.join(dir, "near.esi"), WITHOUT_SPEED);
      touch(outside);
      touch(uriOf("near.esi"));
      own[0].on.change(outside);
      await settleIncluders();
      assert.deepStrictEqual(codesOf(root), ["undefinedMacro"]);
      // Cleared: nothing depends on it any more.
      v.__registered.commands[CLEAR_WORKSPACE_VALIDATION_COMMAND]();
      assert.strictEqual(own[0].disposed, true);
    } finally {
      const [obj, key, desc] = saved.pop()!;
      if (desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete obj[key];
      }
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("publishes and watches nothing once disposed, with a re-check still reading", async () => {
    // A second registration, torn down while a re-check it started is in
    // flight; the suite's own one gets its commands and listeners back.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "esi-ws-disp-"));
    const savedCommands = { ...v.__registered.commands };
    const savedListeners = { ...listeners };
    try {
      const lib1 = path.join(elsewhere, "lib1.esi");
      const lib2 = path.join(elsewhere, "lib2.esi");
      fs.writeFileSync(lib1, WITH_SPEED);
      fs.writeFileSync(lib2, WITH_SPEED);
      const root = write("disp-root.esi", rootIncluding(lib1));
      const second = registerValidateWorkspace();
      found = [root];
      await v.__registered.commands[VALIDATE_WORKSPACE_COMMAND]();
      const made = watchers.length;
      writes.clear();
      // It now includes another file outside: a re-check would watch it.
      write("disp-root.esi", rootIncluding(lib2));
      listeners.change(root);
      second.dispose();
      await settle();
      assert.strictEqual(writes.get(root.toString()), undefined, "published after dispose");
      assert.strictEqual(watchers.length, made, "watcher made after dispose");
    } finally {
      Object.assign(v.__registered.commands, savedCommands);
      Object.assign(listeners, savedListeners);
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
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
