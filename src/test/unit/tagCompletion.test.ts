import * as assert from "assert";
import { parseSectionTagLine } from "../../lib/parseSectionTag";
import {
  computeTagCompletions,
  openSectionsBefore,
  STRUCTURAL_SECTIONS,
  TagCompletionEntry,
  TagCompletionResult,
  tagPositionOf,
} from "../../lib/tagCompletion";

const CONNECTIONS = ["429_L100", "1553_Foo", "PART_HSI_Alive"];

/**
 * Run a completion at the `|` marker in `lines` (the marker is removed).
 * The partial / closing flag are derived the way esiContext does it.
 */
function complete(lines: string[], eol = "\n"): TagCompletionResult {
  const lineIndex = lines.findIndex((l) => l.includes("|"));
  assert.notStrictEqual(lineIndex, -1, "test needs a | cursor marker");
  const character = lines[lineIndex].indexOf("|");
  const clean = lines.map((l) => l.replace("|", ""));
  const before = clean[lineIndex].slice(0, character);
  let partial = before.slice(before.lastIndexOf("[") + 1);
  const closing = partial.startsWith("/");
  if (closing) {
    partial = partial.slice(1);
  }
  const result = computeTagCompletions(
    clean.join(eol),
    lineIndex,
    character,
    partial,
    closing,
    CONNECTIONS
  );
  assert.ok(result, "expected a tag completion result");
  return result;
}

function entry(result: TagCompletionResult, label: string): TagCompletionEntry {
  const found = result.entries.find((e) => e.label === label);
  assert.ok(found, `no entry labelled ${label}`);
  return found;
}

function ranked(result: TagCompletionResult): string[] {
  return result.entries
    .slice()
    .sort((a, b) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0))
    .map((e) => e.label);
}

/** Apply an accepted entry to the cursor line (tab stops resolved to their defaults). */
function apply(lines: string[], label: string): string[] {
  const lineIndex = lines.findIndex((l) => l.includes("|"));
  const result = complete(lines);
  const e = entry(result, label);
  const line = lines[lineIndex].replace("|", "");
  let text = e.insertText;
  if (e.isSnippet) {
    text = text
      .replace(/\$\{\d+:([^}]*)\}/g, "$1")
      .replace(/\$0/g, "")
      .replace(/\\([\\$}])/g, "$1");
  }
  let head = line.slice(0, result.startCol);
  if (e.lineIndent !== undefined) {
    head = e.lineIndent + head.slice(result.bracketCol);
  }
  const out = lines.slice();
  out.splice(lineIndex, 1, ...(head + text + line.slice(result.endCol)).split("\n"));
  return out;
}

