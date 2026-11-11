import * as assert from "assert";
import {
  buildOutline,
  foldingRanges,
  outlineKindOf,
  OutlineNode,
} from "../../lib/esiOutline";

const doc = (...lines: string[]): string => lines.join("\n");

/** Compact shape for structural assertions: "NAME@start-end(children)". */
function shape(nodes: OutlineNode[]): string {
  return nodes
    .map((n) => {
      const kids = n.children.length ? `(${shape(n.children)})` : "";
      return `${n.name}@${n.startLine}-${n.endLine}${kids}`;
    })
    .join(",");
}

/** The invariants VS Code needs; checked on every tree a test builds. */
function assertWellFormed(text: string): OutlineNode[] {
  const lines = text.split(/\r?\n/);
  const roots = buildOutline(text);
  const visit = (nodes: OutlineNode[], parent?: OutlineNode): void => {
    let prevEnd = -1;
    for (const n of nodes) {
      assert.ok(n.name.length > 0, "name must not be empty");
      assert.ok(n.startLine >= 0 && n.endLine < lines.length, "in bounds");
      assert.ok(n.endLine >= n.startLine, `${n.name}: end before start`);
      assert.strictEqual(n.endCol, lines[n.endLine].length);
      assert.strictEqual(n.selectionLine, n.startLine);
      assert.ok(n.selectionStartCol >= 0);
      assert.ok(n.selectionEndCol >= n.selectionStartCol);
      assert.ok(
        n.selectionEndCol <= lines[n.selectionLine].length,
        `${n.name}: selection past end of line`
      );
      if (n.endLine === n.startLine) {
        assert.ok(n.selectionEndCol <= n.endCol);
      }
      assert.ok(n.startLine > prevEnd, `${n.name}: overlaps previous sibling`);
      prevEnd = n.endLine;
      if (parent) {
        assert.ok(n.startLine > parent.startLine, `${n.name}: starts before parent`);
        assert.ok(n.endLine <= parent.endLine, `${n.name}: ends after parent`);
      }
      if (n.oneLiner) {
        assert.strictEqual(n.children.length, 0);
        assert.strictEqual(n.endLine, n.startLine);
      }
      visit(n.children, n);
    }
  };
  visit(roots);

  let prev: { startLine: number; endLine: number } | undefined;
  for (const r of foldingRanges(text)) {
    assert.ok(r.startLine >= 0 && r.endLine < lines.length);
    assert.ok(r.endLine > r.startLine, "fold must span more than one line");
    if (prev) {
      assert.ok(r.startLine >= prev.startLine, "folds sorted by start");
    }
    prev = r;
  }
  return roots;
}

const SCRIPT = doc(
  "# header", //                                  0
  "[VARIABLES]", //                               1
  "    %X% = 1", //                               2
  "[/VARIABLES]", //                              3
  "", //                                          4
  "[TEST DEFINITION]", //                         5
  "    Test Description = Checks the thing", //   6
  "[/TEST DEFINITION]", //                        7
  "[TEST STEPS]", //                              8
  "    [STEP 10]", //                             9
  "        [STEP DEFINITION]", //                 10
  "            Step Description = First step  # note", // 11
  "        [/STEP DEFINITION]", //                12
  "        [STEP INPUTS]", //                     13
  "            [DIS_AirGround]", //               14
  "                value = ON_GROUND", //         15
  "            [/DIS_AirGround]", //              16
  "            [TIMELIMIT]", //                   17
  "                time = 5000", //               18
  "            [/TIMELIMIT]", //                  19
  "        [/STEP INPUTS]", //                    20
  "        [STEP OUTPUTS]", //                    21
  "            [429_L100]", //                    22
  "                time = 0", //                  23
  "            [/429_L100]", //                   24
  "            [STEP DUMP/]", //                  25
  "        [/STEP OUTPUTS]", //                   26
  "    [/STEP 10]", //                            27
  "[/TEST STEPS]" //                              28
);

