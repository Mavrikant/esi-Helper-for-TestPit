import * as assert from "assert";
import { formatEsi } from "../../lib/formatEsi";
import {
  applyLineEdits,
  computeLineEdits,
  selectionToLineSpan,
  type LineEdit,
} from "../../lib/lineEdits";
import { refactorWhitespace } from "../../lib/refactorWhitespace";

// A deliberately messy script touching every whole-document decision the
// formatter makes: nesting depth, `=` alignment groups, a `key = <pre>` block
// whose body follows the aligned `<pre>`, a one-liner section, a hanging
// continuation, tabs and trailing whitespace.
const MESSY = [
  "[STEP 10]",
  "[STEP DEFINITION]",
  "Step Description = does a thing   ",
  "Notes = <pre>",
  "first line",
  "      second line",
  "</pre>",
  "[/STEP DEFINITION]",
  "  [STEP INPUTS]",
  "\t[429_FOO_input1]  # Scenario 1",
  "a = 1",
  "LongFieldName = 2",
  "            b=3",
  "[/429_FOO_input1]",
  "[DIS_BAR/]",
  "[/STEP INPUTS]",
  "[STEP OUTPUTS]",
  "[429_BAZ_output1]",
  "value = one",
  "    two",
  "occurrence = 1",
  "[/429_BAZ_output1]",
  "[/STEP OUTPUTS]",
  "[/STEP 10]",
  "",
];

const lf = MESSY.join("\n");
const crlf = MESSY.join("\r\n");

function mustEdit(
  original: string,
  formatted: string,
  span?: { startLine: number; endLine: number }
): LineEdit[] {
  const edits = computeLineEdits(original, formatted, span);
  assert.ok(edits !== null, "line counts must match");
  return edits;
}

