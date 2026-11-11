import * as assert from "assert";
import * as path from "path";
import {
  FileOutcome,
  checkedFile,
  collectEsiIssues,
  countSeverities,
  formatReport,
  formatSummary,
  issueSeverity,
  progressLabel,
  stripBom,
  summarizeWorkspace,
  unreadableFile,
} from "../../lib/workspaceValidation";
import { validateComponents, validateStructure } from "../../lib/componentValidator";
import { checkSteps } from "../../lib/stepChecks";
import { validateMacros } from "../../lib/macros";
import { parseConfigFolder } from "../../lib/xmlIndex";

const FIXTURES = path.resolve(__dirname, "../../../src/test/fixtures/config");

const CLEAN = [
  "[TEST STEPS]",
  "    [STEP 1]",
  "    [/STEP 1]",
  "[/TEST STEPS]",
].join("\r\n");

const BROKEN = [
  "[TEST STEPS]",
  "    [STEP 1]",
  "    [/STEP 1]",
  "    [STEP 1]",
  "        [429_NO_SUCH_CONNECTION_XYZ]",
  "        [/429_NO_SUCH_CONNECTION_XYZ]",
  "    [/STEP 1]",
  "[/TEST STEPS]",
  "[/ORPHAN]",
].join("\r\n");

describe("workspaceValidation", () => {
  describe("collectEsiIssues", () => {
    it("reports nothing for a clean script", () => {
      assert.deepStrictEqual(collectEsiIssues(CLEAN), []);
    });

    it("without an index runs exactly the config-free checks", () => {
      const expected = [
        ...validateStructure(BROKEN),
        ...checkSteps(BROKEN),
        ...validateMacros(BROKEN, {}),
      ];
      assert.ok(expected.length > 0, "fixture should have structural/step issues");
      assert.deepStrictEqual(collectEsiIssues(BROKEN), expected);
    });

    it("with an index adds the component checks after the others", () => {
      const index = parseConfigFolder(FIXTURES);
      const component = validateComponents(BROKEN, index);
      assert.ok(
        component.some((i) => i.kind === "unknownConnection"),
        "fixture should have an unknown connection"
      );
      const all = collectEsiIssues(BROKEN, { index });
      assert.deepStrictEqual(all, [...collectEsiIssues(BROKEN), ...component]);
    });

    it("passes the CSV lookup and macro resolver through", () => {
      const index = parseConfigFolder(FIXTURES);
      let includeAsked = false;
      const text = [
        "[INCLUDE]",
        "    include file = other.esi",
        "[/INCLUDE]",
        "[TEST STEPS]",
        "[/TEST STEPS]",
      ].join("\n");
      collectEsiIssues(text, {
        index,
        macroResolver: {
          readInclude: () => {
            includeAsked = true;
            return undefined;
          },
        },
      });
      assert.strictEqual(includeAsked, true);
    });
  });

  describe("severity counting", () => {
    it("treats a missing severity as a warning", () => {
      assert.strictEqual(issueSeverity({}), "warning");
      assert.strictEqual(issueSeverity({ severity: "error" }), "error");
    });

    it("counts errors, warnings and notes (information + hint)", () => {
      assert.deepStrictEqual(
        countSeverities([
          { severity: "error" },
          { severity: "error" },
          {},
          { severity: "warning" },
          { severity: "information" },
          { severity: "hint" },
        ]),
        { errors: 2, warnings: 2, notes: 2 }
      );
      assert.deepStrictEqual(countSeverities([]), { errors: 0, warnings: 0, notes: 0 });
    });
  });

  it("stripBom removes only a leading BOM", () => {
    assert.strictEqual(stripBom("﻿[A]"), "[A]");
    assert.strictEqual(stripBom("[A]﻿"), "[A]﻿");
    assert.strictEqual(stripBom(""), "");
  });

  it("progressLabel", () => {
    assert.strictEqual(progressLabel(3, 12, "a.esi"), "3/12 a.esi");
  });

  describe("summarizeWorkspace", () => {
    const outcomes: FileOutcome[] = [
      checkedFile("/w/a.esi", []),
      checkedFile("/w/b.esi", [{ severity: "error" }, {}]),
      checkedFile("/w/c.esi", [{ severity: "hint" }]),
      unreadableFile("/w/d.esi", "EACCES"),
    ];

    it("totals files and severities", () => {
      const s = summarizeWorkspace(outcomes, { totalFiles: 4, cancelled: false, hasIndex: true });
      assert.strictEqual(s.filesChecked, 3);
      assert.strictEqual(s.filesUnreadable, 1);
      assert.strictEqual(s.filesSkipped, 0);
      // A file with only notes is not a "file with problems".
      assert.strictEqual(s.filesWithProblems, 1);
      assert.deepStrictEqual(
        { errors: s.errors, warnings: s.warnings, notes: s.notes },
        { errors: 1, warnings: 1, notes: 1 }
      );
    });

    it("counts files not reached when cancelled", () => {
      const s = summarizeWorkspace(outcomes.slice(0, 2), {
        totalFiles: 10,
        cancelled: true,
        hasIndex: true,
      });
      assert.strictEqual(s.filesSkipped, 8);
      assert.strictEqual(s.cancelled, true);
    });
  });

  describe("formatSummary", () => {
    const sum = (
      outcomes: FileOutcome[],
      run: Partial<{ totalFiles: number; cancelled: boolean; hasIndex: boolean }> = {}
    ) =>
      formatSummary(
        summarizeWorkspace(outcomes, {
          totalFiles: outcomes.length,
          cancelled: false,
          hasIndex: true,
          ...run,
        })
      );

    it("no files", () => {
      assert.deepStrictEqual(sum([]), {
        level: "info",
        message: "No .esi files found in the workspace.",
      });
    });

    it("clean run is info, and never claims TestPit ran", () => {
      const r = sum([checkedFile("/w/a.esi", []), checkedFile("/w/b.esi", [])]);
      assert.strictEqual(r.level, "info");
      assert.strictEqual(
        r.message,
        "Checked 2 .esi files: 0 errors, 0 warnings. In-process checks only; TestPit.exe was not run."
      );
    });

    it("errors make it an error; singular/plural wording", () => {
      const r = sum([checkedFile("/w/a.esi", [{ severity: "error" }, {}, {}])]);
      assert.strictEqual(r.level, "error");
      assert.ok(r.message.startsWith("Checked 1 .esi file: 1 error, 2 warnings in 1 file."));
    });

    it("warnings only is a warning", () => {
      assert.strictEqual(sum([checkedFile("/w/a.esi", [{}])]).level, "warning");
    });

    it("notes alone stay info", () => {
      assert.strictEqual(sum([checkedFile("/w/a.esi", [{ severity: "hint" }])]).level, "info");
    });

    it("an unreadable file is never reported as a clean run", () => {
      const r = sum([checkedFile("/w/a.esi", []), unreadableFile("/w/b.esi", "ENOENT")]);
      assert.strictEqual(r.level, "warning");
      assert.ok(r.message.includes("Checked 1 .esi file:"));
      assert.ok(r.message.includes("1 file could not be read (see Output)."));
    });

    it("a missing index is called out and is at least a warning", () => {
      const r = sum([checkedFile("/w/a.esi", [])], { hasIndex: false });
      assert.strictEqual(r.level, "warning");
      assert.ok(r.message.includes("component checks were skipped"));
    });

    it("cancelled run says how far it got", () => {
      const r = sum([checkedFile("/w/a.esi", [])], { totalFiles: 5, cancelled: true });
      assert.strictEqual(r.level, "warning");
      assert.ok(r.message.startsWith("Cancelled after 1 of 5 .esi files: 0 errors, 0 warnings."));
    });
  });

  describe("formatReport", () => {
    it("lists unreadable first, then worst first, omits clean files", () => {
      const outcomes: FileOutcome[] = [
        checkedFile("/w/clean.esi", []),
        checkedFile("/w/warn.esi", [{}]),
        checkedFile("/w/z_err.esi", [{ severity: "error" }]),
        checkedFile("/w/a_err.esi", [{ severity: "error" }, { severity: "error" }, { severity: "hint" }]),
        unreadableFile("/w/gone.esi", "ENOENT"),
      ];
      const summary = summarizeWorkspace(outcomes, {
        totalFiles: 5,
        cancelled: false,
        hasIndex: true,
        profile: "RNE",
      });
      assert.deepStrictEqual(formatReport(outcomes, summary), [
        "[validate-workspace] profile: RNE",
        "[validate-workspace] NOT CHECKED /w/gone.esi: ENOENT",
        "[validate-workspace] /w/a_err.esi: 2 errors, 0 warnings, 1 note",
        "[validate-workspace] /w/z_err.esi: 1 error, 0 warnings",
        "[validate-workspace] /w/warn.esi: 0 errors, 1 warning",
        "[validate-workspace] 4 of 5 files checked, 3 errors, 1 warning, 1 note, 1 unreadable",
      ]);
    });

    it("notes a missing project and a cancelled run", () => {
      const outcomes: FileOutcome[] = [checkedFile("/w/a.esi", [])];
      const summary = summarizeWorkspace(outcomes, {
        totalFiles: 3,
        cancelled: true,
        hasIndex: false,
      });
      assert.deepStrictEqual(formatReport(outcomes, summary), [
        "[validate-workspace] profile: <none> (structural only — no active project)",
        "[validate-workspace] 1 of 3 files checked, 0 errors, 0 warnings, cancelled, 2 not reached",
      ]);
    });
  });
});
