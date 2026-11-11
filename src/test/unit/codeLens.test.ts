import * as assert from "assert";
import {
  computeCodeLenses,
  countProblems,
  EsiLens,
  formatProblemCounts,
  formatStepSummary,
  LENS_TITLE_OPEN,
  LENS_TITLE_VALIDATE,
  LensProblem,
} from "../../lib/codeLens";

const doc = (...lines: string[]): string => lines.join("\n");

const SCRIPT_LINES = [
  "# header comment", // 0
  "[TEST DEFINITION]", // 1
  "    Test Description = demo", // 2
  "[/TEST DEFINITION]", // 3
  "[TEST STEPS]", // 4
  "    [STEP 10]", // 5
  "        [STEP DEFINITION]", // 6
  "            Step Description = first", // 7
  "        [/STEP DEFINITION]", // 8
  "        [STEP INPUTS]", // 9
  "            [429_A]", // 10
  "                x = 1", // 11
  "            [/429_A]", // 12
  "            [DIS_B/]", // 13
  "        [/STEP INPUTS]", // 14
  "        [STEP OUTPUTS]", // 15
  "            [429_C]", // 16
  "                [NESTED]", // 17
  "                [/NESTED]", // 18
  "            [/429_C]", // 19
  "        [/STEP OUTPUTS]", // 20
  "    [/STEP 10]", // 21
  "    [STEP 20]", // 22
  "        [STEP DUMP/]", // 23
  "    [/STEP 20]", // 24
  "[/TEST STEPS]", // 25
];
const SCRIPT = SCRIPT_LINES.join("\n");

const titles = (lenses: EsiLens[]): string[] => lenses.map((l) => l.title);
const stepLenses = (lenses: EsiLens[]): EsiLens[] =>
  lenses.filter(
    (l) => l.action.type === "toggleFold" || l.action.type === "showProblems"
  );

describe("codeLens — formatting", () => {
  it("pluralizes the step summary", () => {
    assert.strictEqual(formatStepSummary(0, 0), "0 inputs · 0 outputs");
    assert.strictEqual(formatStepSummary(1, 1), "1 input · 1 output");
    assert.strictEqual(formatStepSummary(2, 3), "2 inputs · 3 outputs");
  });

  it("lists only the non-zero problem counts", () => {
    assert.strictEqual(formatProblemCounts({ errors: 0, warnings: 0 }), "");
    assert.strictEqual(formatProblemCounts({ errors: 1, warnings: 0 }), "1 error");
    assert.strictEqual(
      formatProblemCounts({ errors: 0, warnings: 2 }),
      "2 warnings"
    );
    assert.strictEqual(
      formatProblemCounts({ errors: 2, warnings: 1 }),
      "2 errors, 1 warning"
    );
  });
});

describe("codeLens — countProblems", () => {
  const problems: LensProblem[] = [
    { line: 4, severity: "error" },
    { line: 5, severity: "error" },
    { line: 7, severity: "warning" },
    { line: 7, severity: "info" },
    { line: 9, severity: "hint" },
    { line: 10, severity: "warning" },
    { line: 11, severity: "error" },
  ];

  it("counts errors and warnings on the inclusive line range", () => {
    assert.deepStrictEqual(countProblems(problems, 5, 10), {
      errors: 1,
      warnings: 2,
    });
  });

  it("ignores info and hint problems", () => {
    assert.deepStrictEqual(countProblems(problems, 8, 9), {
      errors: 0,
      warnings: 0,
    });
  });
});

