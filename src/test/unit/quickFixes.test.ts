import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";
import {
  ComponentIssue,
  CsvLookup,
  IssueKind,
  validateComponents,
  validateStructure,
} from "../../lib/componentValidator";
import {
  QuickFix,
  applyEdits,
  computeFixAll,
  computeQuickFixes,
  createFixContext,
  findIssues,
} from "../../lib/quickFixes";

const FIXTURE_DIR = path.resolve(
  __dirname, "..", "..", "..", "src", "test", "fixtures", "config"
);
const idx = parseConfigFolder(FIXTURE_DIR);
const CONN = "429_L100SelectedCourseBNR_input1";

function allIssues(text: string): ComponentIssue[] {
  return validateStructure(text).concat(validateComponents(text, idx));
}

function keys(issues: ComponentIssue[]): string[] {
  return issues.map((i) => `${i.kind}|${i.identifier}`).sort();
}

/** `after` holds nothing that `before` minus `gone` did not. */
function assertOnlyRemoved(
  before: ComponentIssue[],
  after: ComponentIssue[],
  gone: ComponentIssue[]
): void {
  const budget = keys(before);
  for (const g of keys(gone)) {
    const at = budget.indexOf(g);
    assert.notStrictEqual(at, -1, `target ${g} was not reported before`);
    budget.splice(at, 1);
  }
  for (const k of keys(after)) {
    const at = budget.indexOf(k);
    assert.notStrictEqual(at, -1, `new or surviving issue after fix: ${k}`);
    budget.splice(at, 1);
  }
}

function fixesFor(text: string, kind: IssueKind, nth = 0): {
  fixes: QuickFix[];
  issue: ComponentIssue;
} {
  const ctx = createFixContext(text, idx);
  const issue = ctx.issues.filter((i) => i.kind === kind)[nth];
  assert.ok(issue, `no ${kind} issue reported`);
  return { fixes: computeQuickFixes(ctx, issue), issue };
}

/**
 * Apply the chosen fix on both the LF and the CRLF form of `lines`; assert the
 * issue is gone, nothing new appeared, and line breaks are intact. Returns the
 * fixed lines (identical for both forms).
 */
function applyFix(
  lines: string[],
  kind: IssueKind,
  pick: (fixes: QuickFix[]) => QuickFix | undefined = (f) => f.find((x) => x.preferred),
  nth = 0
): string[] {
  let result: string[] | undefined;
  for (const eol of ["\n", "\r\n"]) {
    const text = lines.join(eol);
    const { fixes, issue } = fixesFor(text, kind, nth);
    const fix = pick(fixes);
    assert.ok(fix, `no fix offered for ${kind} (${JSON.stringify(eol)})`);
    const out = applyEdits(text, fix.edits);
    assertOnlyRemoved(allIssues(text), allIssues(out), [issue]);
    if (eol === "\r\n") {
      assert.ok(!/(^|[^\r])\n/.test(out), "a bare LF crept into a CRLF document");
    } else {
      assert.ok(!out.includes("\r"), "a CR crept into an LF document");
    }
    const outLines = out.split(/\r?\n/);
    if (result) {
      assert.deepStrictEqual(outLines, result, "LF and CRLF results differ");
    }
    result = outLines;
  }
  return result as string[];
}

function script(body: string[]): string[] {
  return ["[TEST STEPS]", "[STEP]", ...body, "[/STEP]", "[/TEST STEPS]"];
}