describe("esiOutline", () => {
  describe("outlineKindOf", () => {
    it("classifies the well-known sections", () => {
      assert.strictEqual(outlineKindOf("TEST STEPS"), "testSteps");
      assert.strictEqual(outlineKindOf("VARIABLES"), "variables");
      assert.strictEqual(outlineKindOf("INCLUDE"), "include");
      assert.strictEqual(outlineKindOf("TEST DEFINITION"), "definition");
      assert.strictEqual(outlineKindOf("STEP DEFINITION"), "definition");
      assert.strictEqual(outlineKindOf("STEP INPUTS"), "stepIO");
      assert.strictEqual(outlineKindOf("STEP OUTPUTS"), "stepIO");
      assert.strictEqual(outlineKindOf("TIMELIMIT"), "section");
      assert.strictEqual(outlineKindOf("MANUAL_VERIFY"), "section");
    });

    it("treats STEP <id> as a step but not the reserved STEP sections", () => {
      assert.strictEqual(outlineKindOf("STEP 10"), "step");
      assert.strictEqual(outlineKindOf("STEP Restart"), "step");
      assert.strictEqual(outlineKindOf("STEP START_CORE0"), "step");
      assert.strictEqual(outlineKindOf("STEP DUMP"), "section");
      assert.strictEqual(outlineKindOf("STEPPER"), "section");
    });

    it("recognises every component bus prefix", () => {
      for (const name of [
        "429_L100",
        "1553_RT1_SA2",
        "DIS_AirGround",
        "Mem_Port",
        "VORILS1_VORILSDataMsg",
        "VORILS2_VORILSDataMsg",
        "ED_Type1",
        "PART_HSI_RNEGeneralWritePSAlive",
      ]) {
        assert.strictEqual(outlineKindOf(name), "component", name);
      }
      assert.strictEqual(outlineKindOf("429"), "section");
      assert.strictEqual(outlineKindOf("DISCRETE"), "section");
    });
  });

  describe("buildOutline", () => {
    it("returns nothing for empty or tag-less text", () => {
      assert.deepStrictEqual(buildOutline(""), []);
      assert.deepStrictEqual(buildOutline("\n\n"), []);
      assert.deepStrictEqual(buildOutline("just prose\nkey = value\n"), []);
    });

    it("builds the full tree of a normal script", () => {
      const roots = assertWellFormed(SCRIPT);
      assert.strictEqual(
        shape(roots),
        "VARIABLES@1-3,TEST DEFINITION@5-7," +
          "TEST STEPS@8-28(STEP 10@9-27(" +
          "STEP DEFINITION@10-12," +
          "STEP INPUTS@13-20(DIS_AirGround@14-16,TIMELIMIT@17-19)," +
          "STEP OUTPUTS@21-26(429_L100@22-24,STEP DUMP@25-25)))"
      );
    });

    it("assigns distinct kinds", () => {
      const roots = buildOutline(SCRIPT);
      const [vars, def, steps] = roots;
      const step = steps.children[0];
      const [stepDef, inputs, outputs] = step.children;
      assert.strictEqual(vars.kind, "variables");
      assert.strictEqual(def.kind, "definition");
      assert.strictEqual(steps.kind, "testSteps");
      assert.strictEqual(step.kind, "step");
      assert.strictEqual(stepDef.kind, "definition");
      assert.strictEqual(inputs.kind, "stepIO");
      assert.strictEqual(outputs.kind, "stepIO");
      assert.strictEqual(inputs.children[0].kind, "component");
      assert.strictEqual(inputs.children[1].kind, "section");
      assert.strictEqual(outputs.children[0].kind, "component");
    });

    it("reports the tag's own columns as the selection", () => {
      const step = buildOutline(SCRIPT)[2].children[0];
      assert.strictEqual(step.selectionLine, 9);
      assert.strictEqual(step.selectionStartCol, 4);
      assert.strictEqual(step.selectionEndCol, 13);
      assert.strictEqual(step.endCol, "    [/STEP 10]".length);
      assert.strictEqual(step.closed, true);
    });

    it("makes a one-liner a closed leaf that does not swallow what follows", () => {
      const text = doc(
        "[STEP OUTPUTS]",
        "    [STEP DUMP/]",
        "    [DIS_X/]",
        "    [429_A]",
        "    [/429_A]",
        "[/STEP OUTPUTS]"
      );
      const roots = assertWellFormed(text);
      assert.strictEqual(
        shape(roots),
        "STEP OUTPUTS@0-5(STEP DUMP@1-1,DIS_X@2-2,429_A@3-4)"
      );
      const [dump, dis] = roots[0].children;
      assert.strictEqual(dump.oneLiner, true);
      assert.strictEqual(dump.closed, true);
      assert.strictEqual(dump.kind, "section");
      assert.strictEqual(dis.kind, "component");
      assert.strictEqual(dump.selectionStartCol, 4);
      assert.strictEqual(dump.selectionEndCol, 16);
    });

    describe("detail", () => {
      it("puts the step description on the step", () => {
        const step = buildOutline(SCRIPT)[2].children[0];
        assert.strictEqual(step.detail, "First step");
        assert.strictEqual(step.children[0].detail, "");
      });

      it("puts the test description on [TEST DEFINITION]", () => {
        assert.strictEqual(buildOutline(SCRIPT)[1].detail, "Checks the thing");
      });

      it("puts the include file on [INCLUDE]", () => {
        const roots = buildOutline(
          doc(
            "[STEP Restart]",
            "    [INCLUDE]",
            "        %TESTSETUP%   = SLTS",
            "        include file  = ..\\Utilities\\RestartVORILS.esi",
            "    [/INCLUDE]",
            "[/STEP Restart]"
          )
        );
        assert.strictEqual(roots[0].kind, "step");
        assert.strictEqual(roots[0].detail, "");
        assert.strictEqual(roots[0].children[0].kind, "include");
        assert.strictEqual(
          roots[0].children[0].detail,
          "..\\Utilities\\RestartVORILS.esi"
        );
      });

      it("takes the first body line of a <pre> description, without markup", () => {
        const roots = buildOutline(
          doc(
            "[STEP 20]",
            "    [STEP DEFINITION]",
            "        Step Description = <pre>",
            "",
            "                           <br/> * Verify   the output",
            "                           <br/> * second line",
            "                           </pre>",
            "        Step Requirements = SW_HLR_1",
            "    [/STEP DEFINITION]",
            "[/STEP 20]"
          )
        );
        assert.strictEqual(roots[0].detail, "* Verify the output");
      });

      it("leaves detail empty for an empty <pre> description", () => {
        const roots = buildOutline(
          doc(
            "[STEP 20]",
            "    [STEP DEFINITION]",
            "        Step Description = <pre>",
            "        </pre>",
            "        Step Requirements = SW_HLR_1",
            "    [/STEP DEFINITION]",
            "[/STEP 20]"
          )
        );
        assert.strictEqual(roots[0].detail, "");
      });

      it("keeps the first description and ignores ones outside the definition", () => {
        const roots = buildOutline(
          doc(
            "[STEP 20]",
            "    Step Description = not in a definition",
            "    [STEP DEFINITION]",
            "        step   description=one",
            "        Step Description = two",
            "    [/STEP DEFINITION]",
            "    [STEP INPUTS]",
            "        Step Description = three",
            "    [/STEP INPUTS]",
            "[/STEP 20]"
          )
        );
        assert.strictEqual(roots[0].detail, "one");
      });

      it("does not leak a [STEP DEFINITION] description onto a non-step parent", () => {
        const roots = buildOutline(
          doc(
            "[STEP DEFINITION]",
            "    Step Description = orphan",
            "[/STEP DEFINITION]"
          )
        );
        assert.strictEqual(roots[0].detail, "");
      });

      it("truncates a very long description", () => {
        const roots = buildOutline(
          doc(
            "[TEST DEFINITION]",
            `Test Description = ${"x".repeat(500)}`,
            "[/TEST DEFINITION]"
          )
        );
        assert.strictEqual(roots[0].detail.length, 120);
        assert.ok(roots[0].detail.endsWith("…"));
      });
    });

    describe("comments (as the validator treats them)", () => {
      it("ignores tags on # lines", () => {
        const text = doc(
          "[STEP 1]",
          "# [STEP 2]",
          "    #[/STEP 1]",
          "    time = 0",
          "[/STEP 1]"
        );
        assert.strictEqual(shape(assertWellFormed(text)), "STEP 1@0-4");
      });

      it("keeps a trailing comment out of the name and the selection", () => {
        const text = doc("  [STEP DUMP/]   # dump everything", "[A] # [/A]", "[/A]");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "STEP DUMP@0-0,A@1-2");
        assert.strictEqual(roots[0].selectionStartCol, 2);
        assert.strictEqual(roots[0].selectionEndCol, 14);
      });

      it("does not treat a bracket inside a value as a tag", () => {
        const text = doc("[A]", "value = [1, 2, 3]", "Step Description = see [STEP 1]", "[/A]");
        assert.strictEqual(shape(assertWellFormed(text)), "A@0-3");
      });
    });

    describe("sloppy forms TestPit repairs", () => {
      it("normalizes [[NAME]] and [//NAME]", () => {
        const text = doc("[[STEP INPUTS]]", "  time = 0", "[//STEP INPUTS]");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "STEP INPUTS@0-2");
        assert.strictEqual(roots[0].kind, "stepIO");
        assert.strictEqual(roots[0].closed, true);
      });

      it("truncates text left after the tag end", () => {
        const text = doc("[STEP INPUTS] trailing junk", "[/STEP INPUTS] more");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "STEP INPUTS@0-1");
        assert.strictEqual(roots[0].selectionEndCol, 13);
      });

      it("supplies a missing closing brace", () => {
        const text = doc("[STEP INPUTS", "  time = 0", "[/STEP INPUTS", "");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "STEP INPUTS@0-2");
        assert.strictEqual(roots[0].selectionEndCol, 12);
      });

      it("treats [/NAME/] as a close, not a one-liner", () => {
        const text = doc("[STEP DUMP]", "x = 1", "[/STEP DUMP/]");
        assert.strictEqual(shape(assertWellFormed(text)), "STEP DUMP@0-2");
      });

      it("collapses a doubled slash on a one-liner", () => {
        const text = doc("[A]", "[STEP DUMP//]", "[/A]");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "A@0-2(STEP DUMP@1-1)");
        assert.strictEqual(roots[0].children[0].oneLiner, true);
      });

      it("skips names TestPit rejects (empty, or still holding a slash)", () => {
        const text = doc("[A]", "[]", "[ NAME / ]", "[/]", "[X/Y]", "[/A]");
        assert.strictEqual(shape(assertWellFormed(text)), "A@0-5");
      });
    });

    describe("recovery", () => {
      it("runs sections left open at end of file to the last non-blank line", () => {
        const text = doc("[TEST STEPS]", "  [STEP 1]", "    time = 0", "", "");
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "TEST STEPS@0-2(STEP 1@1-2)");
        assert.strictEqual(roots[0].closed, false);
        assert.strictEqual(roots[0].children[0].closed, false);
      });

      it("handles a lone opener on the last line", () => {
        const roots = assertWellFormed("x = 1\n[STEP 1]");
        assert.strictEqual(shape(roots), "STEP 1@1-1");
      });

      it("ignores a stray closer", () => {
        const text = doc("[/NOPE]", "[A]", "[/B]", "[/A]", "[/A]");
        assert.strictEqual(shape(assertWellFormed(text)), "A@1-3");
      });

      it("ends an unclosed inner section just before the outer closer", () => {
        const text = doc(
          "[A]", //        0
          "  [B]", //      1
          "    x = 1", //  2
          "", //           3
          "[/A]", //       4
          "[C]", //        5
          "[/C]" //        6
        );
        const roots = assertWellFormed(text);
        assert.strictEqual(shape(roots), "A@0-4(B@1-2),C@5-6");
        assert.strictEqual(roots[0].children[0].closed, false);
        assert.strictEqual(roots[0].closed, true);
      });

      it("keeps an unclosed section's children inside it", () => {
        const text = doc(
          "[A]", //     0
          "[B]", //     1
          "[C]", //     2
          "[D]", //     3
          "[/D]", //    4
          "", //        5
          "[/A]" //     6
        );
        assert.strictEqual(
          shape(assertWellFormed(text)),
          "A@0-6(B@1-4(C@2-4(D@3-4)))"
        );
      });

      it("ends an unclosed section immediately followed by the outer closer on its own line", () => {
        const text = doc("[A]", "[B]", "[/A]");
        assert.strictEqual(shape(assertWellFormed(text)), "A@0-2(B@1-1)");
      });

      it("matches a mismatched closer to the nearest open section of that name", () => {
        const text = doc("[A]", "[A]", "[B]", "[/A]", "[/B]", "[/A]");
        assert.strictEqual(shape(assertWellFormed(text)), "A@0-5(A@1-3(B@2-2))");
      });

      it("does not let an unclosed one-liner-looking opener cascade", () => {
        // The bug parseSectionTag exists to prevent: [STEP DUMP/] must not
        // stay open and capture the rest of the file.
        const text = doc("[STEP 1]", "[STEP DUMP/]", "[/STEP 1]", "[STEP 2]", "[/STEP 2]");
        assert.strictEqual(
          shape(assertWellFormed(text)),
          "STEP 1@0-2(STEP DUMP@1-1),STEP 2@3-4"
        );
      });
    });

    it("handles CRLF line endings", () => {
      const crlf = SCRIPT.replace(/\n/g, "\r\n") + "\r\n";
      const roots = assertWellFormed(crlf);
      assert.deepStrictEqual(
        shape(roots),
        shape(buildOutline(SCRIPT))
      );
      const step = roots[2].children[0];
      assert.strictEqual(step.detail, "First step");
      assert.strictEqual(step.endCol, "    [/STEP 10]".length);
      assert.strictEqual(roots[2].name, "TEST STEPS");
    });

    it("handles tabs for indentation", () => {
      const roots = assertWellFormed("\t[STEP 1]\n\t\ttime = 0\n\t[/STEP 1]");
      assert.strictEqual(shape(roots), "STEP 1@0-2");
      assert.strictEqual(roots[0].selectionStartCol, 1);
      assert.strictEqual(roots[0].selectionEndCol, 9);
    });

    it("never throws and stays well-formed on arbitrary tag soup", () => {
      const pieces = [
        "[A]", "[/A]", "[B]", "[/B]", "[A/]", "[[B]]", "[//A]", "[", "]", "[]",
        "[/]", "[A", "[/B", "# [A]", "", "   ", "x = <pre>", "</pre>", "x = 1",
        "[A] junk", "[ A / ]", "[STEP 1]", "[/STEP 1]", "\t[STEP DEFINITION]",
        "Step Description = <pre>", "[/STEP DEFINITION]", "#", "<pre>a</pre>",
      ];
      // Deterministic LCG so a failure is reproducible.
      let seed = 12345;
      const next = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      };
      for (let round = 0; round < 400; round++) {
        const n = next() % 25;
        const lines: string[] = [];
        for (let i = 0; i < n; i++) {
          lines.push(pieces[next() % pieces.length]);
        }
        const eol = round % 2 === 0 ? "\n" : "\r\n";
        assertWellFormed(lines.join(eol));
      }
    });
  });

  describe("foldingRanges", () => {
    const plain = (text: string): string =>
      foldingRanges(text)
        .map((r) => `${r.startLine}-${r.endLine}${r.kind ? ":" + r.kind : ""}`)
        .join(" ");

    it("returns nothing for empty text", () => {
      assert.deepStrictEqual(foldingRanges(""), []);
    });

    it("folds each multi-line section, leaving its closing tag visible", () => {
      assert.strictEqual(
        plain(SCRIPT),
        "1-2 5-6 8-27 9-26 10-11 13-19 14-15 17-18 21-25 22-23"
      );
    });

    it("does not fold one-liners or sections with no body", () => {
      assert.strictEqual(plain(doc("[STEP DUMP/]", "[A]", "[/A]", "[B]")), "");
    });

    it("folds an unclosed section through its last line", () => {
      assert.strictEqual(
        plain(doc("[A]", "  [B]", "    x = 1", "[/A]")),
        "0-2 1-2"
      );
      assert.strictEqual(plain(doc("[A]", "x = 1", "y = 2", "")), "0-2");
    });

    it("folds <pre> bodies, keeping </pre> visible", () => {
      const text = doc(
        "[STEP DEFINITION]", //           0
        "  Step Conditions = <pre>", //   1
        "                    <br/> a", // 2
        "                    <br/> b", // 3
        "                    </pre>", //  4
        "  One = <pre> inline </pre>", // 5
        "  Empty = <pre>", //             6
        "  </pre>", //                    7
        "[/STEP DEFINITION]" //           8
      );
      assert.strictEqual(plain(text), "0-7 1-3");
    });

    it("ignores an unmatched <pre> or </pre>", () => {
      assert.strictEqual(plain(doc("a = <pre>", "body", "more")), "");
      assert.strictEqual(plain(doc("body", "more", "</pre>")), "");
      assert.strictEqual(plain(doc("a = <prefix>", "body", "</pre>")), "");
    });

    it("folds runs of two or more comment lines as comments", () => {
      const text = doc(
        "# a", //        0
        "  # b", //      1
        "#c", //         2
        "", //           3
        "# lone", //     4
        "[A]", //        5
        "  # x", //      6
        "  # y", //      7
        "  k = 1 # z", // 8
        "[/A]", //       9
        "# tail 1", //   10
        "# tail 2" //    11
      );
      assert.strictEqual(plain(text), "0-2:comment 5-8 6-7:comment 10-11:comment");
    });

    it("handles CRLF", () => {
      const crlf = SCRIPT.replace(/\n/g, "\r\n");
      assert.strictEqual(plain(crlf), plain(SCRIPT));
      assert.strictEqual(
        plain("# a\r\n# b\r\nx = <pre>\r\n1\r\n2\r\n</pre>\r\n"),
        "0-1:comment 2-4"
      );
    });

    it("sorts outer folds before inner ones on the same start line", () => {
      const r = foldingRanges(SCRIPT);
      for (let i = 1; i < r.length; i++) {
        assert.ok(
          r[i].startLine > r[i - 1].startLine ||
            (r[i].startLine === r[i - 1].startLine &&
              r[i].endLine <= r[i - 1].endLine)
        );
      }
    });
  });
});