describe("codeLens — computeCodeLenses", () => {
  it("puts Validate / Open with TestPit at the top of a root script", () => {
    const lenses = computeCodeLenses(SCRIPT);
    assert.deepStrictEqual(titles(lenses).slice(0, 2), [
      LENS_TITLE_VALIDATE,
      LENS_TITLE_OPEN,
    ]);
    assert.deepStrictEqual(lenses[0].action, { type: "validate" });
    assert.deepStrictEqual(lenses[1].action, { type: "openWithTestPit" });
    for (const l of lenses.slice(0, 2)) {
      assert.strictEqual(l.line, 0);
      assert.strictEqual(l.startCol, 0);
      assert.strictEqual(l.endCol, 0);
    }
  });

  it("treats [TEST DEFINITION] alone, or a one-liner [TEST STEPS/], as root", () => {
    const a = computeCodeLenses(doc("[TEST DEFINITION]", "[/TEST DEFINITION]"));
    assert.deepStrictEqual(titles(a), [LENS_TITLE_VALIDATE, LENS_TITLE_OPEN]);
    const b = computeCodeLenses(doc("[TEST STEPS/]"));
    assert.deepStrictEqual(titles(b), [LENS_TITLE_VALIDATE, LENS_TITLE_OPEN]);
  });

  it("has no script-level lenses on an include file, but still summarizes steps", () => {
    const lenses = computeCodeLenses(
      doc(
        "[VARIABLES]",
        "    %A% = 1",
        "[/VARIABLES]",
        "[STEP 5]",
        "    [STEP INPUTS]",
        "        [DIS_X/]",
        "    [/STEP INPUTS]",
        "[/STEP 5]"
      )
    );
    assert.deepStrictEqual(titles(lenses), ["1 input · 0 outputs"]);
    assert.strictEqual(lenses[0].line, 3);
  });

  it("does not take a commented-out [TEST STEPS] for a root script", () => {
    assert.deepStrictEqual(
      computeCodeLenses(doc("# [TEST STEPS]", "x = 1")),
      []
    );
  });

  it("counts the blocks directly inside STEP INPUTS / STEP OUTPUTS", () => {
    const steps = stepLenses(computeCodeLenses(SCRIPT));
    assert.deepStrictEqual(titles(steps), [
      "2 inputs · 1 output", // one-liner [DIS_B/] counts; [NESTED] does not
      "0 inputs · 0 outputs", // [STEP DUMP/] is neither
    ]);
    assert.deepStrictEqual(
      steps.map((l) => l.line),
      [5, 22]
    );
  });

  it("anchors the step lens on the opening tag and folds on click", () => {
    const [first] = stepLenses(computeCodeLenses(SCRIPT));
    assert.strictEqual(first.startCol, 4);
    assert.strictEqual(first.endCol, 4 + "[STEP 10]".length);
    assert.deepStrictEqual(first.action, { type: "toggleFold", line: 5 });
    assert.ok(first.tooltip.includes("[STEP 10]"));
  });

  it("adds a problem lens only to steps that contain errors or warnings", () => {
    const problems: LensProblem[] = [
      { line: 2, severity: "error" }, // outside any step
      { line: 5, severity: "warning" }, // the step's own opening tag
      { line: 11, severity: "error" },
      { line: 21, severity: "error" }, // the step's closing tag
      { line: 23, severity: "info" }, // step 20: info only → no lens
    ];
    const steps = stepLenses(computeCodeLenses(SCRIPT, problems));
    assert.deepStrictEqual(titles(steps), [
      "2 inputs · 1 output",
      "$(error) 2 errors, 1 warning",
      "0 inputs · 0 outputs",
    ]);
    assert.deepStrictEqual(steps[1].action, {
      type: "showProblems",
      startLine: 5,
      endLine: 21,
    });
    assert.strictEqual(steps[1].line, 5);
  });

  it("uses the warning icon when a step has warnings only", () => {
    const steps = stepLenses(
      computeCodeLenses(SCRIPT, [{ line: 23, severity: "warning" }])
    );
    assert.strictEqual(steps[steps.length - 1].title, "$(warning) 1 warning");
  });

  it("handles one-liner steps, reserved STEP sections and CRLF", () => {
    const text = [
      "[TEST STEPS]",
      "    [STEP 1/]",
      "    [STEP GET_DUMP]",
      "        [STEP OUTPUTS]",
      "            [Mem_A/]",
      "            [Mem_B/]",
      "        [/STEP OUTPUTS]",
      "    [/STEP GET_DUMP]",
      "[/TEST STEPS]",
    ].join("\r\n");
    const steps = stepLenses(computeCodeLenses(text));
    assert.deepStrictEqual(
      steps.map((l) => `${l.line}:${l.title}`),
      ["1:0 inputs · 0 outputs", "2:0 inputs · 2 outputs"]
    );
    // A one-liner's problem range is its own line only.
    const withProblem = stepLenses(
      computeCodeLenses(text, [{ line: 1, severity: "error" }])
    );
    assert.deepStrictEqual(withProblem[1].action, {
      type: "showProblems",
      startLine: 1,
      endLine: 1,
    });
  });

  it("is total on unclosed steps and empty input", () => {
    assert.deepStrictEqual(computeCodeLenses(""), []);
    const text = doc(
      "[TEST STEPS]",
      "    [STEP 10]",
      "        [STEP INPUTS]",
      "            [429_A]",
      "                x = 1",
      ""
    );
    const steps = stepLenses(
      computeCodeLenses(text, [{ line: 4, severity: "warning" }])
    );
    assert.deepStrictEqual(titles(steps), [
      "1 input · 0 outputs",
      "$(warning) 1 warning",
    ]);
  });
});
