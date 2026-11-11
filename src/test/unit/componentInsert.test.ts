import * as assert from "assert";
import {
  InsertPlan,
  planConnectionInsert,
  planFieldInsert,
} from "../../lib/componentInsert";
import { parseSectionTagLine } from "../../lib/parseSectionTag";

/**
 * Apply a plan the way the editor would, with the snippet's tab stops
 * removed. The `|` in the result marks the final cursor (`$0`), when the
 * snippet has one.
 */
function apply(text: string, plan: InsertPlan, eol = "\n"): string[] {
  const lines = text.split(/\r?\n/);
  const line = lines[plan.line];
  const written = plan.snippet
    .replace(/\$0/g, "|")
    .replace(/\\([\\$}])/g, "$1");
  lines[plan.line] = line.slice(0, plan.startCol) + written + line.slice(plan.endCol);
  return lines.join(eol).split(/\r?\n|\n/);
}

const STEP = [
  "[TEST STEPS]", // 0
  "    [STEP 10]", // 1
  "        [STEP INPUTS]", // 2
  "", // 3
  "            [429_A]", // 4
  "                Label1 = 1", // 5
  "            [/429_A]", // 6
  "            ", // 7
  "        [/STEP INPUTS]", // 8
  "    [/STEP 10]", // 9
  "[/TEST STEPS]", // 10
];

describe("componentInsert — connection block", () => {
  it("fills an empty line, indented one level inside the enclosing section", () => {
    const text = STEP.join("\n");
    const plan = planConnectionInsert(text, 3, "429_B");
    assert.ok(plan);
    assert.deepStrictEqual(
      { line: plan.line, startCol: plan.startCol, endCol: plan.endCol },
      { line: 3, startCol: 0, endCol: 0 }
    );
    assert.deepStrictEqual(apply(text, plan).slice(3, 6), [
      "            [429_B]",
      "                |",
      "            [/429_B]",
    ]);
  });

  it("keeps the whitespace of a blank line as the indentation", () => {
    const lines = STEP.slice();
    lines[7] = "      ";
    const text = lines.join("\n");
    const plan = planConnectionInsert(text, 7, "429_B");
    assert.ok(plan);
    assert.strictEqual(plan.endCol, 6);
    assert.deepStrictEqual(apply(text, plan).slice(7, 10), [
      "      [429_B]",
      "          |",
      "      [/429_B]",
    ]);
  });

  it("adds the block below a line with text, never changing that line", () => {
    const text = STEP.join("\n");
    const plan = planConnectionInsert(text, 6, "429_B");
    assert.ok(plan);
    assert.strictEqual(plan.line, 6);
    assert.strictEqual(plan.startCol, STEP[6].length);
    assert.strictEqual(plan.endCol, STEP[6].length);
    assert.deepStrictEqual(apply(text, plan).slice(6, 10), [
      "            [/429_A]",
      "            [429_B]",
      "                |",
      "            [/429_B]",
    ]);
  });

  it("goes one level deeper below an opening section tag", () => {
    const text = STEP.join("\n");
    const plan = planConnectionInsert(text, 2, "429_B");
    assert.ok(plan);
    assert.deepStrictEqual(apply(text, plan).slice(2, 6), [
      "        [STEP INPUTS]",
      "            [429_B]",
      "                |",
      "            [/429_B]",
    ]);
  });

  it("does not indent deeper below a one-liner section", () => {
    const text = ["[STEP OUTPUTS]", "    [STEP DUMP/]", "[/STEP OUTPUTS]"].join("\n");
    const plan = planConnectionInsert(text, 1, "429_B");
    assert.ok(plan);
    assert.deepStrictEqual(apply(text, plan).slice(1, 5), [
      "    [STEP DUMP/]",
      "    [429_B]",
      "        |",
      "    [/429_B]",
    ]);
  });

  it("writes at column 0 on an empty line outside every section", () => {
    const plan = planConnectionInsert("", 0, "DIS_PowerOnOff");
    assert.ok(plan);
    assert.deepStrictEqual(apply("", plan), [
      "[DIS_PowerOnOff]",
      "    |",
      "[/DIS_PowerOnOff]",
    ]);
  });

  it("produces a block the section-tag parser reads as open + close", () => {
    const plan = planConnectionInsert("", 0, "PART_HSI_Alive");
    assert.ok(plan);
    const out = apply("", plan);
    assert.deepStrictEqual(
      [out[0], out[2]].map((l) => {
        const tag = parseSectionTagLine(l);
        return [tag?.kind, tag?.name, tag?.invalid ?? false];
      }),
      [
        ["open", "PART_HSI_Alive", false],
        ["close", "PART_HSI_Alive", false],
      ]
    );
  });

  it("adds no second closing tag when one is already waiting below (as completion does)", () => {
    const text = ["[STEP INPUTS]", "", "        time = 0", "    [/429_B]", "[/STEP INPUTS]"].join("\n");
    const plan = planConnectionInsert(text, 1, "429_B");
    assert.ok(plan);
    assert.deepStrictEqual(apply(text, plan), [
      "[STEP INPUTS]",
      "    [429_B]",
      "        time = 0",
      "    [/429_B]",
      "[/STEP INPUTS]",
    ]);
  });

  it("works on CRLF text and never leaves a \\r in the snippet", () => {
    const text = STEP.join("\r\n");
    const plan = planConnectionInsert(text, 3, "429_B");
    assert.ok(plan);
    assert.ok(!plan.snippet.includes("\r"));
    assert.strictEqual(plan.snippet, "            [429_B]\n                $0\n            [/429_B]");
    const below = planConnectionInsert(text, 6, "429_B");
    assert.strictEqual(below?.startCol, STEP[6].length);
  });

  it("escapes snippet characters in a name", () => {
    const plan = planConnectionInsert("", 0, "429_A$B");
    assert.ok(plan);
    assert.ok(plan.snippet.startsWith("[429_A\\$B]"));
    assert.strictEqual(apply("", plan)[0], "[429_A$B]");
  });

  it("returns undefined for a line outside the document", () => {
    assert.strictEqual(planConnectionInsert("a\nb", 2, "429_B"), undefined);
    assert.strictEqual(planConnectionInsert("a\nb", -1, "429_B"), undefined);
  });
});