describe("tagCompletion", () => {
  describe("openSectionsBefore", () => {
    it("builds a proper stack and never stacks a one-liner", () => {
      const lines = [
        "[TEST STEPS]",
        "    [STEP 10]",
        "        [STEP DUMP/]",
        "        [STEP INPUTS]",
        "            [429_A]",
        "            [/429_A]",
        "            ",
      ];
      const stack = openSectionsBefore(lines, 6);
      assert.deepStrictEqual(
        stack.map((s) => [s.name, s.line, s.indent]),
        [
          ["TEST STEPS", 0, ""],
          ["STEP 10", 1, "    "],
          ["STEP INPUTS", 3, "        "],
        ]
      );
    });

    it("pops back to the opener when a close skips unclosed sections", () => {
      const lines = ["[A]", "[B]", "[C]", "[/A]", "[D]", ""];
      assert.deepStrictEqual(
        openSectionsBefore(lines, 5).map((s) => s.name),
        ["D"]
      );
    });

    it("ignores a stray close and a name TestPit would reject", () => {
      const lines = ["[A]", "[/NOPE]", "[ X / ]", "[]", ""];
      assert.deepStrictEqual(
        openSectionsBefore(lines, 4).map((s) => s.name),
        ["A"]
      );
    });

    it("accepts the sloppy forms TestPit repairs", () => {
      const lines = ["[[A]]", "[B] junk", "[//B]", "[C", ""];
      assert.deepStrictEqual(
        openSectionsBefore(lines, 4).map((s) => s.name),
        ["A", "C"]
      );
    });
  });

  describe("tagPositionOf", () => {
    const at = (...names: string[]): string =>
      tagPositionOf(names.map((name, line) => ({ name, line, indent: "" })));

    it("classifies the innermost open section", () => {
      assert.strictEqual(at(), "root");
      assert.strictEqual(at("TEST STEPS"), "testSteps");
      assert.strictEqual(at("TEST STEPS", "STEP 10"), "step");
      assert.strictEqual(at("TEST STEPS", "STEP GET_DUMP"), "step");
      assert.strictEqual(at("STEP 10", "STEP INPUTS"), "stepInputs");
      assert.strictEqual(at("STEP 10", "STEP OUTPUTS"), "stepOutputs");
      assert.strictEqual(at("STEP 10", "STEP DEFINITION"), "other");
      assert.strictEqual(at("STEP 10", "INCLUDE"), "include");
      assert.strictEqual(at("STEP INPUTS", "429_A"), "other");
    });
  });

  describe("opening tags", () => {
    it("offers every structural section plus the index connections", () => {
      const r = complete(["[|]"]);
      assert.strictEqual(r.mode, "open");
      const labels = r.entries.map((e) => e.label);
      for (const s of STRUCTURAL_SECTIONS) {
        assert.ok(labels.includes(s.name), s.name);
      }
      for (const c of CONNECTIONS) {
        assert.ok(labels.includes(c), c);
      }
      assert.strictEqual(entry(r, "429_L100").source, "connection");
      assert.strictEqual(entry(r, "TEST STEPS").source, "section");
    });

    it("offers the structural sections when there are no connections", () => {
      const r = computeTagCompletions("[", 0, 1, "", false, []);
      assert.ok(r);
      assert.strictEqual(r.entries.length, STRUCTURAL_SECTIONS.length);
    });

    it("ranks root sections first at file level", () => {
      const r = complete(["[|]"]);
      assert.strictEqual(r.position, "root");
      assert.deepStrictEqual(ranked(r).slice(0, 4), [
        "VARIABLES",
        "TEST DEFINITION",
        "TEST STEPS",
        "INCLUDE",
      ]);
      // Connections do not belong at file level: after every section.
      assert.ok(entry(r, "429_L100").sortText > entry(r, "TIMELIMIT").sortText);
    });

    it("ranks STEP first inside [TEST STEPS]", () => {
      const r = complete(["[TEST STEPS]", "    [|]", "[/TEST STEPS]"]);
      assert.strictEqual(r.position, "testSteps");
      assert.deepStrictEqual(ranked(r).slice(0, 2), ["STEP", "STEP GET_DUMP"]);
    });

    it("ranks the step parts first inside a step", () => {
      const r = complete(["[TEST STEPS]", "[STEP 10]", "[|]", "[/STEP 10]", "[/TEST STEPS]"]);
      assert.strictEqual(r.position, "step");
      assert.deepStrictEqual(ranked(r).slice(0, 4), [
        "STEP DEFINITION",
        "STEP INPUTS",
        "STEP OUTPUTS",
        "INCLUDE",
      ]);
    });

    it("ranks valid sections, then connections, inside [STEP INPUTS]", () => {
      const r = complete(["[STEP 10]", "[STEP INPUTS]", "[|]", "[/STEP INPUTS]", "[/STEP 10]"]);
      assert.strictEqual(r.position, "stepInputs");
      const order = ranked(r);
      assert.strictEqual(order[0], "TIMELIMIT");
      assert.ok(order.indexOf("CMD_EXECUTE") < order.indexOf("1553_Foo"));
      assert.ok(order.indexOf("1553_Foo") < order.indexOf("MANUAL_VERIFY"));
      assert.ok(order.indexOf("PART_HSI_Alive") < order.indexOf("TEST STEPS"));
    });

    it("ranks the verify sections first inside [STEP OUTPUTS]", () => {
      const r = complete(["[STEP 10]", "[STEP OUTPUTS]", "[|]", "[/STEP OUTPUTS]", "[/STEP 10]"]);
      assert.strictEqual(r.position, "stepOutputs");
      assert.deepStrictEqual(ranked(r).slice(0, 3), [
        "MANUAL_VERIFY",
        "EXTERNAL_VERIFY",
        "STEP DUMP",
      ]);
    });

    it("positions past a one-liner as if it were not there", () => {
      const r = complete(["[STEP 10]", "[STEP OUTPUTS]", "[STEP DUMP/]", "[|]"]);
      assert.strictEqual(r.position, "stepOutputs");
    });
  });

  describe("replace range and the auto-closed ]", () => {
    it("swallows the auto-closed ] instead of producing ]]", () => {
      const r = complete(["    [42|]"]);
      assert.strictEqual(r.bracketCol, 4);
      assert.strictEqual(r.startCol, 5);
      assert.strictEqual(r.endCol, 8);
      assert.deepStrictEqual(apply(["x = 1", "    [42|]   # c"], "429_L100"), [
        "x = 1",
        "    [429_L100]   # c",
      ]);
    });

    it("writes the ] itself only when nothing follows the cursor", () => {
      // Text after the cursor and no ] to swallow: just the name, as before.
      assert.deepStrictEqual(apply(["[42|   # c"], "429_L100"), ["[429_L100   # c"]);
      assert.deepStrictEqual(apply(["[TEST STEPS]", "[STEP 10]", "[/STEP 10]", "[STEP 2|"], "STEP GET_DUMP").slice(3), [
        "[STEP GET_DUMP]",
        "    ",
        "[/STEP GET_DUMP]",
      ]);
    });

    it("replaces the rest of an existing tag name, without a closing tag", () => {
      const lines = ["[STEP 10]", "    [STEP IN|PUTS]", "    [/STEP INPUTS]", "[/STEP 10]"];
      const e = entry(complete(lines), "STEP OUTPUTS");
      assert.strictEqual(e.isSnippet, false);
      assert.deepStrictEqual(apply(lines, "STEP OUTPUTS"), [
        "[STEP 10]",
        "    [STEP OUTPUTS]",
        "    [/STEP INPUTS]",
        "[/STEP 10]",
      ]);
    });

    it("leaves an inline [ (not a tag line) as it always was", () => {
      const r = complete(["    x = [42|]"]);
      assert.strictEqual(r.startCol, 9);
      assert.strictEqual(r.endCol, 11);
      const e = entry(r, "429_L100");
      assert.strictEqual(e.insertText, "429_L100");
      assert.strictEqual(e.isSnippet, false);
    });

    it("returns undefined when the partial does not sit behind a [", () => {
      assert.strictEqual(computeTagCompletions("abc", 0, 3, "bc", false, []), undefined);
      assert.strictEqual(computeTagCompletions("[a", 5, 1, "", false, []), undefined);
    });
  });

  describe("closing tag insertion", () => {
    it("adds the closing tag below a new tag, cursor in between", () => {
      const lines = ["[STEP 10]", "    [STEP INPUTS]", "        [|]", "    [/STEP INPUTS]", "[/STEP 10]"];
      const e = entry(complete(lines), "429_L100");
      assert.strictEqual(e.isSnippet, true);
      assert.strictEqual(
        e.insertText,
        "429_L100]\n            $0\n        [/429_L100]"
      );
      const out = apply(lines, "429_L100");
      assert.deepStrictEqual(out.slice(2, 5), [
        "        [429_L100]",
        "            ",
        "        [/429_L100]",
      ]);
      // What we produced is a balanced open/close pair.
      assert.strictEqual(parseSectionTagLine(out[2])?.kind, "open");
      assert.strictEqual(parseSectionTagLine(out[4])?.kind, "close");
      assert.strictEqual(parseSectionTagLine(out[4])?.name, "429_L100");
    });

    it("works on a line with no auto-closed ] and with CRLF text", () => {
      const lines = ["[TEST STEPS]", "\t[|", "[/TEST STEPS]"];
      const r = complete(lines, "\r\n");
      assert.strictEqual(
        entry(r, "STEP GET_DUMP").insertText,
        "STEP GET_DUMP]\n\t    $0\n\t[/STEP GET_DUMP]"
      );
    });

    it("gives STEP a mirrored id placeholder", () => {
      const e = entry(complete(["[TEST STEPS]", "    [|]", "[/TEST STEPS]"]), "STEP");
      assert.strictEqual(e.isSnippet, true);
      assert.strictEqual(
        e.insertText,
        "STEP ${1:10}]\n        $0\n    [/STEP ${1:10}]"
      );
    });

    it("does not add a closing tag when the tag is already closed below", () => {
      const lines = [
        "[STEP 10]",
        "    [STEP INPUTS]",
        "        [429_|]",
        "            time = 1",
        "        [/429_L100]",
        "    [/STEP INPUTS]",
        "[/STEP 10]",
      ];
      const r = complete(lines);
      const closed = entry(r, "429_L100");
      assert.strictEqual(closed.isSnippet, false);
      assert.strictEqual(closed.insertText, "429_L100]");
      // Nor does any other name: that close ends the block being retyped
      // here, so a new pair would orphan its body.
      assert.strictEqual(entry(r, "1553_Foo").isSnippet, false);
    });

    it("adds no closing tag when retyping the name of a block closed below", () => {
      // The old block's body and [/429_OLD] are still there: a new pair above
      // them would orphan both.
      for (const typed of ["[|]", "[429_|]"]) {
        const lines = ["[STEP INPUTS]", `  ${typed}`, "    time = 1", "  [/429_OLD]", "[/STEP INPUTS]"];
        const r = complete(lines);
        const renamed = entry(r, "429_L100");
        assert.strictEqual(renamed.isSnippet, false, typed);
        assert.strictEqual(renamed.insertText, "429_L100]", typed);
        assert.ok(r.entries.every((e) => !e.insertText.includes("[/")), typed);
      }
      // An unclaimed close past the enclosing section's end is not this block's.
      const outer = complete(["[STEP INPUTS]", "  [|]", "[/STEP INPUTS]", "[/429_OLD]"]);
      assert.strictEqual(entry(outer, "429_L100").isSnippet, true);
    });

    it("does not mistake an enclosing section's close for the new tag's", () => {
      // [/STEP INPUTS] below belongs to the opener above the cursor.
      const lines = ["[STEP 10]", "    [STEP INPUTS]", "    [/STEP INPUTS]", "    [|]", "    [/STEP OUTPUTS]", "[/STEP 10]"];
      const r = complete(lines);
      assert.strictEqual(entry(r, "STEP OUTPUTS").isSnippet, false);
      // The unclaimed [/STEP OUTPUTS] ends this line's block whatever is typed.
      assert.strictEqual(entry(r, "STEP INPUTS").isSnippet, false);

      const nested = complete(["[STEP 10]", "    [STEP INPUTS]", "        [|]", "    [/STEP INPUTS]", "[/STEP 10]"]);
      // Odd, but the point holds: that close is taken, so a pair is written.
      assert.strictEqual(entry(nested, "STEP INPUTS").isSnippet, true);
    });

    it("does not count a close that pairs with a later opener", () => {
      const lines = ["[STEP INPUTS]", "    [|]", "    [429_L100]", "    [/429_L100]", "[/STEP INPUTS]"];
      assert.strictEqual(entry(complete(lines), "429_L100").isSnippet, true);
    });

    it("skips the pair for STEP when an unclaimed step close is below", () => {
      const lines = ["[TEST STEPS]", "    [|]", "    [/STEP 20]", "[/TEST STEPS]"];
      const e = entry(complete(lines), "STEP");
      assert.strictEqual(e.insertText, "STEP ${1:10}]");
      assert.strictEqual(e.isSnippet, true);
    });

    it("never adds a closing tag when the line has other content", () => {
      for (const line of ["    [42|]  # note", "    [42|] junk", "    [429_|L100]"]) {
        const r = complete([line]);
        assert.ok(r.entries.every((e) => !e.insertText.includes("[/")), line);
      }
    });

    it("writes a one-liner as [NAME/] with no closing tag", () => {
      const lines = ["[STEP OUTPUTS]", "    [|]", "[/STEP OUTPUTS]"];
      const e = entry(complete(lines), "STEP DUMP");
      assert.strictEqual(e.insertText, "STEP DUMP/]");
      assert.strictEqual(e.isSnippet, false);
      const out = apply(lines, "STEP DUMP");
      assert.strictEqual(parseSectionTagLine(out[1])?.kind, "oneLiner");
    });

    it("escapes snippet metacharacters in names and indentation", () => {
      const r = computeTagCompletions("[", 0, 1, "", false, ["429_a$b}c\\d"]);
      assert.ok(r);
      const e = r.entries[r.entries.length - 1];
      assert.strictEqual(
        e.insertText,
        "429_a\\$b\\}c\\\\d]\n    $0\n[/429_a\\$b\\}c\\\\d]"
      );
    });
  });

  describe("closing tags", () => {
    const doc = [
      "[TEST STEPS]",
      "    [STEP 10]",
      "        [STEP DUMP/]",
      "        [STEP INPUTS]",
      "            [429_L100]",
      "                time = 1",
    ];

    it("offers the unclosed tags innermost first, the first preselected", () => {
      const r = complete([...doc, "            [/|]"]);
      assert.strictEqual(r.mode, "close");
      assert.deepStrictEqual(ranked(r), ["429_L100", "STEP INPUTS", "STEP 10", "TEST STEPS"]);
      assert.deepStrictEqual(
        r.entries.map((e) => e.preselect === true),
        [true, false, false, false]
      );
      assert.ok(r.entries.every((e) => e.source === "close" && !e.isSnippet));
      assert.strictEqual(r.entries[0].detail, "closes [429_L100] from line 5");
    });

    it("never offers a one-liner or an already closed section", () => {
      const r = complete([...doc, "            [/429_L100]", "        [/|]"]);
      assert.deepStrictEqual(ranked(r), ["STEP INPUTS", "STEP 10", "TEST STEPS"]);
    });

    it("swallows the auto-closed ] and the typed partial", () => {
      const lines = [...doc, "            [/42|]"];
      const r = complete(lines);
      assert.strictEqual(r.startCol, 14);
      assert.strictEqual(r.endCol, 17);
      assert.strictEqual(apply(lines, "429_L100")[6], "            [/429_L100]");
    });

    it("writes the ] when the line has none", () => {
      assert.strictEqual(apply([...doc, "            [/|"], "429_L100")[6], "            [/429_L100]");
    });

    it("moves the closing tag under its opening tag", () => {
      const lines = [...doc, "                [/|]"];
      const r = complete(lines);
      assert.strictEqual(entry(r, "429_L100").lineIndent, "            ");
      assert.strictEqual(entry(r, "TEST STEPS").lineIndent, "");
      assert.strictEqual(apply(lines, "STEP INPUTS")[6], "        [/STEP INPUTS]");
      // Already aligned: no indent edit.
      assert.strictEqual(entry(complete([...doc, "            [/|]"]), "429_L100").lineIndent, undefined);
    });

    it("offers nothing when no section is open", () => {
      assert.deepStrictEqual(complete(["[A]", "[/A]", "[/|]"]).entries, []);
    });

    it("leaves an inline [/ alone: no ] written, no indent edit", () => {
      const r = complete(["[A]", "    x = [/|"]);
      assert.strictEqual(r.entries[0].insertText, "A");
      assert.strictEqual(r.entries[0].lineIndent, undefined);
    });
  });
});
