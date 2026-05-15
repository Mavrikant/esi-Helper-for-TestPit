import * as assert from "assert";
import { renumberSteps } from "../../lib/renumberSteps";

describe("renumberSteps", () => {
  it("renumbers a single step pair to 10/10", () => {
    const input = "[STEP 1]\nbody\n[/STEP 1]";
    assert.strictEqual(renumberSteps(input), "[STEP 10]\nbody\n[/STEP 10]");
  });

  it("renumbers sequential steps with 10-increment by default", () => {
    const input = "[STEP 5]\na\n[/STEP 5]\n[STEP 7]\nb\n[/STEP 7]\n[STEP 99]\nc\n[/STEP 99]";
    const expected =
      "[STEP 10]\na\n[/STEP 10]\n[STEP 20]\nb\n[/STEP 20]\n[STEP 30]\nc\n[/STEP 30]";
    assert.strictEqual(renumberSteps(input), expected);
  });

  it("respects a custom increment", () => {
    const input = "[STEP 1][/STEP 1][STEP 2][/STEP 2]";
    assert.strictEqual(
      renumberSteps(input, 5),
      "[STEP 5][/STEP 5][STEP 10][/STEP 10]"
    );
  });

  it("returns text unchanged when there are no STEP markers", () => {
    const input = "no steps here\njust text";
    assert.strictEqual(renumberSteps(input), input);
  });

  it("handles an empty string", () => {
    assert.strictEqual(renumberSteps(""), "");
  });
});
