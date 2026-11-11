import * as assert from "assert";
import { parseSectionTagLine } from "../../lib/parseSectionTag";
import {
  computeTagCompletions,
  openSectionsBefore,
  STEP_SKELETON_LABEL,
  STRUCTURAL_SECTIONS,
  TagCompletionEntry,
  TagCompletionResult,
  tagPositionOf,
  WITH_FIELDS_SUFFIX,
} from "../../lib/tagCompletion";
import { formatEsi } from "../../lib/formatEsi";

const CONNECTIONS = ["429_L100", "1553_Foo", "PART_HSI_Alive"];

/** Remove the single `|` cursor marker from a line (no-op when absent). */
function stripMarker(line: string): string {
  const at = line.indexOf("|");
  return at === -1 ? line : line.slice(0, at) + line.slice(at + 1);
}

/**
 * Run a completion at the `|` marker in `lines` (the marker is removed).
 * The partial / closing flag are derived the way esiContext does it.
 */
function complete(lines: string[], eol = "\n"): TagCompletionResult {
  const lineIndex = lines.findIndex((l) => l.includes("|"));
  assert.notStrictEqual(lineIndex, -1, "test needs a | cursor marker");
  const character = lines[lineIndex].indexOf("|");
  const clean = lines.map((l, i) => (i === lineIndex ? stripMarker(l) : l));
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
  const line = stripMarker(lines[lineIndex]);
  let text = e.insertText;
  if (e.isSnippet) {
    text = text
      .replace(/\$\{\d+:([^}]*)\}/g, "$1")
      .replace(/\$\d/g, "")
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
      // Every section, plus the full-skeleton variant of STEP.
      assert.strictEqual(r.entries.length, STRUCTURAL_SECTIONS.length + 1);
      assert.ok(r.entries.every((e) => e.source === "section"));
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
      assert.deepStrictEqual(ranked(r).slice(0, 3), [
        "STEP",
        STEP_SKELETON_LABEL,
        "STEP GET_DUMP",
      ]);
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
        "    [STEP INPUTS]",
        "    [/STEP INPUTS]",
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
        entry(r, "TEST STEPS").insertText,
        "TEST STEPS]\n\t    $0\n\t[/TEST STEPS]"
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

  describe("new step number", () => {
    const stepInsert = (lines: string[]): string => entry(complete(lines), "STEP").insertText;

    it("continues the file's numbering instead of a fixed id", () => {
      const lines = ["[TEST STEPS]", "[STEP 10]", "[/STEP 10]", "[STEP 20]", "[/STEP 20]", "[|]", "[/TEST STEPS]"];
      assert.strictEqual(stepInsert(lines), "STEP ${1:30}]\n    $0\n[/STEP ${1:30}]");
    });

    it("puts the number on a tag that gets no closing tag too", () => {
      const lines = ["[TEST STEPS]", "[STEP 5]", "[/STEP 5]", "[|]", "    x", "[/STEP 99]", "[/TEST STEPS]"];
      const e = entry(complete(lines), "STEP");
      assert.strictEqual(e.insertText, "STEP ${1:10}]");
      // Nothing new is being written: no skeleton variant either.
      assert.ok(!complete(lines).entries.some((x) => x.label === STEP_SKELETON_LABEL));
    });
  });

  describe("section bodies (one entry per section)", () => {
    const fresh = complete(["[|]"]);

    it("has no two entries with the same label", () => {
      const labels = fresh.entries.map((e) => e.label);
      assert.strictEqual(new Set(labels).size, labels.length);
    });

    it("fills a new block with the section's own lines", () => {
      assert.deepStrictEqual(apply(["[STEP 10]", "    [|]", "[/STEP 10]"], "STEP DEFINITION").slice(1, -1), [
        "    [STEP DEFINITION]",
        "        Step Description      = ",
        "        Step Requirements     = ",
        "        Step Dependencies     = N/A",
        "        Step Conditions       = <pre>",
        "                                    <br/> ",
        "                                    <br/> ",
        "                                </pre>",
        "        Step Expected Results = <pre>",
        "                                    <br/> ",
        "                                </pre>",
        "    [/STEP DEFINITION]",
      ]);
      assert.strictEqual(
        entry(fresh, "CMD_EXECUTE").insertText,
        "CMD_EXECUTE]\n    system call  = $1\n    wait timeout = %TIMEOUT%\n[/CMD_EXECUTE]"
      );
      assert.strictEqual(entry(fresh, "VARIABLES").insertText, "VARIABLES]\n    %$1% = $2\n[/VARIABLES]");
    });

    it("keeps the body out when only the name is replaced", () => {
      const e = entry(complete(["[STEP 10]", "    [STEP IN|PUTS]", "    [/STEP INPUTS]", "[/STEP 10]"]), "STEP DEFINITION");
      assert.strictEqual(e.insertText, "STEP DEFINITION]");
    });

    it("offers the full step skeleton right below the plain STEP", () => {
      const lines = ["[TEST STEPS]", "    [STEP 10]", "    [/STEP 10]", "    [|]", "[/TEST STEPS]"];
      const r = complete(lines);
      const skeleton = entry(r, STEP_SKELETON_LABEL);
      assert.strictEqual(skeleton.filterText, "STEP");
      assert.ok(skeleton.isSnippet);
      assert.ok(skeleton.sortText > entry(r, "STEP").sortText);
      assert.ok(skeleton.sortText < entry(r, "STEP GET_DUMP").sortText);
      // Tab stop 1 is the id (mirrored in the closing tag); 2..9 follow in order.
      assert.deepStrictEqual(
        skeleton.insertText.match(/\$\{1:20\}|\$\d/g),
        ["${1:20}", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9", "${1:20}"]
      );
      const out = apply(lines, STEP_SKELETON_LABEL).slice(3, -1);
      assert.strictEqual(out[0], "    [STEP 20]");
      assert.strictEqual(out[1], "        [STEP DEFINITION]");
      assert.strictEqual(out[2], "            Step Description      = ");
      assert.deepStrictEqual(out.slice(-7), [
        "        [STEP INPUTS]",
        "            ",
        "        [/STEP INPUTS]",
        "        [STEP OUTPUTS]",
        "            ",
        "        [/STEP OUTPUTS]",
        "    [/STEP 20]",
      ]);
    });

    it("writes bodies the formatter leaves alone", () => {
      const labels = [...STRUCTURAL_SECTIONS.filter((s) => s.body).map((s) => s.name), STEP_SKELETON_LABEL];
      assert.ok(labels.length > 5);
      for (const label of labels) {
        // Typed text in every tab stop: an empty one is a whitespace-only
        // line, which the formatter rightly trims.
        const text =
          "[" +
          entry(fresh, label)
            .insertText.replace(/\$\{\d+:([^}]*)\}/g, "$1")
            .replace(/\$\d/g, "x");
        assert.strictEqual(formatEsi(text).replace(/\n+$/, ""), text, label);
      }
    });
  });

  describe("component block with fields", () => {
    const keys = (name: string): string[] | undefined =>
      name === "429_L100" ? ["time", "SDI", "Mode.SelectedCourse"] : undefined;
    const run = (lines: string[]): TagCompletionResult => {
      const lineIndex = lines.findIndex((l) => l.includes("|"));
      const character = lines[lineIndex].indexOf("|");
      const clean = lines.map((l, i) => (i === lineIndex ? stripMarker(l) : l));
      const partial = clean[lineIndex].slice(clean[lineIndex].lastIndexOf("[", character) + 1, character);
      const r = computeTagCompletions(clean.join("\n"), lineIndex, character, partial, false, CONNECTIONS, {
        skeletonKeys: keys,
      });
      assert.ok(r);
      return r;
    };
    const label = "429_L100" + WITH_FIELDS_SUFFIX;

    it("is a second, lower-ranked entry beside the plain tag", () => {
      const r = run(["[STEP 10]", "[STEP INPUTS]", "    [|]", "[/STEP INPUTS]", "[/STEP 10]"]);
      const plain = entry(r, "429_L100");
      const withFields = entry(r, label);
      assert.strictEqual(plain.insertText, "429_L100]\n        $0\n    [/429_L100]");
      assert.strictEqual(
        withFields.insertText,
        [
          "429_L100]",
          "        time                = $1",
          "        SDI                 = $2",
          "        Mode.SelectedCourse = $3",
          "    [/429_L100]",
        ].join("\n")
      );
      assert.strictEqual(withFields.connectionName, "429_L100");
      assert.strictEqual(withFields.filterText, "429_L100");
      assert.ok(withFields.sortText > plain.sortText);
      // …and above a longer name sharing the prefix.
      assert.ok(withFields.sortText < `${plain.sortText}A`);
      assert.ok(!withFields.preselect);
      // (Dedented: the formatter indents by depth, and this text has no parents.)
      const text = "[" + withFields.insertText.replace(/\$\d/g, "x").replace(/\n {4}/g, "\n");
      assert.strictEqual(formatEsi(text).replace(/\n+$/, ""), text);
    });

    it("is offered only for a connection with known keys", () => {
      const r = run(["[STEP OUTPUTS]", "[|]", "[/STEP OUTPUTS]"]);
      assert.ok(r.entries.some((e) => e.label === label));
      assert.ok(!r.entries.some((e) => e.label === "1553_Foo" + WITH_FIELDS_SUFFIX));
    });

    it("is not offered outside the message sections or on an existing block", () => {
      const none = (lines: string[]): void =>
        assert.ok(!run(lines).entries.some((e) => e.label.endsWith(WITH_FIELDS_SUFFIX)), lines.join("/"));
      none(["[|]"]);
      none(["[STEP 10]", "[|]", "[/STEP 10]"]);
      // Renaming a tag whose block is already there.
      none(["[STEP INPUTS]", "  [42|9_OLD]", "    time = 1", "  [/429_OLD]", "[/STEP INPUTS]"]);
      none(["[STEP INPUTS]", "  [|]", "    time = 1", "  [/429_OLD]", "[/STEP INPUTS]"]);
    });
  });
});