describe("lineEdits", () => {
  describe("computeLineEdits (whole document)", () => {
    it("returns no edits for identical text", () => {
      assert.deepStrictEqual(computeLineEdits("a\nb", "a\nb"), []);
    });

    it("returns null when the line counts differ", () => {
      assert.strictEqual(computeLineEdits("a\nb", "a"), null);
    });

    it("the fixture really exercises the formatter", () => {
      const formatted = formatEsi(lf);
      assert.notStrictEqual(formatted, lf);
      assert.ok(mustEdit(lf, formatted).length > 5);
    });

    it("applying the edits reproduces Format Document exactly (LF)", () => {
      const formatted = formatEsi(lf);
      assert.strictEqual(applyLineEdits(lf, mustEdit(lf, formatted)), formatted);
    });

    it("applying the edits reproduces Format Document and keeps CRLF", () => {
      const formatted = formatEsi(crlf);
      const result = applyLineEdits(crlf, mustEdit(crlf, formatted));
      assert.strictEqual(result, formatted.split("\n").join("\r\n"));
      assert.ok(!/[^\r]\n/.test(result), "every terminator is still CRLF");
    });

    it("is exact for tier alignment and for the whitespace-only transform", () => {
      const tier = formatEsi(lf, { alignScope: "tier" });
      assert.strictEqual(applyLineEdits(lf, mustEdit(lf, tier)), tier);
      const ws = refactorWhitespace(lf);
      assert.strictEqual(applyLineEdits(lf, mustEdit(lf, ws)), ws);
    });

    it("never puts a line terminator inside an edit", () => {
      for (const e of mustEdit(crlf, formatEsi(crlf))) {
        assert.ok(!/[\r\n]/.test(e.newText));
      }
    });

    it("replaces only the differing middle of a line", () => {
      assert.deepStrictEqual(computeLineEdits("x\nfoo = 1", "x\n    foo = 1"), [
        { line: 1, startCol: 0, endCol: 0, newText: "    " },
      ]);
      assert.deepStrictEqual(computeLineEdits("a = 1", "a   = 1"), [
        { line: 0, startCol: 2, endCol: 2, newText: "  " },
      ]);
      assert.deepStrictEqual(computeLineEdits("abc   ", "abc"), [
        { line: 0, startCol: 3, endCol: 6, newText: "" },
      ]);
    });

    it("handles repeated characters around the change without overlap", () => {
      const cases: Array<[string, string]> = [
        ["aaa", "aa"],
        ["aa", "aaa"],
        ["abab", "ab"],
        ["", "    x"],
        ["  x  ", ""],
      ];
      for (const [a, b] of cases) {
        const edits = mustEdit(a, b);
        assert.ok(edits[0].startCol <= edits[0].endCol);
        assert.strictEqual(applyLineEdits(a, edits), b);
      }
    });

    it("leaves untouched lines out of the edit list", () => {
      const original = "[STEP 10]\nfoo\n[/STEP 10]";
      const edits = mustEdit(original, formatEsi(original));
      assert.deepStrictEqual(
        edits.map((e) => e.line),
        [1]
      );
    });
  });

  describe("computeLineEdits (selection)", () => {
    for (const [label, text, eol] of [
      ["LF", lf, "\n"],
      ["CRLF", crlf, "\r\n"],
    ] as const) {
      it(`a selection covering the document equals Format Document (${label})`, () => {
        const formatted = formatEsi(text);
        const span = { startLine: 0, endLine: MESSY.length - 1 };
        assert.deepStrictEqual(
          computeLineEdits(text, formatted, span),
          computeLineEdits(text, formatted)
        );
        assert.strictEqual(
          applyLineEdits(text, mustEdit(text, formatted, span)),
          formatted.split("\n").join(eol)
        );
      });

      it(`every sub-selection changes only its own lines (${label})`, () => {
        const formatted = formatEsi(text).split("\n");
        const original = text.split(eol);
        for (let s = 0; s < MESSY.length; s++) {
          for (let e = s; e < MESSY.length; e++) {
            const edits = mustEdit(text, formatted.join("\n"), {
              startLine: s,
              endLine: e,
            });
            const result = applyLineEdits(text, edits).split(eol);
            assert.strictEqual(result.length, original.length);
            for (let i = 0; i < original.length; i++) {
              // Inside: the full-document result. Outside: byte-identical.
              const want = i >= s && i <= e ? formatted[i] : original[i];
              assert.strictEqual(result[i], want, `span ${s}-${e}, line ${i}`);
            }
          }
        }
      });
    }

    it("uses whole-document context for a one-line selection", () => {
      // Line 12 (`b=3`) alone: depth 3 and the `=` column of its whole group.
      const edits = mustEdit(lf, formatEsi(lf), { startLine: 12, endLine: 12 });
      const result = applyLineEdits(lf, edits).split("\n");
      assert.strictEqual(result[12], "            b             = 3");
      assert.strictEqual(result[11], MESSY[11]);
    });

    it("clamps a span that runs past the document", () => {
      const formatted = formatEsi(lf);
      assert.deepStrictEqual(
        computeLineEdits(lf, formatted, { startLine: -5, endLine: 9999 }),
        computeLineEdits(lf, formatted)
      );
      assert.deepStrictEqual(
        computeLineEdits(lf, formatted, { startLine: 500, endLine: 600 }),
        []
      );
    });
  });

  describe("selectionToLineSpan", () => {
    it("expands to whole lines", () => {
      assert.deepStrictEqual(selectionToLineSpan(2, 5, 3), {
        startLine: 2,
        endLine: 5,
      });
    });

    it("drops a last line the selection only touches at column 0", () => {
      assert.deepStrictEqual(selectionToLineSpan(2, 5, 0), {
        startLine: 2,
        endLine: 4,
      });
    });

    it("keeps a single-line selection, even an empty one at column 0", () => {
      assert.deepStrictEqual(selectionToLineSpan(3, 3, 0), {
        startLine: 3,
        endLine: 3,
      });
    });
  });
});
