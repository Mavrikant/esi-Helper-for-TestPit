import * as assert from "assert";
import { findStepLine } from "../../lib/findStepLine";

describe("findStepLine", () => {
  const sample = [
    "preamble",
    "[STEP 10]",
    "body",
    "[/STEP 10]",
    "[STEP 20]",
    "more body",
    "[/STEP 20]",
  ].join("\n");

  it("returns the 0-indexed line of an existing step", () => {
    assert.strictEqual(findStepLine(sample, "10"), 1);
    assert.strictEqual(findStepLine(sample, "20"), 4);
  });

  it("returns -1 when the step is not present", () => {
    assert.strictEqual(findStepLine(sample, "99"), -1);
  });

  it("returns -1 for an empty document", () => {
    assert.strictEqual(findStepLine("", "10"), -1);
  });

  it("does not match a step number that is a prefix of another", () => {
    const text = "[STEP 100]\n[/STEP 100]";
    assert.strictEqual(findStepLine(text, "10"), -1);
  });
});
