import * as assert from "assert";
import { applyEdits } from "../../lib/quickFixes";
import {
  IncludedFile,
  MacroResolver,
  buildMacroModel,
  computeMacroCompletions,
  computeMacroQuickFixes,
  computeMacroRename,
  findMacroDefinitions,
  findMacroIssue,
  findMacroOccurrences,
  isValidMacroName,
  macroAt,
  prepareMacroRename,
  renderMacroHover,
  scanMacros,
  validateMacros,
} from "../../lib/macros";

const doc = (...lines: string[]): string => lines.join("\n");

const ROOT = doc(
  "[VARIABLES]", //                          0
  "    %COURSE% = 180   # %IGNORED% here", // 1
  "    %UNUSED% = 5", //                      2
  "[/VARIABLES]", //                          3
  "[TEST STEPS]", //                          4
  "    [STEP %N%]", //                        5
  "        [STEP INPUTS]", //                 6
  "            [429_L100_Msg]", //            7
  "                Course = %COURSE%", //     8
  "                # Other = %NOPE%", //      9
  "            [/429_L100_Msg]", //          10
  "        [/STEP INPUTS]", //               11
  "    [/STEP %N%]", //                      12
  "[/TEST STEPS]" //                         13
);

/** Reader over an in-memory file table; paths are used as keys verbatim. */
function reader(files: Record<string, string>, log?: string[]): MacroResolver {
  return {
    selfKey: "root.esi",
    readInclude(includePath): IncludedFile | undefined {
      log?.push(includePath);
      const text = files[includePath];
      return text === undefined ? undefined : { key: includePath, text };
    },
  };
}