describe("componentInsert — field line", () => {
  it("writes 'name = ' on an empty line inside a block, cursor after the =", () => {
    const lines = STEP.slice();
    lines.splice(6, 0, "");
    const text = lines.join("\n");
    const plan = planFieldInsert(text, 6, "SDI");
    assert.ok(plan);
    assert.strictEqual(plan.snippet, "                SDI = $0");
    assert.strictEqual(apply(text, plan)[6], "                SDI = |");
  });

  it("keeps a blank line's own whitespace", () => {
    const plan = planFieldInsert("[429_A]\n  \n[/429_A]", 1, "SDI");
    assert.ok(plan);
    assert.deepStrictEqual(
      { startCol: plan.startCol, endCol: plan.endCol, snippet: plan.snippet },
      { startCol: 0, endCol: 2, snippet: "  SDI = $0" }
    );
  });

  it("adds a line below a field line, at the same indentation", () => {
    const text = STEP.join("\n");
    const plan = planFieldInsert(text, 5, "Label2");
    assert.ok(plan);
    assert.deepStrictEqual(apply(text, plan).slice(5, 8), [
      "                Label1 = 1",
      "                Label2 = |",
      "            [/429_A]",
    ]);
  });

  it("goes one level deeper below the block's opening tag", () => {
    const text = STEP.join("\n");
    const plan = planFieldInsert(text, 4, "Label2");
    assert.ok(plan);
    assert.deepStrictEqual(apply(text, plan).slice(4, 6), [
      "            [429_A]",
      "                Label2 = |",
    ]);
  });

  it("keeps a dotted field name verbatim and escapes snippet characters", () => {
    assert.strictEqual(
      planFieldInsert("", 0, "DataValidity.RangeValid")?.snippet,
      "DataValidity.RangeValid = $0"
    );
    assert.strictEqual(planFieldInsert("", 0, "a$b}")?.snippet, "a\\$b\\} = $0");
  });

  it("returns undefined for a line outside the document", () => {
    assert.strictEqual(planFieldInsert("", 1, "SDI"), undefined);
  });
});
