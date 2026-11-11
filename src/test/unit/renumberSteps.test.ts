import * as assert from "assert";
import {
  applyStepNumberEdits,
  describeStepRenumber,
  parseNumberedStepTag,
  planStepRenumber,
  renumberSteps,
} from "../../lib/renumberSteps";

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
    // One tag per line: a section tag occupies its own line (parseSectionTag).
    const input = "[STEP 1]\n[/STEP 1]\n[STEP 2]\n[/STEP 2]";
    assert.strictEqual(
      renumberSteps(input, 5),
      "[STEP 5]\n[/STEP 5]\n[STEP 10]\n[/STEP 10]"
    );
  });

  it("returns text unchanged when there are no STEP markers", () => {
    const input = "no steps here\njust text";
    assert.strictEqual(renumberSteps(input), input);
  });

  it("handles an empty string", () => {
    assert.strictEqual(renumberSteps(""), "");
  });

  it("renumbers each closer with ITS opener, not by position", () => {
    // Step 2 was never closed. Counting closers would give [/STEP 3] the
    // number 20; it belongs to the third step.
    const input = [
      "[STEP 1]",
      "[/STEP 1]",
      "[STEP 2]",
      "[STEP 3]",
      "[/STEP 3]",
    ].join("\n");
    assert.strictEqual(
      renumberSteps(input),
      ["[STEP 10]", "[/STEP 10]", "[STEP 20]", "[STEP 30]", "[/STEP 30]"].join("\n")
    );
  });

  it("pairs closers correctly when step numbers are duplicated", () => {
    const input = "[STEP 10]\n[/STEP 10]\n[STEP 10]\n[/STEP 10]";
    assert.strictEqual(
      renumberSteps(input),
      "[STEP 10]\n[/STEP 10]\n[STEP 20]\n[/STEP 20]"
    );
  });

  it("leaves an orphan closer alone", () => {
    const input = "[/STEP 4]\n[STEP 7]\n[/STEP 7]";
    assert.strictEqual(renumberSteps(input), "[/STEP 4]\n[STEP 10]\n[/STEP 10]");
  });

  it("repairs a stale closer number when the step is the innermost open section", () => {
    const input = "[STEP 5]\n[STEP INPUTS]\n[/STEP INPUTS]\n[/STEP 6]";
    assert.strictEqual(
      renumberSteps(input),
      "[STEP 10]\n[STEP INPUTS]\n[/STEP INPUTS]\n[/STEP 10]"
    );
  });

  it("does not guess at a mismatched closer while another section is still open", () => {
    const input = "[STEP 5]\n[STEP INPUTS]\n[/STEP 6]";
    assert.strictEqual(renumberSteps(input), "[STEP 10]\n[STEP INPUTS]\n[/STEP 6]");
  });

  it("numbers a one-liner step and keeps it off the stack", () => {
    const input = "[STEP 3/]\n[STEP 4]\n[/STEP 4]\n[/STEP 3]";
    assert.strictEqual(
      renumberSteps(input),
      "[STEP 10/]\n[STEP 20]\n[/STEP 20]\n[/STEP 3]"
    );
  });

  it("handles the sloppy tag forms TestPit repairs", () => {
    const input = [
      "[[STEP 1]]",
      "[//STEP 1]",
      "[STEP 2] junk",
      "[/STEP 2] junk",
      "[STEP 3",
      "[/STEP 3",
      "\t[STEP\t4]   # comment [STEP 99]",
      "\t[/STEP\t4]",
    ].join("\n");
    const expected = [
      "[[STEP 10]]",
      "[//STEP 10]",
      "[STEP 20] junk",
      "[/STEP 20] junk",
      "[STEP 30",
      "[/STEP 30",
      "\t[STEP\t40]   # comment [STEP 99]",
      "\t[/STEP\t40]",
    ].join("\n");
    assert.strictEqual(renumberSteps(input), expected);
  });

  it("leaves non-numeric steps and STEP INPUTS/OUTPUTS/DEFINITION untouched", () => {
    const input = [
      "[TEST STEPS]",
      "    [STEP GET_DUMP]",
      "    [/STEP GET_DUMP]",
      "    [STEP %N%]",
      "    [/STEP %N%]",
      "    [STEP 1]",
      "        [STEP DEFINITION]",
      "            Step Description = see STEP 1 and [STEP 1]",
      "            Step Dependencies = 1",
      "        [/STEP DEFINITION]",
      "        [STEP INPUTS]",
      "        [/STEP INPUTS]",
      "        [STEP OUTPUTS]",
      "        [/STEP OUTPUTS]",
      "    [/STEP 1]",
      "[/TEST STEPS]",
    ];
    const expected = input.slice();
    expected[5] = "    [STEP 10]";
    expected[14] = "    [/STEP 10]";
    assert.strictEqual(renumberSteps(input.join("\n")), expected.join("\n"));
    assert.strictEqual(planStepRenumber(input.join("\n")).steps, 1);
  });

  it("ignores commented-out and rejected tags", () => {
    const input = "# [STEP 1]\n[ STEP 2 / ]\n[STEP 3][/STEP 3]";
    assert.strictEqual(renumberSteps(input), input);
  });

  it("preserves CRLF, mixed line breaks and trailing whitespace byte-for-byte", () => {
    const input = "  [STEP 1]  \r\n\tx = 1\t\r\n  [/STEP 1]\n[STEP 2]\r\n[/STEP 2]\r\n";
    assert.strictEqual(
      renumberSteps(input),
      "  [STEP 10]  \r\n\tx = 1\t\r\n  [/STEP 10]\n[STEP 20]\r\n[/STEP 20]\r\n"
    );
  });

  it("drops leading zeros and is idempotent", () => {
    const once = renumberSteps("[STEP 001]\n[/STEP 001]\n[STEP 002]\n[/STEP 002]");
    assert.strictEqual(once, "[STEP 10]\n[/STEP 10]\n[STEP 20]\n[/STEP 20]");
    assert.strictEqual(renumberSteps(once), once);
    assert.deepStrictEqual(planStepRenumber(once).edits, []);
  });
});

