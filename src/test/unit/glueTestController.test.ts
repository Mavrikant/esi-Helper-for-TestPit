import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { NO_EXE_MESSAGE, VALIDATE_PROFILE_LABEL } from "../../lib/testDiscovery";
import type * as controllerModule from "../../testing/esiTestController";

// Glue for the Test Explorer integration, driven through the vscode mock
// (test/setup.js). The Testing API pieces the mock lacks are installed for
// this suite only and restored afterwards. TestPit.exe is never run: the
// controller's `validate` dependency is replaced.
//
// The compiled sources read `vscode` through an import-star copy made when a
// module is first loaded, so a TOP-LEVEL key added to the mock afterwards is
// invisible to it. Hence: top-level keys are only added when the mock lacks
// them, `tests.createTestController` is patched on the (shared) nested object,
// and the controller module is loaded fresh once everything is in place.
const v = require("vscode") as any;
const CONTROLLER_MODULE = "../../testing/esiTestController";

const SCRIPT = [
  "[TEST STEPS]", //   0
  "[STEP 10]", //      1
  "  a = 1", //        2
  "[/STEP 10]", //     3
  "[STEP 20]", //      4
  "  b = 2", //        5
  "[/STEP 20]", //     6
  "[/TEST STEPS]", //  7
].join("\r\n");

class FakeCollection {
  private map = new Map<string, any>();
  get size(): number { return this.map.size; }
  add(item: any): void { this.map.set(item.id, item); item.parent = this.owner; }
  delete(id: string): void { this.map.delete(id); }
  get(id: string): any { return this.map.get(id); }
  forEach(fn: (item: any) => void): void { [...this.map.values()].forEach(fn); }
  replace(items: any[]): void { this.map.clear(); items.forEach((i) => this.add(i)); }
  constructor(private owner?: any) {}
}

interface RunLog {
  name?: string;
  states: Record<string, string>;
  messages: Record<string, any[]>;
  output: Array<{ text: string; location?: any; test?: string }>;
  ended: boolean;
}