describe("quickFixes", () => {
  describe("unknownConnection", () => {
    it("renames the opener and its closing tag together", () => {
      const out = applyFix(
        ["[429_L100SelectedCourseBNR_inptu1]", "    Course = 10", "[/429_L100SelectedCourseBNR_inptu1]"],
        "unknownConnection"
      );
      assert.deepStrictEqual(out, [`[${CONN}]`, "    Course = 10", `[/${CONN}]`]);
    });

    it("offers up to three candidates, best one preferred", () => {
      const { fixes } = fixesFor("[429_L100SelectedCourseBNR_input3]\n[/429_L100SelectedCourseBNR_input3]", "unknownConnection");
      assert.deepStrictEqual(
        fixes.map((f) => f.title),
        [`Change to '${CONN}'`, "Change to '429_L100SelectedCourseBNR_input2'"]
      );
      assert.deepStrictEqual(fixes.map((f) => f.preferred), [true, false]);
      assert.strictEqual(fixes[0].edits.length, 2);
    });

    it("renames only the opener when there is no closer, and for a one-liner", () => {
      assert.deepStrictEqual(
        applyFix(["[429_L100SelectedCourseBNR_inptu1]", "    Course = 10"], "unknownConnection"),
        [`[${CONN}]`, "    Course = 10"]
      );
      const { fixes } = fixesFor(
        "[429_L100SelectedCourseBNR_inptu1/]\n[/429_L100SelectedCourseBNR_inptu1]",
        "unknownConnection"
      );
      assert.strictEqual(fixes[0].edits.length, 1);
      assert.deepStrictEqual(
        applyFix(["    [429_L100SelectedCourseBNR_inptu1/]"], "unknownConnection"),
        [`    [${CONN}/]`]
      );
    });

    it("pairs a nested same-name block with the right closer", () => {
      const bad = "DIS_PowerOnOf";
      const out = applyFix(
        [`[${bad}]`, `[${bad}]`, `[/${bad}]`, `[/${bad}]`],
        "unknownConnection"
      );
      assert.deepStrictEqual(out, ["[DIS_PowerOnOff]", `[${bad}]`, `[/${bad}]`, "[/DIS_PowerOnOff]"]);
    });

    it("keeps the VORILS unit number that was typed", () => {
      const out = applyFix(["[VORILS2_VORILSDataMsgg]", "[/VORILS2_VORILSDataMsgg]"], "unknownConnection");
      assert.deepStrictEqual(out, ["[VORILS2_VORILSDataMsg]", "[/VORILS2_VORILSDataMsg]"]);
    });

    it("offers nothing when no connection is close", () => {
      assert.deepStrictEqual(fixesFor("[429_Bogus]\n[/429_Bogus]", "unknownConnection").fixes, []);
    });
  });

  describe("unknownField", () => {
    it("renames the key only", () => {
      const out = applyFix([`[${CONN}]`, "    Cuorse = 10   # deg", `[/${CONN}]`], "unknownField");
      assert.strictEqual(out[1], "    Course = 10   # deg");
    });

    it("suggests parameter fields too, and allows a macro VALUE (only the key changes)", () => {
      const out = applyFix([`[${CONN}]`, "    tiem = %T%", `[/${CONN}]`], "unknownField");
      assert.strictEqual(out[1], "    time = %T%");
    });

    it("lists close candidates, capped at three", () => {
      const { fixes } = fixesFor(`[${CONN}]\n    Label = 1\n[/${CONN}]`, "unknownField");
      assert.deepStrictEqual(
        fixes.map((f) => f.title),
        ["Change to 'Label1'", "Change to 'Label2'", "Change to 'Label3'"]
      );
      assert.deepStrictEqual(fixes.map((f) => f.preferred), [true, false, false]);
    });

    it("never suggests a key the block already assigns", () => {
      const { fixes } = fixesFor(`[${CONN}]\n    Course = 1\n    Cuorse = 2\n[/${CONN}]`, "unknownField");
      assert.deepStrictEqual(fixes, []);
    });

    it("offers nothing when no field is close", () => {
      assert.deepStrictEqual(fixesFor(`[${CONN}]\n    NotAField = 1\n[/${CONN}]`, "unknownField").fixes, []);
    });
  });

  describe("unknownEnum", () => {
    it("offers every enum, closest first and preferred", () => {
      const { fixes } = fixesFor(`[${CONN}]\n    SDI = INSTALLATION_NUMBER_ONEE\n[/${CONN}]`, "unknownEnum");
      assert.deepStrictEqual(
        fixes.map((f) => f.title),
        [
          "Replace with 'INSTALLATION_NUMBER_ONE' (= 1)",
          "Replace with 'INSTALLATION_NUMBER_ALL_CALL' (= 0)",
        ]
      );
      assert.deepStrictEqual(fixes.map((f) => f.preferred), [true, false]);
      const out = applyFix([`[${CONN}]`, "    SDI = INSTALLATION_NUMBER_ONEE # x", `[/${CONN}]`], "unknownEnum");
      assert.strictEqual(out[1], "    SDI = INSTALLATION_NUMBER_ONE # x");
    });

    it("keeps table order and prefers nothing when no name is close", () => {
      const { fixes } = fixesFor(`[${CONN}]\n    SDI = NOPE\n[/${CONN}]`, "unknownEnum");
      assert.deepStrictEqual(
        fixes.map((f) => f.title),
        [
          "Replace with 'INSTALLATION_NUMBER_ALL_CALL' (= 0)",
          "Replace with 'INSTALLATION_NUMBER_ONE' (= 1)",
        ]
      );
      assert.ok(fixes.every((f) => !f.preferred));
      applyFix([`[${CONN}]`, "    SDI = NOPE", `[/${CONN}]`], "unknownEnum", (f) => f[1]);
    });

    it("fixes an unknown numeric enum value", () => {
      const out = applyFix([`[${CONN}]`, "    SDI = 7", `[/${CONN}]`], "unknownEnum", (f) => f[0]);
      assert.strictEqual(out[1], "    SDI = INSTALLATION_NUMBER_ALL_CALL");
    });

    it("offers NO replace fix for a CSV-sourced value", () => {
      const text = `[${CONN}]\n    SDI = data.csv line:2 col:3\n[/${CONN}]`;
      const csv: CsvLookup = () => "INSTALLATION_NUMBER_ONEE";
      const issue = validateComponents(text, idx, csv).find((i) => i.kind === "unknownEnum");
      assert.ok(issue);
      assert.deepStrictEqual(computeQuickFixes(createFixContext(text, idx), issue), []);
      // …and the provider path (no CsvLookup) does not even match the diagnostic.
      assert.deepStrictEqual(
        findIssues(createFixContext(text, idx), "unknownEnum", issue.line, issue.startCol, issue.endCol),
        []
      );
    });

    it("offers nothing when the value holds a macro", () => {
      const { fixes } = fixesFor(`[${CONN}]\n    SDI = NOPE_%N%\n[/${CONN}]`, "unknownEnum");
      assert.deepStrictEqual(fixes, []);
    });
  });

  describe("valueOutOfRange", () => {
    it("clamps to the violated bound", () => {
      const hi = applyFix([`[${CONN}]`, "    Course = 400.5 # too big", `[/${CONN}]`], "valueOutOfRange");
      assert.strictEqual(hi[1], "    Course = 359.9 # too big");
      const lo = applyFix([`[${CONN}]`, "    Course = -1", `[/${CONN}]`], "valueOutOfRange");
      assert.strictEqual(lo[1], "    Course = 0");
      const { fixes } = fixesFor(`[${CONN}]\n    Course = -1\n[/${CONN}]`, "valueOutOfRange");
      assert.deepStrictEqual(fixes.map((f) => [f.title, f.preferred]), [["Set to minimum (0)", true]]);
    });
  });

  describe("invalidParameterValue", () => {
    const block = (line: string): string[] => script([`[${CONN}]`, line, `[/${CONN}]`]);

    it("offers 'next' and 'any' for match", () => {
      const { fixes } = fixesFor(block("    match = first").join("\n"), "invalidParameterValue");
      assert.deepStrictEqual(fixes.map((f) => f.title), ["Change to 'next'", "Change to 'any'"]);
      assert.ok(fixes.every((f) => !f.preferred));
      for (const n of [0, 1]) {
        const out = applyFix(block("    match = first  # c"), "invalidParameterValue", (f) => f[n]);
        assert.strictEqual(out[3], `    match = ${n === 0 ? "next" : "any"}  # c`);
      }
    });

    it("prefers the value that was clearly meant", () => {
      const { fixes } = fixesFor(block("    match = ANY").join("\n"), "invalidParameterValue");
      assert.deepStrictEqual(fixes.map((f) => [f.title, f.preferred]), [
        ["Change to 'any'", true],
        ["Change to 'next'", false],
      ]);
      assert.strictEqual(applyFix(block("    match = nxet"), "invalidParameterValue")[3], "    match = next");
    });

    it("inserts rather than overwrites when the value is empty", () => {
      assert.strictEqual(
        applyFix(block("    match ="), "invalidParameterValue", (f) => f[0])[3],
        "    match = next"
      );
      assert.strictEqual(
        applyFix(block("    match = # which?"), "invalidParameterValue", (f) => f[1])[3],
        "    match = any # which?"
      );
    });

    it("repairs only the case of occurrence's ALL", () => {
      assert.strictEqual(applyFix(block("    occurrence = all"), "invalidParameterValue")[3], "    occurrence = ALL");
      for (const bad of ["many", ">= 3", "-1", ""]) {
        const { fixes } = fixesFor(block(`    occurrence = ${bad}`).join("\n"), "invalidParameterValue");
        assert.deepStrictEqual(fixes, [], bad);
      }
    });
  });

  describe("duplicateKey / outputFieldInInput", () => {
    it("removes the duplicate line and nothing else", () => {
      const out = applyFix(
        script([`[${CONN}]`, "    Course = 1", "    Course = 2", `[/${CONN}]`]),
        "duplicateKey"
      );
      assert.deepStrictEqual(out, script([`[${CONN}]`, "    Course = 1", `[/${CONN}]`]));
    });

    it("removes a duplicate on the very last line (no line break of its own)", () => {
      const lines = ["[TEST STEPS/]", `[${CONN}]`, "    Course = 1", "    Course = 2"];
      const text = lines.join("\r\n");
      const ctx = createFixContext(text, idx);
      const issue = ctx.issues.find((i) => i.kind === "duplicateKey");
      assert.ok(issue);
      const out = applyEdits(text, computeQuickFixes(ctx, issue)[0].edits);
      assert.strictEqual(out, lines.slice(0, 3).join("\r\n"));
    });

    it("removes an output-only field from an input message", () => {
      const body = ["[STEP INPUTS]", `[${CONN}]`, "    occurrence = 2", "    Course = 1", `[/${CONN}]`, "[/STEP INPUTS]"];
      const out = applyFix(script(body), "outputFieldInInput");
      assert.deepStrictEqual(out, script(body.filter((l) => !l.includes("occurrence"))));
    });

    it("offers nothing for a macro value or a multi-line value", () => {
      for (const dup of [["    Course = %C%"], ["    Course = <pre>", "        2", "    </pre>"], ["    Course = 2", "        continued"]]) {
        const text = script([`[${CONN}]`, "    Course = 1", ...dup, `[/${CONN}]`]).join("\n");
        assert.deepStrictEqual(fixesFor(text, "duplicateKey").fixes, [], dup[0]);
      }
    });
  });

  describe("unbalancedTag", () => {
    it("adds the missing closer under the block, at the opener's indentation", () => {
      const out = applyFix(
        script([
          "    [STEP INPUTS]",
          `        [${CONN}]`,
          "            Course = 1",
          "",
          "        [429_L100SelectedCourseBNR_input2]",
          "            Course = 2",
          "        [/429_L100SelectedCourseBNR_input2]",
          "    [/STEP INPUTS]",
        ]),
        "unbalancedTag"
      );
      assert.strictEqual(out[4], "            Course = 1");
      assert.strictEqual(out[5], `        [/${CONN}]`);
      assert.strictEqual(out[6], "");
    });

    it("keeps tab indentation", () => {
      const out = applyFix(script(["\t[STEP INPUTS]", `\t\t[${CONN}]`, "\t\t\tCourse = 1", "\t[/STEP INPUTS]"]), "unbalancedTag");
      assert.strictEqual(out[5], `\t\t[/${CONN}]`);
    });

    it("closes a message at the next tag in an unindented file", () => {
      const out = applyFix(
        script(["[STEP INPUTS]", `[${CONN}]`, "Course = 1", "[DIS_PowerOnOff/]", "[/STEP INPUTS]"]),
        "unbalancedTag"
      );
      assert.deepStrictEqual(out.slice(3, 7), [`[${CONN}]`, "Course = 1", `[/${CONN}]`, "[DIS_PowerOnOff/]"]);
    });

    it("closes a container before the closer that exposed it in an unindented file", () => {
      const out = applyFix(
        script(["[STEP INPUTS]", `[${CONN}]`, "Course = 1", `[/${CONN}]`]),
        "unbalancedTag"
      );
      assert.deepStrictEqual(out.slice(5, 8), [`[/${CONN}]`, "[/STEP INPUTS]", "[/STEP]"]);
    });

    it("closes a never-closed section at end of file, above trailing blank lines", () => {
      const out = applyFix(["[TEST STEPS]", "    [STEP]", "    [/STEP]", ""], "unbalancedTag");
      assert.deepStrictEqual(out, ["[TEST STEPS]", "    [STEP]", "    [/STEP]", "[/TEST STEPS]", ""]);
      const noEol = applyFix(["[TEST STEPS]", "    [STEP]", "    [/STEP]"], "unbalancedTag");
      assert.deepStrictEqual(noEol, ["[TEST STEPS]", "    [STEP]", "    [/STEP]", "[/TEST STEPS]"]);
    });

    it("fixes several unclosed sections one after another", () => {
      let lines = ["[TEST STEPS]", "    [STEP]", "        [STEP INPUTS]", `            [${CONN}]`, "                Course = 1"];
      for (let n = 0; n < 4; n++) {
        lines = applyFix(lines, "unbalancedTag");
      }
      assert.deepStrictEqual(validateStructure(lines.join("\n")), []);
      assert.deepStrictEqual(lines.slice(5), [`            [/${CONN}]`, "        [/STEP INPUTS]", "    [/STEP]", "[/TEST STEPS]"]);
    });

    it("corrects a mismatched closer's name", () => {
      const lines = script(["    [STEP INPUTS]", "    [/STEP INPUT] # typo"]);
      const text = lines.join("\n");
      const ctx = createFixContext(text, idx);
      const orphan = ctx.issues.find((i) => i.fix?.unbalanced === "orphanClose");
      assert.ok(orphan);
      const fixes = computeQuickFixes(ctx, orphan);
      assert.deepStrictEqual(fixes.map((f) => [f.title, f.preferred]), [["Change to '[/STEP INPUTS]'", true]]);
      for (const eol of ["\n", "\r\n"]) {
        const t = lines.join(eol);
        const c = createFixContext(t, idx);
        const o = c.issues.find((i) => i.fix?.unbalanced === "orphanClose") as ComponentIssue;
        const out = applyEdits(t, computeQuickFixes(c, o)[0].edits);
        assert.deepStrictEqual(out.split(eol), script(["    [STEP INPUTS]", "    [/STEP INPUTS] # typo"]));
        assert.deepStrictEqual(validateStructure(out), []);
      }
    });

    it("renames a misspelt opener rather than a correctly spelt reserved closer", () => {
      const lines = ["[TEST STEPS]", "    [STEP 10]", "        [STEP INPTUS] # typo", "        [/STEP INPUTS]", "    [/STEP 10]", "[/TEST STEPS]"];
      for (const eol of ["\n", "\r\n"]) {
        const text = lines.join(eol);
        const ctx = createFixContext(text, idx);
        const orphan = ctx.issues.find((i) => i.fix?.unbalanced === "orphanClose") as ComponentIssue;
        assert.ok(orphan);
        const fixes = computeQuickFixes(ctx, orphan);
        assert.deepStrictEqual(fixes.map((f) => [f.title, f.preferred]), [["Change opening tag to '[STEP INPUTS]'", true]]);
        const out = applyEdits(text, fixes[0].edits);
        const expected = lines.slice();
        expected[2] = "        [STEP INPUTS] # typo";
        assert.deepStrictEqual(out.split(eol), expected);
        assert.deepStrictEqual(validateStructure(out), []);
      }
    });

    it("closes a section after a <pre> body that is less indented than its opener", () => {
      const lines = [
        "[TEST STEPS]",
        "    [STEP 10]",
        "        [STEP DEFINITION]",
        "            Step Description = <pre>",
        "line one of prose",
        "line two",
        "            </pre>",
        "        [STEP INPUTS]",
        "        [/STEP INPUTS]",
        "    [/STEP 10]",
        "[/TEST STEPS]",
      ];
      const out = applyFix(lines, "unbalancedTag");
      const expected = lines.slice();
      expected.splice(7, 0, "        [/STEP DEFINITION]");
      assert.deepStrictEqual(out, expected);
    });

    it("offers nothing for a stray closer with nothing open", () => {
      const text = ["[TEST STEPS]", "[/TEST STEPS]", "[/STEP]"].join("\n");
      assert.deepStrictEqual(fixesFor(text, "unbalancedTag").fixes, []);
    });

    it("never adds a closer for a one-liner", () => {
      const lines = script(["    [STEP INPUTS]", `        [${CONN}/]`, "        [DIS_PowerOnOff/]"]);
      const out = applyFix(lines, "unbalancedTag");
      assert.strictEqual(out.filter((l) => l.includes("[/")).length, 3);
      assert.strictEqual(out[5], "    [/STEP INPUTS]");
      // A one-liner is never reported, so there is never an issue to fix on it.
      const ctx = createFixContext(lines.join("\n"), idx);
      assert.ok(ctx.issues.every((i) => i.identifier === "STEP INPUTS"));
    });
  });

  describe("fix all", () => {
    it("removes every duplicate, merging adjacent lines", () => {
      const lines = script([`[${CONN}]`, "    Course = 1", "    Course = 2", "    Course = 3", "    SDI = 1", "    SDI = 0", `[/${CONN}]`]);
      for (const eol of ["\n", "\r\n"]) {
        const text = lines.join(eol);
        const all = computeFixAll(createFixContext(text, idx), "duplicateKey");
        assert.ok(all);
        assert.strictEqual(all.title, "Fix all duplicate key problems in this file");
        assert.strictEqual(all.preferred, false);
        const out = applyEdits(text, all.edits);
        assert.deepStrictEqual(out.split(eol), script([`[${CONN}]`, "    Course = 1", "    SDI = 1", `[/${CONN}]`]));
        assert.deepStrictEqual(allIssues(out), []);
      }
    });

    it("clamps every out-of-range value", () => {
      const text = [`[${CONN}]`, "    Course = 400", `[/${CONN}]`, "[429_L100SelectedCourseBNR_input2]", "    Course = -5", "[/429_L100SelectedCourseBNR_input2]"].join("\r\n");
      const all = computeFixAll(createFixContext(text, idx), "valueOutOfRange");
      assert.ok(all);
      const out = applyEdits(text, all.edits);
      assert.deepStrictEqual(allIssues(out), []);
      assert.ok(out.includes("Course = 359.9\r\n") && out.includes("Course = 0\r\n"));
    });

    it("skips unfixable ones and needs at least two fixable issues", () => {
      const one = script([`[${CONN}]`, "    Course = 1", "    Course = 2", "    Course = %C%", `[/${CONN}]`]).join("\n");
      assert.strictEqual(computeFixAll(createFixContext(one, idx), "duplicateKey"), undefined);
    });

    it("is not offered for kinds with more than one possible fix", () => {
      const text = script([`[${CONN}]`, "    match = a", "    SDI = X", "    SDI = Y", `[/${CONN}]`, "[STEP INPUTS]", "[STEP OUTPUTS]"]).join("\n");
      const ctx = createFixContext(text, idx);
      for (const kind of ["unknownEnum", "unbalancedTag", "invalidParameterValue", "unknownConnection", "unknownField", "nonsense"]) {
        assert.strictEqual(computeFixAll(ctx, kind), undefined, kind);
      }
    });
  });

  it("works without an index for structural issues, and ignores unknown kinds", () => {
    const text = script([`[${CONN}]`, "    Course = 1", "    Course = 2", `[/${CONN}]`]).join("\n");
    const ctx = createFixContext(text);
    const issue = ctx.issues[0];
    assert.strictEqual(computeQuickFixes(ctx, issue).length, 1);
    assert.deepStrictEqual(computeQuickFixes(ctx, { ...issue, kind: "invalidNesting" }), []);
    assert.deepStrictEqual(computeQuickFixes(ctx, { ...issue, line: 999 }), []);
  });
});