describe("macros", () => {
  describe("scanMacros", () => {
    it("finds [VARIABLES] definitions with value and columns", () => {
      const scan = scanMacros(ROOT);
      assert.deepStrictEqual(
        scan.definitions.map((d) => [d.name, d.value, d.line, d.startCol, d.endCol, d.scope]),
        [
          ["COURSE", "180", 1, 4, 12, "variables"],
          ["UNUSED", "5", 2, 4, 12, "variables"],
        ]
      );
      assert.strictEqual(scan.isRootScript, true);
    });

    it("lists every occurrence outside comments, tag lines included", () => {
      const scan = scanMacros(ROOT);
      assert.deepStrictEqual(
        scan.occurrences.map((o) => [o.name, o.line, o.startCol, o.role]),
        [
          ["COURSE", 1, 4, "definition"],
          ["UNUSED", 2, 4, "definition"],
          ["N", 5, 10, "reference"],
          ["COURSE", 8, 25, "reference"],
          ["N", 12, 11, "reference"],
        ]
      );
    });

    it("is CRLF-safe", () => {
      const scan = scanMacros(ROOT.replace(/\n/g, "\r\n"));
      assert.strictEqual(scan.definitions[0].value, "180");
      assert.strictEqual(scan.occurrences.length, 5);
    });

    it("gives `%X% = v` outside [VARIABLES]/[INCLUDE] its own scope", () => {
      // It may define X for this section, or be a macro-named field key: it
      // is recorded as a "section" definition, never as an undefined use.
      const scan = scanMacros(doc("[429_L1_M]", "    %FIELD% = 1", "[/429_L1_M]"));
      assert.deepStrictEqual(
        scan.definitions.map((d) => [d.name, d.value, d.line, d.startCol, d.endCol, d.scope]),
        [["FIELD", "1", 1, 4, 11, "section"]]
      );
      assert.strictEqual(scan.occurrences[0].role, "definition");
    });

    it("counts a macro on the right of a definition as a reference", () => {
      const scan = scanMacros(doc("[VARIABLES]", "%A% = 1", "%B% = %A%_x", "[/VARIABLES]"));
      assert.deepStrictEqual(
        scan.occurrences.map((o) => [o.name, o.role]),
        [["A", "definition"], ["B", "definition"], ["A", "reference"]]
      );
      assert.strictEqual(scan.definitions[1].value, "%A%_x");
    });

    it("reads [INCLUDE] arguments and the include file", () => {
      const scan = scanMacros(
        doc(
          "[STEP Restart]",
          "    [INCLUDE]",
          "        %TESTSETUP%   = SLTS",
          "        include file  = ..\\Utilities\\RestartVORILS.esi  # why",
          "    [/INCLUDE]",
          "[/STEP Restart]"
        )
      );
      assert.deepStrictEqual(
        scan.definitions.map((d) => [d.name, d.value, d.scope]),
        [["TESTSETUP", "SLTS", "includeArgument"]]
      );
      assert.deepStrictEqual(scan.includes, [
        { path: "..\\Utilities\\RestartVORILS.esi", line: 3, startCol: 24, endCol: 54 },
      ]);
      assert.strictEqual(scan.isRootScript, false);
    });

    it("keeps a one-liner [NAME/] off the section stack", () => {
      const scan = scanMacros(
        doc("[VARIABLES]", "[STEP DUMP/]", "%A% = 1", "[/VARIABLES]")
      );
      assert.strictEqual(scan.definitions.length, 1);
    });

    it("does not pair percent signs across non-name text", () => {
      assert.deepStrictEqual(scanMacros("text = 50% of 100% done").occurrences, []);
    });
  });

  describe("includes", () => {
    const main = doc(
      "[TEST STEPS]",
      "[INCLUDE]",
      "include file = a.esi",
      "[/INCLUDE]",
      "x = %FROM_A% %FROM_B%",
      "[/TEST STEPS]"
    );
    const files = {
      "a.esi": doc("[VARIABLES]", "%FROM_A% = 1", "[/VARIABLES]", "[INCLUDE]", "include file = b.esi", "[/INCLUDE]"),
      "b.esi": doc("[VARIABLES]", "%FROM_B% = 2", "[/VARIABLES]", "[INCLUDE]", "include file = a.esi", "[/INCLUDE]", "[INCLUDE]", "include file = root.esi", "[/INCLUDE]"),
      "root.esi": main,
    };

    it("finds definitions in included files, transitively and cycle-safe", () => {
      const log: string[] = [];
      const model = buildMacroModel(main, reader(files, log));
      assert.deepStrictEqual(model.included.map((i) => i.key), ["a.esi", "b.esi"]);
      assert.strictEqual(model.unresolvedIncludes, false);
      const [def] = findMacroDefinitions(model, "FROM_B");
      assert.deepStrictEqual([def.file, def.line, def.value], ["b.esi", 1, "2"]);
      assert.deepStrictEqual(validateMacros(main, reader(files)), []);
    });

    it("stops at the depth limit and marks the model unresolved", () => {
      const model = buildMacroModel(main, { ...reader(files), maxDepth: 1 });
      assert.deepStrictEqual(model.included.map((i) => i.key), ["a.esi"]);
      assert.strictEqual(model.unresolvedIncludes, true);
    });

    it("marks unreadable, macro-pathed and reader-less includes unresolved", () => {
      assert.strictEqual(buildMacroModel(main, reader({})).unresolvedIncludes, true);
      assert.strictEqual(buildMacroModel(main).unresolvedIncludes, true);
      const macroPath = main.replace("a.esi", "%DIR%\\a.esi");
      assert.strictEqual(buildMacroModel(macroPath, reader(files)).unresolvedIncludes, true);
      const throwing: MacroResolver = { readInclude: () => { throw new Error("EACCES"); } };
      assert.strictEqual(buildMacroModel(main, throwing).unresolvedIncludes, true);
    });
  });

  describe("macroAt", () => {
    it("finds the token under the cursor, both percent signs included", () => {
      const line = 8;
      assert.strictEqual(macroAt(ROOT, line, 24), undefined);
      for (const col of [25, 26, 32, 33]) {
        const at = macroAt(ROOT, line, col);
        assert.deepStrictEqual([at?.name, at?.startCol, at?.endCol], ["COURSE", 25, 33]);
      }
    });

    it("ignores comments and out-of-range lines", () => {
      assert.strictEqual(macroAt(ROOT, 9, 30), undefined);
      assert.strictEqual(macroAt(ROOT, 1, 26), undefined);
      assert.strictEqual(macroAt(ROOT, 99, 0), undefined);
    });
  });

  describe("validateMacros", () => {
    it("reports undefined references (warning) and unused variables (hint)", () => {
      const issues = validateMacros(ROOT);
      assert.deepStrictEqual(
        issues.map((i) => [i.kind, i.identifier, i.line, i.startCol, i.endCol, i.severity, !!i.unnecessary]),
        [
          ["unusedMacro", "UNUSED", 2, 4, 12, "hint", true],
          ["undefinedMacro", "N", 5, 10, 13, "warning", false],
          ["undefinedMacro", "N", 12, 11, 14, "warning", false],
        ]
      );
    });

    it("says nothing for an include fragment (not a root script)", () => {
      const fragment = doc("[VARIABLES]", "%A% = 1", "[/VARIABLES]", "[STEP 1]", "x = %FROM_CALLER%", "[/STEP 1]");
      assert.deepStrictEqual(validateMacros(fragment), []);
    });

    it("says nothing at all when an include cannot be read", () => {
      const text = doc(
        "[VARIABLES]", "%MAYBE_USED_THERE% = 1", "[/VARIABLES]",
        "[TEST STEPS]", "[INCLUDE]", "include file = gone.esi", "[/INCLUDE]",
        "x = %MAYBE_DEFINED_THERE%", "[/TEST STEPS]"
      );
      assert.deepStrictEqual(validateMacros(text, reader({})), []);
      assert.deepStrictEqual(validateMacros(text), []);
    });

    it("counts a use inside an included file, and never flags include arguments", () => {
      const text = doc(
        "[VARIABLES]", "%SHARED% = 1", "[/VARIABLES]",
        "[TEST STEPS]", "[INCLUDE]", "%ARG% = 2", "include file = inc.esi", "[/INCLUDE]",
        "[/TEST STEPS]"
      );
      const files = { "inc.esi": "[STEP 1]\nx = %SHARED%\n[/STEP 1]" };
      assert.deepStrictEqual(validateMacros(text, reader(files)), []);
    });

    it("leaves %TIMEOUT% (used undefined by the CMD_EXECUTE snippet) and knownNames alone", () => {
      const text = doc("[TEST STEPS]", "wait timeout = %TIMEOUT%", "x = %SITE%", "y = %OTHER%", "[/TEST STEPS]");
      const issues = validateMacros(text, { knownNames: ["SITE"] });
      assert.deepStrictEqual(issues.map((i) => i.identifier), ["OTHER"]);
    });

    it("downgrades a case-only mismatch to a hint and does not call the twin unused", () => {
      const text = doc("[VARIABLES]", "%Course% = 1", "[/VARIABLES]", "[TEST STEPS]", "x = %COURSE%", "[/TEST STEPS]");
      const issues = validateMacros(text);
      assert.deepStrictEqual(
        issues.map((i) => [i.kind, i.identifier, i.severity]),
        [["undefinedMacro", "COURSE", "hint"]]
      );
      assert.ok(issues[0].message.includes("%Course%"));
    });
  });

  describe("definitions outside [VARIABLES]", () => {
    const undefinedIn = (text: string): string[] =>
      validateMacros(text)
        .filter((i) => i.kind === "undefinedMacro")
        .map((i) => i.identifier);

    it("never reports the macros TestPit fills in itself", () => {
      const text = doc(
        "[TEST STEPS]",
        "[STEP 10]",
        "[CMD_EXECUTE]",
        "system call = python x.py %TARGETIP% %PARTITIONPORTNUMBER% %FUNCTIONPORTNUMBER% %FUNCTARGETIP% %REPORTDIR% %SYSTEMTIME%",
        "wait timeout = %TIMEOUT%",
        "[/CMD_EXECUTE]",
        "[STEP OUTPUTS]",
        "[PART_A_B]",
        "time offset = %SYNCTIME%",
        "x = %NOPE%",
        "[/PART_A_B]",
        "[/STEP OUTPUTS]",
        "[/STEP 10]",
        "[/TEST STEPS]"
      );
      assert.deepStrictEqual(undefinedIn(text), ["NOPE"]);
    });

    it("takes a definition inside a [STEP n]", () => {
      const text = doc(
        "[TEST STEPS]",
        "[STEP 10]",
        "%LOCAL% = 5",
        "[STEP INPUTS]",
        "[429_X]",
        "time = %LOCAL%",
        "[/429_X]",
        "[/STEP INPUTS]",
        "[/STEP 10]",
        "[/TEST STEPS]"
      );
      assert.deepStrictEqual(validateMacros(text), []);
      const scan = scanMacros(text);
      assert.deepStrictEqual(
        scan.definitions.map((d) => [d.name, d.value, d.line, d.scope]),
        [["LOCAL", "5", 2, "section"]]
      );
      assert.deepStrictEqual(
        findMacroOccurrences(scan, "LOCAL").map((o) => [o.line, o.role]),
        [[2, "definition"], [5, "reference"]]
      );
      assert.strictEqual(findMacroDefinitions(buildMacroModel(text), "LOCAL").length, 1);
      assert.strictEqual(prepareMacroRename(text, 5, 8).ok, true);
    });

    it("takes a definition at top level and in a [DEFINITIONS] block", () => {
      const use = ["[TEST STEPS]", "x = %A%", "[/TEST STEPS]"];
      assert.deepStrictEqual(validateMacros(doc("%A% = 1", ...use)), []);
      assert.deepStrictEqual(
        validateMacros(doc("[DEFINITIONS]", "%A% = 1", "[/DEFINITIONS]", ...use)),
        []
      );
    });

    it("does not call such a definition unused, nor a variable used as a key", () => {
      const text = doc(
        "[VARIABLES]",
        "%KEY% = Course",
        "[/VARIABLES]",
        "[TEST STEPS]",
        "%NEVER_READ% = 1",
        "[429_X]",
        "%KEY% = 5",
        "[/429_X]",
        "[/TEST STEPS]"
      );
      assert.deepStrictEqual(validateMacros(text), []);
    });

    it("words the hover without naming a section it is not in", () => {
      const text = doc("[TEST STEPS]", "%A% = 1", "x = %A%", "[/TEST STEPS]");
      const hover = renderMacroHover(buildMacroModel(text), "A");
      assert.ok(hover.includes("`1` — defined, line 2"), hover);
      assert.ok(!hover.includes("[VARIABLES]"));
    });
  });

  describe("quick fixes", () => {
    const text = doc(
      "[VARIABLES]", //        0
      "    %COURSE% = 180", // 1
      "    %SPEED% = 3", //    2
      "[/VARIABLES]", //       3
      "[TEST STEPS]", //       4
      "x = %COURS% %SPEED%", //5
      "[/TEST STEPS]" //       6
    );

    it("offers the closest defined name for an undefined macro", () => {
      const issues = validateMacros(text);
      const issue = findMacroIssue(issues, "undefinedMacro", 5, 4, 11);
      assert.ok(issue);
      const fixes = computeMacroQuickFixes(text, issue);
      assert.deepStrictEqual(fixes.map((f) => [f.title, f.preferred]), [["Change to '%COURSE%'", true]]);
      assert.ok(applyEdits(text, fixes[0].edits).includes("x = %COURSE% %SPEED%"));
    });

    it("offers nothing when no name is close, or the diagnostic is stale", () => {
      const far = text.replace("%COURS%", "%ZZZZZZZZ%");
      const [issue] = validateMacros(far).filter((i) => i.kind === "undefinedMacro");
      assert.deepStrictEqual(computeMacroQuickFixes(far, issue), []);
      assert.deepStrictEqual(computeMacroQuickFixes(text, issue), []);
    });

    it("removes an unused single-line definition, on LF and CRLF", () => {
      for (const eol of ["\n", "\r\n"]) {
        const src = text.replace("%COURS% %SPEED%", "%COURSE%").replace(/\n/g, eol);
        const [issue] = validateMacros(src).filter((i) => i.identifier === "SPEED");
        assert.strictEqual(issue.kind, "unusedMacro");
        const [fix] = computeMacroQuickFixes(src, issue);
        assert.strictEqual(fix.title, "Remove unused variable '%SPEED%'");
        assert.strictEqual(
          applyEdits(src, fix.edits),
          src.replace(`    %SPEED% = 3${eol}`, "")
        );
      }
    });

    it("does not remove a definition with a hanging continuation line", () => {
      const src = doc("[VARIABLES]", "%A% = one", "      two", "[/VARIABLES]", "[TEST STEPS]", "[/TEST STEPS]");
      const [issue] = validateMacros(src);
      assert.strictEqual(issue.kind, "unusedMacro");
      assert.deepStrictEqual(computeMacroQuickFixes(src, issue), []);
    });
  });

  describe("rename", () => {
    it("prepares on the NAME range, from a reference or the definition", () => {
      assert.deepStrictEqual(prepareMacroRename(ROOT, 8, 28), {
        ok: true, name: "COURSE", line: 8, startCol: 26, endCol: 32,
      });
      assert.deepStrictEqual(prepareMacroRename(ROOT, 1, 4), {
        ok: true, name: "COURSE", line: 1, startCol: 5, endCol: 11,
      });
    });

    it("renames the definition and every reference, leaving comments alone", () => {
      const result = computeMacroRename(ROOT, 8, 28, "%HEADING%");
      assert.ok(result.ok);
      assert.strictEqual(result.edits.length, 2);
      const out = applyEdits(ROOT, result.edits);
      assert.ok(out.includes("    %HEADING% = 180   # %IGNORED% here"));
      assert.ok(out.includes("Course = %HEADING%"));
    });

    it("rejects invalid names and names already in use", () => {
      for (const bad of ["", "A B", "A%B", "A-B", "%%"]) {
        const r = computeMacroRename(ROOT, 8, 28, bad);
        assert.strictEqual(r.ok, false, bad);
      }
      const clash = computeMacroRename(ROOT, 8, 28, "UNUSED");
      assert.ok(!clash.ok && clash.reason.includes("already exists"));
      assert.ok(isValidMacroName("A_1") && !isValidMacroName("A.B"));
    });

    it("refuses what it cannot rename completely from this file", () => {
      assert.strictEqual(prepareMacroRename(ROOT, 0, 3).ok, false); // no macro
      assert.strictEqual(prepareMacroRename(ROOT, 5, 11).ok, false); // %N% not defined here
      const arg = doc("[INCLUDE]", "%ARG% = 1", "include file = a.esi", "[/INCLUDE]");
      assert.strictEqual(prepareMacroRename(arg, 1, 2).ok, false);
      const text = doc("[VARIABLES]", "%S% = 1", "[/VARIABLES]", "[INCLUDE]", "include file = a.esi", "[/INCLUDE]");
      assert.strictEqual(prepareMacroRename(text, 1, 1, reader({ "a.esi": "x = %S%" })).ok, false);
      assert.strictEqual(prepareMacroRename(text, 1, 1, reader({ "a.esi": "x = 1" })).ok, true);
    });

    it("refuses when an include could not be read (it may use the name)", () => {
      const withInclude = (includePath: string): string =>
        doc("[VARIABLES]", "%A% = 1", "[/VARIABLES]", "[INCLUDE]", `include file = ${includePath}`, "[/INCLUDE]", "x=%A%");
      const files = { "common.esi": "x = 1" };
      assert.strictEqual(prepareMacroRename(withInclude("common.esi"), 1, 1, reader(files)).ok, true);
      // Unreadable file, no reader at all, and a macro-valued path.
      const missing = prepareMacroRename(withInclude("other.esi"), 1, 1, reader(files));
      assert.ok(!missing.ok && missing.reason.includes("could not be read"));
      assert.strictEqual(computeMacroRename(withInclude("other.esi"), 1, 1, "B").ok, false);
      assert.strictEqual(
        prepareMacroRename(withInclude("%DIR%common.esi"), 1, 1, reader(files)).ok,
        false
      );
    });
  });

  describe("completion", () => {
    const text = (useLine: string): string =>
      doc("[VARIABLES]", "%TIME_A% = 10", "%TIME_B% = %TIME_A%0", "[/VARIABLES]", useLine);

    it("lists definitions with their value, replacing from the opening %", () => {
      const c = computeMacroCompletions(text("x = %TI"), 4, 7);
      assert.ok(c);
      assert.deepStrictEqual([c.startCol, c.endCol], [4, 7]);
      assert.deepStrictEqual(
        c.entries.map((e) => [e.name, e.insertText, e.filterText, e.detail]),
        [
          ["TIME_A", "%TIME_A%", "%TIME_A%", "= 10"],
          ["TIME_B", "%TIME_B%", "%TIME_B%", "= %TIME_A%0"],
        ]
      );
    });

    it("replaces through an existing closing %", () => {
      const c = computeMacroCompletions(text("x = %TIME% + 1"), 4, 7);
      assert.deepStrictEqual([c?.startCol, c?.endCol], [4, 10]);
      const bare = computeMacroCompletions(text("x = %%"), 4, 5);
      assert.deepStrictEqual([bare?.startCol, bare?.endCol], [4, 6]);
    });

    it("does not swallow the opening % of a following macro", () => {
      const c = computeMacroCompletions(text("x = %TI%TIME_B%"), 4, 7);
      assert.deepStrictEqual([c?.startCol, c?.endCol], [4, 7]);
    });

    it("offers nothing after a complete macro, in a comment, or with no %", () => {
      assert.strictEqual(computeMacroCompletions(text("x = %TIME_A%"), 4, 12), undefined);
      assert.strictEqual(computeMacroCompletions(text("x = 1 # %TI"), 4, 11), undefined);
      assert.strictEqual(computeMacroCompletions(text("x = TI"), 4, 6), undefined);
      // …but a new macro can be started right after one.
      assert.ok(computeMacroCompletions(text("x = %TIME_A%%"), 4, 13));
    });

    it("includes definitions from included files and notes differing values", () => {
      const src = doc("[VARIABLES]", "%A% = 1", "[/VARIABLES]", "[INCLUDE]", "include file = i.esi", "[/INCLUDE]", "x = %");
      const c = computeMacroCompletions(src, 6, 5, reader({ "i.esi": "[VARIABLES]\n%A% = 2\n%B% = 3\n[/VARIABLES]" }));
      assert.deepStrictEqual(
        c?.entries.map((e) => [e.name, e.detail]),
        [["A", "2 different values"], ["B", "= 3"]]
      );
    });

    it("does not offer a definition to itself while it is being typed", () => {
      const src = doc("[VARIABLES]", "%AB% = 1", "[/VARIABLES]");
      const c = computeMacroCompletions(src, 1, 2);
      assert.deepStrictEqual(c?.entries, []);
    });
  });

  describe("hover text", () => {
    it("shows value and place of definition", () => {
      const md = renderMacroHover(buildMacroModel(ROOT), "COURSE");
      assert.ok(md.includes("**%COURSE%**"));
      assert.ok(md.includes("`180`"));
      assert.ok(md.includes("defined in `[VARIABLES]`, line 2"));
    });

    it("names the included file and the [INCLUDE] argument form", () => {
      const src = doc("[TEST STEPS]", "[INCLUDE]", "%ARG% = v", "include file = dir/i.esi", "[/INCLUDE]", "[/TEST STEPS]");
      const model = buildMacroModel(src, reader({ "dir/i.esi": "[VARIABLES]\n%B% = 3\n[/VARIABLES]" }));
      assert.ok(renderMacroHover(model, "ARG").includes("passed to the included file"));
      assert.ok(
        renderMacroHover(model, "B", (k) => k.split("/").pop() as string).includes("of included file `i.esi`, line 2")
      );
    });

    it("explains a missing definition without claiming an error", () => {
      assert.ok(renderMacroHover(buildMacroModel(ROOT), "N").includes("No definition found"));
      assert.ok(renderMacroHover(buildMacroModel(ROOT), "TIMEOUT").includes("assumed to be supplied"));
      assert.ok(renderMacroHover(buildMacroModel("x = %A%"), "A").includes("probably included"));
      const unread = doc("[TEST STEPS]", "[INCLUDE]", "include file = a.esi", "[/INCLUDE]", "[/TEST STEPS]");
      assert.ok(renderMacroHover(buildMacroModel(unread), "A").includes("could not be read"));
    });
  });

  it("findMacroOccurrences returns definition and references of one name", () => {
    assert.deepStrictEqual(
      findMacroOccurrences(scanMacros(ROOT), "COURSE").map((o) => o.line),
      [1, 8]
    );
  });
});
