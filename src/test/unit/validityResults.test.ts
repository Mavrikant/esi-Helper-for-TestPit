import * as assert from "assert";
import {
  createRunTracker,
  createVersionGate,
  summarizeValidity,
} from "../../lib/validityResults";
import { parseValidityOutput } from "../../lib/parseValidityOutput";

describe("createVersionGate", () => {
  it("accepts increasing versions and the same version again", () => {
    const gate = createVersionGate<string>();
    assert.strictEqual(gate.accept("a", 3), true);
    assert.strictEqual(gate.accept("a", 3), true);
    assert.strictEqual(gate.accept("a", 7), true);
  });

  it("rejects a result for an older version than the one already shown", () => {
    const gate = createVersionGate<string>();
    gate.accept("a", 7);
    assert.strictEqual(gate.accept("a", 6), false);
    // ...and the stale attempt did not lower the bar.
    assert.strictEqual(gate.accept("a", 6), false);
    assert.strictEqual(gate.accept("a", 7), true);
  });

  it("tracks keys independently", () => {
    const gate = createVersionGate<string>();
    gate.accept("a", 9);
    assert.strictEqual(gate.accept("b", 1), true);
  });

  it("forget() restarts a key (document reopened at version 1)", () => {
    const gate = createVersionGate<string>();
    gate.accept("a", 9);
    gate.forget("a");
    assert.strictEqual(gate.accept("a", 1), true);
  });
});

describe("summarizeValidity", () => {
  const doc = ["one", "two", "three"];
  const summarize = (output: string) =>
    summarizeValidity(output, parseValidityOutput(output, doc));

  it("reports clean when TestPit logged and found nothing", () => {
    const s = summarize("12:00:00 [Info] Validity check finished\r\n");
    assert.strictEqual(s.outcome, "clean");
    assert.strictEqual(s.errors, 0);
    assert.strictEqual(s.warnings, 0);
    assert.match(s.message, /clean/);
  });

  it("counts errors and warnings (Fatal counts as an error)", () => {
    const s = summarize(
      [
        "[Info] start",
        "[Error] bad field Line: 1",
        "[Fatal] cannot continue Line: 2",
        "[Warn.] sloppy tag Line: 3",
      ].join("\n")
    );
    assert.strictEqual(s.outcome, "errors");
    assert.strictEqual(s.errors, 2);
    assert.strictEqual(s.warnings, 1);
    assert.strictEqual(s.unlocated, 0);
    assert.strictEqual(s.message, "TestPit validity check: 2 errors, 1 warning.");
  });

  it("is 'warnings' when there are only warnings", () => {
    const s = summarize("[Warn.] sloppy tag Line: 3");
    assert.strictEqual(s.outcome, "warnings");
    assert.strictEqual(s.message, "TestPit validity check: 1 warning.");
  });

  it("does not call a run clean when a problem has no line number", () => {
    const s = summarize("[Info] start\n[Error] config file not found");
    assert.strictEqual(s.errors, 0);
    assert.strictEqual(s.unlocated, 1);
    assert.strictEqual(s.outcome, "errors");
    assert.match(s.message, /1 error without a line number/);
  });

  it("reports a line-less [Error]/[Fatal] as an error, a line-less [Warn.] as a warning", () => {
    assert.strictEqual(summarize("[Info] start\n[Fatal] cannot open cable config").outcome, "errors");
    const warn = summarize("[Info] start\n[Warn.] deprecated option");
    assert.strictEqual(warn.outcome, "warnings");
    assert.match(warn.message, /1 message without a line number/);
    const both = summarize("[Error] no config\n[Warn.] deprecated option");
    assert.strictEqual(both.outcome, "errors");
    assert.strictEqual(both.unlocated, 2);
    assert.match(both.message, /1 error without a line number.*1 message without a line number/);
  });

  it("does not call a run clean when TestPit produced no log at all", () => {
    for (const output of [
      "",
      "'TestPit.exe' is not recognized as an internal or external command",
    ]) {
      const s = summarize(output);
      assert.strictEqual(s.outcome, "no-log");
      assert.match(s.message, /NOT checked/);
    }
  });

  it("handles CRLF output", () => {
    const s = summarize("[Info] start\r\n[Error] bad Line: 1\r\n");
    assert.strictEqual(s.errors, 1);
    assert.strictEqual(s.unlocated, 0);
  });
});

describe("createRunTracker", () => {
  it("reports start and end once each, per key", () => {
    const events: string[] = [];
    const t = createRunTracker<string>((k, running) => events.push(`${k}:${running}`));
    assert.strictEqual(t.isRunning("a"), false);
    t.begin("a");
    t.begin("b");
    assert.strictEqual(t.isRunning("a"), true);
    t.end("a");
    assert.strictEqual(t.isRunning("a"), false);
    assert.strictEqual(t.isRunning("b"), true);
    assert.deepStrictEqual(events, ["a:true", "b:true", "a:false"]);
  });

  it("stays running until every overlapping run has ended", () => {
    const events: boolean[] = [];
    const t = createRunTracker<string>((_k, running) => events.push(running));
    t.begin("a");
    t.begin("a");
    t.end("a");
    assert.strictEqual(t.isRunning("a"), true);
    t.end("a");
    assert.deepStrictEqual(events, [true, false]);
  });

  it("ignores an end() without a begin(), and after clear()", () => {
    const events: boolean[] = [];
    const t = createRunTracker<string>((_k, running) => events.push(running));
    t.end("a");
    t.begin("a");
    t.clear();
    assert.strictEqual(t.isRunning("a"), false);
    t.end("a");
    assert.deepStrictEqual(events, [true]);
  });

  it("works without a listener", () => {
    const t = createRunTracker<number>();
    t.begin(1);
    t.end(1);
    assert.strictEqual(t.isRunning(1), false);
  });
});
