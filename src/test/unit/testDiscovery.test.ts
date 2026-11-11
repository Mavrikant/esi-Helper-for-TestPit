import * as assert from "assert";
import type { ValidityIssue } from "../../lib/parseValidityOutput";
import {
  CONTROLLER_LABEL,
  NO_EXE_MESSAGE,
  RUN_DISCLAIMER,
  RUN_NAME,
  VALIDATE_PROFILE_LABEL,
  discoverSteps,
  formatIssue,
  mapValidityToSteps,
  stepContainingLine,
} from "../../lib/testDiscovery";

const SCRIPT = [
  "[TEST DEFINITION]", //            0
  "Test Name = demo", //             1
  "[/TEST DEFINITION]", //           2
  "[TEST STEPS]", //                 3
  "[STEP 10]", //                    4
  "  [STEP DEFINITION]", //          5
  "    Step Description = power on", // 6
  "  [/STEP DEFINITION]", //         7
  "[/STEP 10]", //                   8
  "", //                             9
  "[STEP 20]", //                   10
  "  [STEP INPUTS]", //             11
  "  [/STEP INPUTS]", //            12
  "[/STEP 20]", //                  13
  "[/TEST STEPS]", //               14
].join("\r\n");

function issue(lineNumber: number, severity: "error" | "warning", message = "m"): ValidityIssue {
  return { lineNumber, startCol: 0, endCol: 1, severity, message };
}

const CLEAN = { outcome: "clean" as const, message: "clean" };
const ERRORS = { outcome: "errors" as const, message: "1 error" };
const WARNINGS = { outcome: "warnings" as const, message: "1 warning" };
const NO_LOG = { outcome: "no-log" as const, message: "NOT checked" };

describe("testDiscovery: discoverSteps", () => {
  it("lists the steps with their lines and description (CRLF text)", () => {
    assert.deepStrictEqual(discoverSteps(SCRIPT), [
      { id: "STEP 10", label: "STEP 10", description: "power on", line: 4, endLine: 8 },
      { id: "STEP 20", label: "STEP 20", description: "", line: 10, endLine: 13 },
    ]);
  });

  it("returns nothing for a script without steps", () => {
    assert.deepStrictEqual(discoverSteps("[TEST STEPS]\n[/TEST STEPS]\n"), []);
    assert.deepStrictEqual(discoverSteps(""), []);
  });

  it("keeps duplicate step labels addressable with unique ids", () => {
    const steps = discoverSteps(
      ["[STEP 10]", "[/STEP 10]", "[STEP 10]", "[/STEP 10]", "[STEP 10/]"].join("\n")
    );
    assert.deepStrictEqual(
      steps.map((s) => s.id),
      ["STEP 10", "STEP 10#2", "STEP 10#3"]
    );
    assert.deepStrictEqual(
      steps.map((s) => s.label),
      ["STEP 10", "STEP 10", "STEP 10"]
    );
  });

  it("gives a one-liner step a one-line range", () => {
    const [step] = discoverSteps("[STEP 5/]\nafter\n");
    assert.strictEqual(step.line, 0);
    assert.strictEqual(step.endLine, 0);
  });
});

describe("testDiscovery: stepContainingLine", () => {
  const steps = discoverSteps(SCRIPT);

  it("finds the step by any of its lines, tags included", () => {
    assert.strictEqual(stepContainingLine(steps, 4)?.id, "STEP 10");
    assert.strictEqual(stepContainingLine(steps, 8)?.id, "STEP 10");
    assert.strictEqual(stepContainingLine(steps, 12)?.id, "STEP 20");
  });

  it("returns undefined outside every step", () => {
    assert.strictEqual(stepContainingLine(steps, 0), undefined);
    assert.strictEqual(stepContainingLine(steps, 9), undefined);
    assert.strictEqual(stepContainingLine(steps, 14), undefined);
  });

  it("prefers the step that starts last when blocks overlap", () => {
    const overlapping = [
      { id: "a", line: 0, endLine: 10 },
      { id: "b", line: 5, endLine: 8 },
    ];
    assert.strictEqual(stepContainingLine(overlapping, 6)?.id, "b");
    assert.strictEqual(stepContainingLine(overlapping, 9)?.id, "a");
  });
});

