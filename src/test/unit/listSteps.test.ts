import * as assert from "assert";
import {
  findStepAtLine,
  findStepByQuery,
  listSteps,
} from "../../lib/listSteps";

describe("listSteps", () => {
  const sample = [
    "[TEST DEFINITION]", // 0
    "    Test Description = whole test",
    "[/TEST DEFINITION]",
    "[TEST STEPS]", // 3
    "    [STEP 10]", // 4
    "        [STEP DEFINITION]",
    "            Step Description  = Power up the unit # trailing comment",
    "            Step Requirements = SRS-101, SRS-102",
    "            Step Dependencies = N/A",
    "        [/STEP DEFINITION]",
    "        [STEP INPUTS]", // 10
    "            [DIS_POWER]",
    "                time = 0",
    "            [/DIS_POWER]",
    "        [/STEP INPUTS]",
    "        [STEP OUTPUTS]",
    "        [/STEP OUTPUTS]",
    "    [/STEP 10]", // 17
    "    [STEP 20]", // 18
    "        [STEP INPUTS]",
    "        [/STEP INPUTS]",
    "    [/STEP 20]", // 21
    "    [STEP GET_DUMP]", // 22
    "        [STEP INPUTS]",
    "        [/STEP INPUTS]",
    "    [/STEP GET_DUMP]", // 25
    "[/TEST STEPS]",
  ];

  it("lists every step in order with its opening and closing line", () => {
    const steps = listSteps(sample.join("\n"));
    assert.deepStrictEqual(
      steps.map((s) => [s.number, s.label, s.line, s.endLine]),
      [
        ["10", "STEP 10", 4, 17],
        ["20", "STEP 20", 18, 21],
        ["GET_DUMP", "STEP GET_DUMP", 22, 25],
      ]
    );
  });

  it("takes description and requirements from the step definition", () => {
    const [s10, s20] = listSteps(sample.join("\n"));
    assert.strictEqual(s10.description, "Power up the unit");
    assert.strictEqual(s10.requirements, "SRS-101, SRS-102");
    assert.strictEqual(s20.description, "");
    assert.strictEqual(s20.requirements, "");
  });

  it("gives the same result for CRLF text", () => {
    assert.deepStrictEqual(
      listSteps(sample.join("\r\n")),
      listSteps(sample.join("\n"))
    );
  });

  it("does not treat STEP DEFINITION / INPUTS / OUTPUTS / TEST STEPS as steps", () => {
    const steps = listSteps(
      [
        "[TEST STEPS]",
        "[STEP DEFINITION]",
        "    Step Description = orphan",
        "[/STEP DEFINITION]",
        "[STEP INPUTS]",
        "[/STEP INPUTS]",
        "[STEP OUTPUTS/]",
        "[/TEST STEPS]",
      ].join("\n")
    );
    assert.deepStrictEqual(steps, []);
  });

  it("ignores the test definition and text outside any step", () => {
    const steps = listSteps(
      [
        "Step Description = not in a step",
        "[STEP 5]",
        "    Step Description = not in a definition block",
        "[/STEP 5]",
      ].join("\n")
    );
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].description, "");
  });

  it("flattens a <pre> description and drops the markup", () => {
    const steps = listSteps(
      [
        "[STEP 10]",
        "    [STEP DEFINITION]",
        "        Step Description = <pre>",
        "                               <br/> First line",
        "                               <br/> second line",
        "                           </pre>",
        "        Step Requirements = <pre> REQ-1 </pre>",
        "    [/STEP DEFINITION]",
        "[/STEP 10]",
      ].join("\n")
    );
    assert.strictEqual(steps[0].description, "First line second line");
    assert.strictEqual(steps[0].requirements, "REQ-1");
  });

  it("survives a <pre> that is never closed", () => {
    const steps = listSteps(
      [
        "[STEP 10]",
        "    [STEP DEFINITION]",
        "        Step Description = <pre>",
        "            dangling",
        "    [/STEP DEFINITION]",
        "[/STEP 10]",
        "[STEP 20]",
        "[/STEP 20]",
      ].join("\n")
    );
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].description, "dangling");
    assert.strictEqual(steps[1].description, "");
  });

  it("truncates a very long description", () => {
    const steps = listSteps(
      [
        "[STEP 10]",
        "[STEP DEFINITION]",
        "Step Description = " + "x".repeat(500),
        "[/STEP DEFINITION]",
        "[/STEP 10]",
      ].join("\n")
    );
    assert.strictEqual(steps[0].description.length, 120);
    assert.ok(steps[0].description.endsWith("…"));
  });

  it("finds a one-liner step and gives it no body", () => {
    const steps = listSteps(
      [
        "[STEP 10/]",
        "[STEP DEFINITION]",
        "    Step Description = belongs to nobody",
        "[/STEP DEFINITION]",
        "[STEP 20]",
        "[/STEP 20]",
      ].join("\n")
    );
    assert.deepStrictEqual(
      steps.map((s) => [s.number, s.line, s.endLine, s.description]),
      [
        ["10", 0, 0, ""],
        ["20", 4, 5, ""],
      ]
    );
  });

  it("finds the sloppy tag forms TestPit repairs", () => {
    const steps = listSteps(
      [
        "[[STEP 10]]",
        "[//STEP 10]",
        "[STEP 20] junk",
        "[/STEP 20]",
        "[STEP 30",
        "[/STEP 30]",
        "\t[STEP 40]  # comment",
        "[/STEP 40]",
      ].join("\n")
    );
    assert.deepStrictEqual(
      steps.map((s) => [s.number, s.line, s.endLine]),
      [
        ["10", 0, 1],
        ["20", 2, 3],
        ["30", 4, 5],
        ["40", 6, 7],
      ]
    );
  });

  it("skips commented-out and invalid step tags", () => {
    const steps = listSteps(
      ["# [STEP 10]", "[STEP 1/0]", "[STEP 20]", "[/STEP 20]"].join("\n")
    );
    assert.deepStrictEqual(
      steps.map((s) => s.number),
      ["20"]
    );
  });

  it("starts a new step when the previous one was never closed", () => {
    const steps = listSteps(
      ["[STEP 10]", "body", "[STEP 20]", "body", "[/STEP 20]"].join("\n")
    );
    assert.deepStrictEqual(
      steps.map((s) => [s.number, s.line, s.endLine]),
      [
        ["10", 0, 1],
        ["20", 2, 4],
      ]
    );
  });

  it("returns nothing for an empty document", () => {
    assert.deepStrictEqual(listSteps(""), []);
  });
});

