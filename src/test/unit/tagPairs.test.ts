import * as assert from "assert";
import {
  buildTagPairs,
  findMatchingTag,
  findMatchingTagLine,
  findTagPair,
  TAG_NAME_WORD_PATTERN,
  TagPair,
} from "../../lib/tagPairs";

const doc = (...lines: string[]): string => lines.join("\n");

/** Compact shape: "NAME@openLine-closeLine". */
function shape(pairs: TagPair[]): string {
  return pairs
    .map((p) => `${p.name}@${p.open.line}-${p.close.line}`)
    .sort()
    .join(",");
}

/** The text a range covers, so tests assert on what the user would see. */
function nameAt(text: string, r: { line: number; startCol: number; endCol: number }): string {
  return text.split(/\r?\n/)[r.line].slice(r.startCol, r.endCol);
}

function tagAt(
  text: string,
  r: { line: number; tagStartCol: number; tagEndCol: number }
): string {
  return text.split(/\r?\n/)[r.line].slice(r.tagStartCol, r.tagEndCol);
}

describe("tagPairs", () => {
  describe("buildTagPairs", () => {
    it("pairs nested sections with a proper stack", () => {
      const text = doc(
        "[TEST STEPS]",
        "  [STEP 1]",
        "    [STEP INPUTS]",
        "      a = 1",
        "    [/STEP INPUTS]",
        "  [/STEP 1]",
        "  [STEP 2]",
        "  [/STEP 2]",
        "[/TEST STEPS]"
      );
      assert.strictEqual(
        shape(buildTagPairs(text)),
        "STEP 1@1-5,STEP 2@6-7,STEP INPUTS@2-4,TEST STEPS@0-8"
      );
    });

    it("pairs same-named nested sections inner-to-inner", () => {
      const text = doc("[A]", "[A]", "[/A]", "[/A]");
      assert.strictEqual(shape(buildTagPairs(text)), "A@0-3,A@1-2");
    });

    it("never stacks a one-liner and gives it no pair", () => {
      const text = doc("[A]", "[STEP DUMP/]", "[B/]", "[/A]", "[/B]");
      // [B/] must not be matched by the later stray [/B].
      assert.strictEqual(shape(buildTagPairs(text)), "A@0-3");
    });

    it("ignores stray and mismatched closers without disturbing the stack", () => {
      const text = doc("[A]", "[/X]", "[B]", "[/B]", "[/A]", "[/A]");
      assert.strictEqual(shape(buildTagPairs(text)), "A@0-4,B@2-3");
    });

    it("drops tags left open when an outer closer is reached", () => {
      const text = doc("[A]", "[B]", "[/A]", "[/B]");
      // Same as the validator: [B] was never closed, the late [/B] is stray.
      assert.strictEqual(shape(buildTagPairs(text)), "A@0-2");
    });

    it("is case-sensitive, like the validator's stack", () => {
      assert.strictEqual(shape(buildTagPairs(doc("[Abc]", "[/ABC]"))), "");
    });

    it("skips comments, commented-out tags and rejected names", () => {
      const text = doc(
        "[A]",
        "# [B]",
        "[ X / ]",
        "[]",
        "key = [/A]",
        "[/A] # [B]"
      );
      assert.strictEqual(shape(buildTagPairs(text)), "A@0-5");
    });

    it("handles CRLF and empty input", () => {
      assert.deepStrictEqual(buildTagPairs(""), []);
      const text = "[A]\r\n  x = 1\r\n[/A]\r\n";
      const [pair] = buildTagPairs(text);
      assert.strictEqual(nameAt(text, pair.open), "A");
      assert.strictEqual(nameAt(text, pair.close), "A");
      assert.strictEqual(tagAt(text, pair.close), "[/A]");
    });

    it("locates the name inside the sloppy forms TestPit repairs", () => {
      const text = doc(
        "\t[[STEP 1]]  ",
        "  [INNER] junk",
        "  [//INNER]",
        "  [OPEN",
        "  [/OPEN",
        "[/STEP 1]] trailing # comment"
      );
      const pairs = buildTagPairs(text);
      assert.strictEqual(shape(pairs), "INNER@1-2,OPEN@3-4,STEP 1@0-5");
      for (const p of pairs) {
        assert.strictEqual(nameAt(text, p.open), p.name);
        assert.strictEqual(nameAt(text, p.close), p.name);
      }
      const step = pairs.find((p) => p.name === "STEP 1")!;
      assert.strictEqual(tagAt(text, step.open), "[[STEP 1]]");
      assert.strictEqual(tagAt(text, step.close), "[/STEP 1]]");
      const inner = pairs.find((p) => p.name === "INNER")!;
      assert.strictEqual(tagAt(text, inner.open), "[INNER]");
      assert.strictEqual(tagAt(text, inner.close), "[//INNER]");
      const open = pairs.find((p) => p.name === "OPEN")!;
      assert.strictEqual(tagAt(text, open.open), "[OPEN");
      assert.strictEqual(tagAt(text, open.close), "[/OPEN");
    });

    it("locates a padded name without its padding", () => {
      const text = doc("[  429_FOO_BAR  ]", "[/ 429_FOO_BAR ]");
      const [pair] = buildTagPairs(text);
      assert.strictEqual(nameAt(text, pair.open), "429_FOO_BAR");
      assert.strictEqual(nameAt(text, pair.close), "429_FOO_BAR");
      assert.strictEqual(pair.open.startCol, 3);
      assert.strictEqual(pair.close.startCol, 3);
    });

    it("treats a tab like the space TestPit turns it into", () => {
      const text = doc("[STEP\t1]", "[/STEP 1]");
      const [pair] = buildTagPairs(text);
      assert.strictEqual(pair.name, "STEP 1");
      assert.deepStrictEqual(
        [pair.open.startCol, pair.open.endCol],
        [1, 7]
      );
    });
  });

  describe("findTagPair", () => {
    const text = doc(
      "[TEST STEPS]", // 0
      "  [STEP 1]", // 1
      "    x = 1", // 2
      "    [STEP DUMP/]", // 3
      "  [/STEP 1]", // 4
      "  [/STRAY]", // 5
      "  [UNCLOSED]", // 6
      "[/TEST STEPS]" // 7
    );

    it("finds the pair from the opening tag", () => {
      const pair = findTagPair(text, 1, 5);
      assert.ok(pair);
      assert.strictEqual(pair.cursorOn, "open");
      assert.strictEqual(pair.inName, true);
      assert.strictEqual(pair.name, "STEP 1");
      assert.deepStrictEqual(pair.open, {
        line: 1,
        startCol: 3,
        endCol: 9,
        tagStartCol: 2,
        tagEndCol: 10,
      });
      assert.deepStrictEqual(pair.close, {
        line: 4,
        startCol: 4,
        endCol: 10,
        tagStartCol: 2,
        tagEndCol: 11,
      });
    });

    it("finds the pair from the closing tag", () => {
      const pair = findTagPair(text, 7, 3);
      assert.ok(pair);
      assert.strictEqual(pair.cursorOn, "close");
      assert.strictEqual(pair.open.line, 0);
      assert.strictEqual(pair.close.line, 7);
    });

    it("counts both ends of the tag and of the name as on it", () => {
      assert.strictEqual(findTagPair(text, 1, 2)?.inName, false); // on `[`
      assert.strictEqual(findTagPair(text, 1, 3)?.inName, true); // name start
      assert.strictEqual(findTagPair(text, 1, 9)?.inName, true); // name end
      assert.strictEqual(findTagPair(text, 1, 10)?.inName, false); // after `]`
      assert.strictEqual(findTagPair(text, 4, 3)?.inName, false); // on `/`
      assert.strictEqual(findTagPair(text, 1, 1), undefined); // indentation
      assert.strictEqual(findTagPair(text, 1, 11), undefined); // past the line
    });

    it("yields nothing off a tag, on a one-liner, or on an unmatched tag", () => {
      assert.strictEqual(findTagPair(text, 2, 6), undefined);
      assert.strictEqual(findTagPair(text, 3, 8), undefined);
      assert.strictEqual(findTagPair(text, 5, 6), undefined);
      assert.strictEqual(findTagPair(text, 6, 6), undefined);
      assert.strictEqual(findTagPair(text, 99, 0), undefined);
      assert.strictEqual(findTagPair(text, -1, 0), undefined);
      assert.strictEqual(findTagPair("", 0, 0), undefined);
    });

    it("does not treat trailing junk after the tag as part of it", () => {
      const junk = doc("[A] junk here", "[/A]");
      assert.ok(findTagPair(junk, 0, 3));
      assert.strictEqual(findTagPair(junk, 0, 8), undefined);
    });
  });

  describe("findMatchingTag", () => {
    const text = doc(
      "# header", // 0
      "[TEST STEPS]", // 1
      "  [STEP 1]", // 2
      "    [STEP INPUTS]", // 3
      "      x = 1", // 4
      "    [/STEP INPUTS]", // 5
      "    [STEP DUMP/]", // 6
      "    y = 2", // 7
      "  [/STEP 1]", // 8
      "  [/STRAY]", // 9
      "[/TEST STEPS]", // 10
      "trailer" // 11
    );

    it("jumps open → close and close → open, to the name", () => {
      assert.deepStrictEqual(findMatchingTag(text, 2), {
        line: 8,
        character: 4,
        target: "close",
        name: "STEP 1",
      });
      assert.deepStrictEqual(findMatchingTag(text, 8), {
        line: 2,
        character: 3,
        target: "open",
        name: "STEP 1",
      });
      assert.strictEqual(findMatchingTagLine(text, 1), 10);
      assert.strictEqual(findMatchingTagLine(text, 10), 1);
    });

    it("jumps from inside a block to the innermost enclosing opener", () => {
      assert.strictEqual(findMatchingTagLine(text, 4), 3);
      assert.strictEqual(findMatchingTagLine(text, 7), 2);
      assert.strictEqual(findMatchingTag(text, 7)?.target, "open");
    });

    it("has no match for one-liners, stray closers or lines outside blocks", () => {
      assert.strictEqual(findMatchingTagLine(text, 6), -1);
      assert.strictEqual(findMatchingTagLine(text, 9), -1);
      assert.strictEqual(findMatchingTagLine(text, 0), -1);
      assert.strictEqual(findMatchingTagLine(text, 11), -1);
      assert.strictEqual(findMatchingTagLine(text, 50), -1);
      assert.strictEqual(findMatchingTagLine(text, -3), -1);
      assert.strictEqual(findMatchingTagLine("", 0), -1);
    });

    it("has no match for an opener that was never closed", () => {
      const open = doc("[A]", "[B]", "x = 1", "[/A]");
      assert.strictEqual(findMatchingTagLine(open, 1), -1);
      // A content line still resolves to the matched block around it.
      assert.strictEqual(findMatchingTagLine(open, 2), 0);
    });
  });

  describe("TAG_NAME_WORD_PATTERN", () => {
    const whole = (s: string): boolean => {
      const m = s.match(TAG_NAME_WORD_PATTERN);
      return (m ? m[0].length : 0) === s.length;
    };

    it("covers whole tag names, including spaces, digits and underscores", () => {
      for (const name of [
        "STEP 12",
        "TEST STEPS",
        "429_SOME_LABEL",
        "PART_p1_port.2",
        "VORILS1_X",
        "%NAME%",
      ]) {
        assert.ok(whole(name), name);
      }
    });

    it("stops at the characters that end or restructure a tag", () => {
      for (const s of ["A]", "A/", "[A", "A # c", "A\nB"]) {
        assert.ok(!whole(s), s);
      }
    });

    it("is stateless (no global/sticky flag)", () => {
      assert.strictEqual(TAG_NAME_WORD_PATTERN.global, false);
      assert.strictEqual(TAG_NAME_WORD_PATTERN.sticky, false);
    });
  });
});