describe("esiTestController (glue)", () => {
  let dir: string;
  let controller: any;
  let profile: any;
  let disposable: vscode.Disposable;
  let exe: string | undefined;
  let validate: (doc: any) => { output: string; issues: any[] };
  let validated: string[] = [];
  let found: any[] = [];
  let openDocs: any[] = [];
  let runs: RunLog[] = [];
  const listeners: Record<string, (arg: any) => void> = {};
  const saved: Array<[any, string, PropertyDescriptor | undefined]> = [];

  const patch = (obj: any, key: string, value: any): void => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    obj[key] = value;
  };
  const write = (name: string, text: string): any => {
    fs.writeFileSync(path.join(dir, name), text, "utf-8");
    return vscode.Uri.file(path.join(dir, name));
  };
  const docOf = (uri: any, text: string): any => ({
    uri,
    languageId: "esi",
    version: 1,
    isClosed: false,
    getText: () => text,
  });
  const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const runAll = (request: any = {}): Promise<void> =>
    profile.runHandler({ include: undefined, exclude: undefined, ...request }, token);
  const lastRun = (): RunLog => runs[runs.length - 1];
  const stepIds = (file: any): string[] => {
    const ids: string[] = [];
    file.children.forEach((c: any) => ids.push(c.label));
    return ids;
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "esi-tests-"));
    if (!v.TestRunProfileKind) {
      patch(v, "TestRunProfileKind", { Run: 1, Debug: 2, Coverage: 3 });
    }
    if (!v.TestMessage) {
      patch(
        v,
        "TestMessage",
        class TestMessage {
          location: any;
          constructor(public message: string) {}
        }
      );
    }
    if (!v.tests) {
      patch(v, "tests", {});
    }
    patch(v.tests, "createTestController", (id: string, label: string) => {
      {
        controller = {
          id,
          label,
          items: new FakeCollection(),
          createTestItem(itemId: string, itemLabel: string, uri: any) {
            const item: any = { id: itemId, label: itemLabel, uri, canResolveChildren: false };
            item.children = new FakeCollection(item);
            return item;
          },
          createRunProfile(profileLabel: string, kind: number, runHandler: any, isDefault: boolean) {
            profile = { label: profileLabel, kind, runHandler, isDefault, dispose() {} };
            return profile;
          },
          createTestRun(_request: any, name: string) {
            const log: RunLog = { name, states: {}, messages: {}, output: [], ended: false };
            runs.push(log);
            const set = (state: string) => (item: any, messages?: any) => {
              log.states[item.id] = state;
              if (messages !== undefined) {
                log.messages[item.id] = Array.isArray(messages) ? messages : [messages];
              }
            };
            return {
              started: (item: any) => { log.states[item.id] ??= "started"; },
              passed: set("passed"),
              failed: set("failed"),
              errored: set("errored"),
              skipped: set("skipped"),
              appendOutput: (text: string, location?: any, test?: any) =>
                log.output.push({ text, location, test: test?.id }),
              end: () => { log.ended = true; },
            };
          },
          dispose() {},
        };
        return controller;
      }
    });
    patch(v.workspace, "asRelativePath", (uri: any) => path.relative(dir, uri.fsPath));
    patch(v.workspace, "findFiles", () => Promise.resolve(found));
    patch(v.workspace, "textDocuments", openDocs);
    patch(v.workspace, "openTextDocument", (uri: any) => {
      const open = openDocs.find((d) => d.uri.toString() === uri.toString());
      if (open) {
        return Promise.resolve(open);
      }
      try {
        return Promise.resolve(docOf(uri, fs.readFileSync(uri.fsPath, "utf-8")));
      } catch (err) {
        return Promise.reject(err);
      }
    });
    for (const [event, key] of [
      ["onDidOpenTextDocument", "open"],
      ["onDidCloseTextDocument", "close"],
      ["onDidChangeTextDocument", "edit"],
    ]) {
      patch(v.workspace, event, (l: any) => {
        listeners[key] = l;
        return { dispose() {} };
      });
    }
    patch(v.workspace, "createFileSystemWatcher", () => ({
      onDidChange(l: any) { listeners.diskChange = l; return { dispose() {} }; },
      onDidCreate(l: any) { listeners.diskCreate = l; return { dispose() {} }; },
      onDidDelete(l: any) { listeners.diskDelete = l; return { dispose() {} }; },
      dispose() {},
    }));
    delete require.cache[require.resolve(CONTROLLER_MODULE)];
    const { registerEsiTestController } = require(CONTROLLER_MODULE) as typeof controllerModule;
    disposable = registerEsiTestController({
      getExe: () => exe,
      validate: (doc: any) => {
        validated.push(path.basename(doc.uri.fsPath));
        return Promise.resolve(validate(doc));
      },
      reparseDelayMs: 1,
    });
  });

  after(() => {
    disposable?.dispose();
    // Do not leave a module bound to this suite's patched mock behind.
    delete require.cache[require.resolve(CONTROLLER_MODULE)];
    for (const [obj, key, desc] of saved.reverse()) {
      if (desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete obj[key];
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    exe = "C:\\TestPit\\TestPit.exe";
    validate = () => ({ output: "[Info] done", issues: [] });
    validated = [];
    runs = [];
    openDocs.length = 0;
    found = [write("a.esi", SCRIPT), write("b.esi", "[TEST STEPS]\r\n[/TEST STEPS]\r\n")];
    controller.items.replace([]);
    await controller.resolveHandler(undefined);
  });

  it("offers exactly one run profile, named after the validity check", () => {
    assert.strictEqual(profile.label, VALIDATE_PROFILE_LABEL);
    assert.strictEqual(profile.kind, v.TestRunProfileKind.Run);
    assert.match(controller.label, /validity check/i);
  });

  it("lists every .esi file lazily and resolves steps with ranges on demand", async () => {
    assert.strictEqual(controller.items.size, 2);
    const a = controller.items.get(found[0].toString());
    assert.strictEqual(a.label, "a.esi");
    assert.strictEqual(a.canResolveChildren, true);
    assert.strictEqual(a.children.size, 0);

    await controller.resolveHandler(a);
    assert.deepStrictEqual(stepIds(a), ["STEP 10", "STEP 20"]);
    const step20 = a.children.get(a.id + "::STEP 20");
    assert.strictEqual(step20.range.start.line, 4);
    assert.strictEqual(step20.range.end.line, 6);
  });

  it("follows file creation, change and deletion on disk", async () => {
    const a = controller.items.get(found[0].toString());
    await controller.resolveHandler(a);

    const c = write("c.esi", "[STEP 1/]\r\n");
    listeners.diskCreate(c);
    assert.ok(controller.items.get(c.toString()));

    write("a.esi", "\uFEFF[STEP 30]\r\n[/STEP 30]\r\n");
    listeners.diskChange(found[0]);
    await settle();
    assert.deepStrictEqual(stepIds(a), ["STEP 30"]);

    listeners.diskDelete(c);
    assert.strictEqual(controller.items.get(c.toString()), undefined);
  });

  it("tracks an open document's buffer (debounced), and the disk again on close", async () => {
    const doc = docOf(found[0], "[STEP 77]\r\n[/STEP 77]\r\n");
    openDocs.push(doc);
    listeners.open(doc);
    const a = controller.items.get(found[0].toString());
    assert.deepStrictEqual(stepIds(a), ["STEP 77"]);

    doc.getText = () => "[STEP 78]\r\n[/STEP 78]\r\n";
    listeners.edit({ document: doc });
    assert.deepStrictEqual(stepIds(a), ["STEP 77"]);
    await settle();
    assert.deepStrictEqual(stepIds(a), ["STEP 78"]);

    openDocs.length = 0;
    listeners.close(doc);
    await settle();
    assert.deepStrictEqual(stepIds(a), ["STEP 10", "STEP 20"]);
  });

  it("ignores documents that are not .esi files", () => {
    const before = controller.items.size;
    listeners.open({ ...docOf(vscode.Uri.file(path.join(dir, "x.txt")), "[STEP 1/]"), languageId: "plaintext" });
    assert.strictEqual(controller.items.size, before);
  });

  it("skips everything, without validating, when no TestPit.exe is configured", async () => {
    exe = undefined;
    const a = controller.items.get(found[0].toString());
    await controller.resolveHandler(a);
    await runAll();
    const run = lastRun();
    assert.deepStrictEqual(validated, []);
    assert.strictEqual(run.states[a.id], "skipped");
    assert.strictEqual(run.states[a.id + "::STEP 10"], "skipped");
    assert.strictEqual(run.states[found[1].toString()], "skipped");
    assert.ok(run.output.some((o) => o.text.includes(NO_EXE_MESSAGE)));
    assert.strictEqual(run.ended, true);
  });

  it("passes the script and its steps on a clean validity log, and says what that means", async () => {
    await runAll();
    const run = lastRun();
    const a = found[0].toString();
    assert.deepStrictEqual(validated, ["a.esi", "b.esi"]);
    assert.strictEqual(run.states[a], "passed");
    assert.strictEqual(run.states[a + "::STEP 10"], "passed");
    assert.strictEqual(run.states[a + "::STEP 20"], "passed");
    assert.strictEqual(run.states[found[1].toString()], "passed");
    assert.match(run.name ?? "", /validity check/i);
    assert.match(run.output[0].text, /NOT executed/);
    assert.strictEqual(run.ended, true);
  });

  it("fails the step holding the error, with a located message; the other step passes", async () => {
    validate = (doc) =>
      doc.uri.fsPath.endsWith("a.esi")
        ? {
            output: "[Error] bad Line: 6\n[Warn.] odd Line: 3",
            issues: [
              { lineNumber: 5, startCol: 2, endCol: 7, severity: "error", message: "bad" },
              { lineNumber: 2, startCol: 2, endCol: 7, severity: "warning", message: "odd" },
            ],
          }
        : { output: "[Info] done", issues: [] };
    await runAll();
    const run = lastRun();
    const a = found[0].toString();
    assert.strictEqual(run.states[a], "failed");
    assert.strictEqual(run.states[a + "::STEP 10"], "passed");
    assert.strictEqual(run.states[a + "::STEP 20"], "failed");
    const [message] = run.messages[a + "::STEP 20"];
    assert.match(message.message, /line 6.*bad/);
    assert.strictEqual(message.location.range.start.line, 5);
    assert.strictEqual(message.location.uri.toString(), a);
    // The warning does not fail STEP 10 but is in the output, on its line.
    const warning = run.output.find((o) => o.text.includes("odd") && o.test === a + "::STEP 10");
    assert.strictEqual(warning?.location.range.start.line, 2);
    assert.strictEqual(run.states[found[1].toString()], "passed");
  });

  it("puts an error outside every step on the script item", async () => {
    validate = () => ({
      output: "[Error] top Line: 1",
      issues: [{ lineNumber: 0, startCol: 0, endCol: 3, severity: "error", message: "top" }],
    });
    const a = controller.items.get(found[0].toString());
    await runAll({ include: [a] });
    const run = lastRun();
    assert.deepStrictEqual(validated, ["a.esi"]);
    assert.strictEqual(run.states[a.id], "failed");
    assert.ok(run.messages[a.id].some((m) => m.location?.range.start.line === 0));
    assert.strictEqual(run.states[a.id + "::STEP 10"], "passed");
  });

  it("reports 'not checked' as an error, never a pass, when TestPit printed no log", async () => {
    validate = () => ({ output: "'TestPit.exe' is not recognized", issues: [] });
    const a = controller.items.get(found[0].toString());
    await runAll({ include: [a] });
    const run = lastRun();
    assert.strictEqual(run.states[a.id], "errored");
    assert.match(run.messages[a.id][0].message, /NOT checked/);
    assert.strictEqual(run.states[a.id + "::STEP 10"], "skipped");
  });

  it("reports only the requested step, and honours exclude", async () => {
    const a = controller.items.get(found[0].toString());
    await controller.resolveHandler(a);
    const step10 = a.children.get(a.id + "::STEP 10");
    await runAll({ include: [step10] });
    let run = lastRun();
    assert.deepStrictEqual(validated, ["a.esi"]);
    assert.strictEqual(run.states[step10.id], "passed");
    assert.strictEqual(run.states[a.id + "::STEP 20"], undefined);

    validated = [];
    await runAll({ exclude: [a] });
    run = lastRun();
    assert.deepStrictEqual(validated, ["b.esi"]);
    assert.strictEqual(run.states[a.id], undefined);
  });

  it("errors the script when it cannot be opened", async () => {
    const a = controller.items.get(found[0].toString());
    fs.unlinkSync(found[0].fsPath);
    await runAll({ include: [a] });
    const run = lastRun();
    assert.strictEqual(run.states[a.id], "errored");
    assert.match(run.messages[a.id][0].message, /Not validated/);
    assert.deepStrictEqual(validated, []);
  });

  it("stops between scripts when the run is cancelled", async () => {
    const cancelled = { ...token, isCancellationRequested: true };
    await profile.runHandler({ include: undefined, exclude: undefined }, cancelled);
    assert.deepStrictEqual(validated, []);
    assert.strictEqual(lastRun().ended, true);
  });
});