describe("testDiscovery: mapValidityToSteps", () => {
  const steps = discoverSteps(SCRIPT);

  it("passes the script and every step when the run is clean", () => {
    const result = mapValidityToSteps(steps, [], CLEAN);
    assert.strictEqual(result.status, "passed");
    assert.strictEqual(result.message, "clean");
    assert.deepStrictEqual(
      result.steps.map((s) => [s.id, s.status]),
      [
        ["STEP 10", "passed"],
        ["STEP 20", "passed"],
      ]
    );
  });

  it("fails only the step that holds the error; the other step passes", () => {
    const error = issue(11, "error", "bad input");
    const result = mapValidityToSteps(steps, [error], ERRORS);
    assert.strictEqual(result.status, "failed");
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.steps[0].status, "passed");
    assert.strictEqual(result.steps[1].status, "failed");
    assert.deepStrictEqual(result.steps[1].errors, [error]);
  });

  it("keeps an error outside every step on the script; steps still pass", () => {
    const error = issue(1, "error");
    const result = mapValidityToSteps(steps, [error], ERRORS);
    assert.strictEqual(result.status, "failed");
    assert.deepStrictEqual(result.errors, [error]);
    assert.ok(result.steps.every((s) => s.status === "passed"));
  });

  it("does not fail an item for a warning, but records it there", () => {
    const inStep = issue(6, "warning");
    const outside = issue(14, "warning");
    const result = mapValidityToSteps(steps, [inStep, outside], WARNINGS);
    assert.strictEqual(result.status, "passed");
    assert.deepStrictEqual(result.warnings, [outside]);
    assert.strictEqual(result.steps[0].status, "passed");
    assert.deepStrictEqual(result.steps[0].warnings, [inStep]);
    assert.deepStrictEqual(result.steps[0].errors, []);
  });

  it("fails the script for an error TestPit gave no line for", () => {
    // summarizeValidity says "errors" although no located issue is an error.
    // That error may concern any step, so no step is cleared as passed.
    const result = mapValidityToSteps(steps, [], { ...ERRORS, unlocatedErrors: 1 });
    assert.strictEqual(result.status, "failed");
    assert.ok(result.steps.every((s) => s.status === "notChecked"));
  });

  it("keeps a located failure next to an error without a line number", () => {
    const inStep = issue(6, "error");
    const result = mapValidityToSteps(steps, [inStep], { ...ERRORS, unlocatedErrors: 1 });
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(result.steps.slice(1).every((s) => s.status === "notChecked"));
  });

  it("still passes the other steps when every error has a line", () => {
    const inStep = issue(6, "error");
    const result = mapValidityToSteps(steps, [inStep], { ...ERRORS, unlocatedErrors: 0 });
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(result.steps.length > 1);
    assert.ok(result.steps.slice(1).every((s) => s.status === "passed"));
  });

  it("never passes anything when TestPit produced no validation log", () => {
    const result = mapValidityToSteps(steps, [], NO_LOG);
    assert.strictEqual(result.status, "notChecked");
    assert.strictEqual(result.message, "NOT checked");
    assert.ok(result.steps.every((s) => s.status === "notChecked"));
  });

  it("attributes issues to duplicate-labelled steps by position", () => {
    const dup = discoverSteps(["[STEP 1]", "x", "[/STEP 1]", "[STEP 1]", "y", "[/STEP 1]"].join("\n"));
    const result = mapValidityToSteps(dup, [issue(4, "error")], ERRORS);
    assert.deepStrictEqual(
      result.steps.map((s) => [s.id, s.status]),
      [
        ["STEP 1", "passed"],
        ["STEP 1#2", "failed"],
      ]
    );
  });

  it("handles a script without steps", () => {
    const result = mapValidityToSteps([], [issue(0, "error")], ERRORS);
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.errors.length, 1);
    assert.deepStrictEqual(result.steps, []);
  });
});

describe("testDiscovery: wording", () => {
  it("formats an issue with its 1-based line", () => {
    assert.strictEqual(formatIssue(issue(4, "error", "boom")), "Error (line 5): boom");
    assert.strictEqual(formatIssue(issue(0, "warning", "hm")), "Warning (line 1): hm");
  });

  it("names the profile after the validity check, not a test run", () => {
    assert.strictEqual(VALIDATE_PROFILE_LABEL, "Validate (TestPit validity check)");
    for (const text of [CONTROLLER_LABEL, RUN_NAME]) {
      assert.match(text, /validity check/i);
    }
  });

  it("says a pass is not a hardware result, and how to fix a missing exe", () => {
    const disclaimer = RUN_DISCLAIMER.join(" ");
    assert.match(disclaimer, /NOT executed/);
    assert.match(disclaimer, /hardware/);
    assert.match(NO_EXE_MESSAGE, /Skipped/);
    assert.match(NO_EXE_MESSAGE, /Pick TestPit Executable/);
  });
});
