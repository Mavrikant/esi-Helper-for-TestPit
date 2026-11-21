import * as assert from "assert";
import { applyEdits } from "../../lib/quickFixes";
import { renumberSteps } from "../../lib/renumberSteps";
import {
  RENUMBER_STEPS_FIX_TITLE,
  checkSteps,
  computeRenumberStepsFix,
  isStepIssueKind,
} from "../../lib/stepChecks";

describe("checkSteps", () => {
  it("reports nothing for ascending, unique step numbers", () => {
    const text = "[STEP 10]\n[/STEP 10]\n[STEP 15]\n[/STEP 15]\n[STEP 20/]";
    assert.deepStrictEqual(checkSteps(text), []);
  });

  it("warns on a duplicate step number, on the later step's digits", () => {
    const text = "[STEP 10]\r\n[/STEP 10]\r\n  [STEP 10]\r\n  [/STEP 10]\r\n";
    assert.deepStrictEqual(checkSteps(text), [
      {
        line: 2,
        startCol: 8,
        endCol: 10,
        message: "Step number 10 is already used by the step at line 1.",
        identifier: "STEP 10",
        kind: "duplicateStepNumber",
        severity: "warning",
      },
    ]);
  });

  it("treats 010 and 10 as the same number", () => {
    const issues = checkSteps("[STEP 10]\n[/STEP 10]\n[STEP 010]\n[/STEP 010]");
    assert.deepStrictEqual(issues.map((i) => i.kind), ["duplicateStepNumber"]);
  });

  it("gives information (not a warning) for a number lower than the previous step", () => {
    const issues = checkSteps("[STEP 20]\n[/STEP 20]\n[STEP 10]\n[/STEP 10]\n[STEP 30]\n[/STEP 30]");
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "stepOutOfOrder");
    assert.strictEqual(issues[0].severity, "information");
    assert.strictEqual(issues[0].line, 2);
    assert.match(issues[0].message, /Step 10 comes after step 20/);
  });

  it("reports a repeated number once, as a duplicate only", () => {
    const issues = checkSteps("[STEP 10]\n[/STEP 10]\n[STEP 20]\n[/STEP 20]\n[STEP 10]\n[/STEP 10]");
    assert.deepStrictEqual(issues.map((i) => i.kind), ["duplicateStepNumber"]);
  });

  it("looks at one-liners and sloppy tags, never at closers", () => {
    const issues = checkSteps("[STEP 10/]\n[[STEP 10]]\n[/STEP 10]\n[/STEP 10]");
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].line, 1);
    assert.deepStrictEqual([issues[0].startCol, issues[0].endCol], [7, 9]);
  });

  it("ignores non-numeric and macro step ids, step parts and comments", () => {
    const text = [
      "[STEP GET_DUMP]", "[/STEP GET_DUMP]",
      "[STEP GET_DUMP]", "[/STEP GET_DUMP]",
      "[STEP %N%]", "[/STEP %N%]",
      "[STEP %N%]", "[/STEP %N%]",
      "[STEP INPUTS]", "[/STEP INPUTS]",
      "[STEP INPUTS]", "[/STEP INPUTS]",
      "# [STEP 10]", "# [STEP 10]",
    ].join("\n");
    assert.deepStrictEqual(checkSteps(text), []);
  });
});

describe("computeRenumberStepsFix", () => {
  it("offers 'Renumber steps' with the same result as the command", () => {
    const text = "[STEP 20]\r\n[/STEP 20]\r\n[STEP 10]\r\n[/STEP 10]\r\n[STEP 10]\r\n[/STEP 10]";
    assert.ok(checkSteps(text).length > 0);
    const fix = computeRenumberStepsFix(text);
    assert.ok(fix);
    assert.strictEqual(fix.title, RENUMBER_STEPS_FIX_TITLE);
    assert.strictEqual(fix.preferred, false);
    const fixed = applyEdits(text, fix.edits);
    assert.strictEqual(fixed, renumberSteps(text));
    assert.deepStrictEqual(checkSteps(fixed), []);
  });

  it("offers nothing when the steps are already sequential", () => {
    assert.strictEqual(computeRenumberStepsFix("[STEP 10]\n[/STEP 10]"), undefined);
  });
});

describe("isStepIssueKind", () => {
  it("recognises only the step kinds", () => {
    assert.strictEqual(isStepIssueKind("duplicateStepNumber"), true);
    assert.strictEqual(isStepIssueKind("stepOutOfOrder"), true);
    assert.strictEqual(isStepIssueKind("duplicateKey"), false);
    assert.strictEqual(isStepIssueKind(undefined), false);
  });
});