describe("findStepByQuery", () => {
  const steps = listSteps(
    [
      "[STEP 10]",
      "[/STEP 10]",
      "[STEP 100]",
      "[/STEP 100]",
      "[STEP GET_DUMP]",
      "[/STEP GET_DUMP]",
      "[STEP 10]",
      "[/STEP 10]",
    ].join("\n")
  );

  it("matches the exact step number, first occurrence wins", () => {
    assert.strictEqual(findStepByQuery(steps, "10")?.line, 0);
    assert.strictEqual(findStepByQuery(steps, " 100 ")?.line, 2);
  });

  it("accepts the full label and ignores case", () => {
    assert.strictEqual(findStepByQuery(steps, "step  100")?.line, 2);
    assert.strictEqual(findStepByQuery(steps, "get_dump")?.line, 4);
  });

  it("does not match a prefix, an empty query or regex input", () => {
    assert.strictEqual(findStepByQuery(steps, "1"), undefined);
    assert.strictEqual(findStepByQuery(steps, "  "), undefined);
    assert.strictEqual(findStepByQuery(steps, ".*"), undefined);
  });
});

describe("findStepAtLine", () => {
  const steps = listSteps(
    ["pre", "[STEP 10]", "body", "[/STEP 10]", "gap", "[STEP 20]", "[/STEP 20]"].join(
      "\n"
    )
  );

  it("returns the step whose block contains the line", () => {
    assert.strictEqual(findStepAtLine(steps, 1)?.number, "10");
    assert.strictEqual(findStepAtLine(steps, 2)?.number, "10");
    assert.strictEqual(findStepAtLine(steps, 3)?.number, "10");
    assert.strictEqual(findStepAtLine(steps, 6)?.number, "20");
  });

  it("returns undefined between and before steps", () => {
    assert.strictEqual(findStepAtLine(steps, 0), undefined);
    assert.strictEqual(findStepAtLine(steps, 4), undefined);
  });
});