describe("planStepRenumber", () => {
  it("counts steps and changed steps, and reports digit-only edits", () => {
    const plan = planStepRenumber("[STEP 10]\n[/STEP 10]\n  [STEP 25]\n  [/STEP 25]");
    assert.strictEqual(plan.steps, 2);
    assert.strictEqual(plan.changed, 1);
    assert.deepStrictEqual(plan.edits, [
      { line: 2, startCol: 8, endCol: 10, oldText: "25", newText: "20" },
      { line: 3, startCol: 9, endCol: 11, oldText: "25", newText: "20" },
    ]);
  });

  it("counts a step whose only stale number is its closer", () => {
    const plan = planStepRenumber("[STEP 10]\n[/STEP 11]");
    assert.strictEqual(plan.changed, 1);
    assert.strictEqual(plan.edits.length, 1);
    assert.strictEqual(plan.edits[0].line, 1);
  });

  it("applyStepNumberEdits ignores an edit past the end of the text", () => {
    assert.strictEqual(
      applyStepNumberEdits("a", [
        { line: 9, startCol: 0, endCol: 1, oldText: "a", newText: "b" },
      ]),
      "a"
    );
  });
});

describe("parseNumberedStepTag", () => {
  it("locates the digits of open, close and one-liner tags", () => {
    assert.deepStrictEqual(parseNumberedStepTag("  [STEP 12]"), {
      kind: "open", name: "STEP 12", digits: "12", startCol: 8, endCol: 10,
    });
    assert.strictEqual(parseNumberedStepTag("[/STEP 12]")?.kind, "close");
    assert.strictEqual(parseNumberedStepTag("[STEP 12/]")?.kind, "oneLiner");
  });

  it("returns undefined for anything that is not a numbered step", () => {
    for (const line of ["", "x = 1", "[STEP INPUTS]", "[STEP GET_DUMP]", "[STEP 1A]", "[STEP 1 2]", "[TEST STEPS]", "[STEP %N%]"]) {
      assert.strictEqual(parseNumberedStepTag(line), undefined, line);
    }
  });
});

describe("describeStepRenumber", () => {
  it("says when there is nothing to renumber", () => {
    assert.match(describeStepRenumber(planStepRenumber("x = 1")), /No numbered steps/);
  });

  it("says when the steps are already sequential", () => {
    assert.strictEqual(
      describeStepRenumber(planStepRenumber("[STEP 10]\n[/STEP 10]\n[STEP 20]\n[/STEP 20]")),
      "Steps are already sequential (2 steps: 10, 20, …)."
    );
    assert.strictEqual(
      describeStepRenumber(planStepRenumber("[STEP 10]\n[/STEP 10]")),
      "Steps are already sequential (1 step: 10)."
    );
  });

  it("says how many steps were renumbered", () => {
    assert.strictEqual(
      describeStepRenumber(planStepRenumber("[STEP 10]\n[/STEP 10]\n[STEP 25]\n[/STEP 25]")),
      "Renumbered 1 of 2 steps."
    );
  });
});
