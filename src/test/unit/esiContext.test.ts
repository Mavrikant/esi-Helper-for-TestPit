import * as assert from "assert";
import { findEnclosingBlock, resolveContext } from "../../lib/esiContext";

describe("esiContext.resolveContext", () => {
  it("returns 'other' for an empty document", () => {
    assert.strictEqual(resolveContext("", 0, 0).kind, "other");
  });

  it("returns 'tagName' when the cursor is inside an open [", () => {
    // line: "[429_L100Sel|"   cursor right after the partial
    const text = "[429_L100Sel";
    const ctx = resolveContext(text, 0, 12);
    assert.strictEqual(ctx.kind, "tagName");
    if (ctx.kind === "tagName") {
      assert.strictEqual(ctx.partial, "429_L100Sel");
    }
  });

  it("does not return 'tagName' when the cursor is past the closing ]", () => {
    const text = "[429_L100SelectedCourseBNR_input1]";
    const ctx = resolveContext(text, 0, text.length);
    assert.notStrictEqual(ctx.kind, "tagName");
  });

  it("does not treat a closing-tag start [/ as a completion target", () => {
    const text = "[/429_";
    const ctx = resolveContext(text, 0, 6);
    assert.notStrictEqual(ctx.kind, "tagName");
  });

  it("returns 'closeTagName' with the text after [/ as the partial", () => {
    const ctx = resolveContext("    [/STEP IN", 0, 13);
    assert.deepStrictEqual(ctx, { kind: "closeTagName", partial: "STEP IN" });
    assert.deepStrictEqual(resolveContext("[/]", 0, 2), {
      kind: "closeTagName",
      partial: "",
    });
  });

  it("is not 'closeTagName' once the cursor is past the closing ]", () => {
    const text = ["[429_A]", "    time = 1", "[/429_A]"].join("\n");
    assert.notStrictEqual(resolveContext(text, 2, 8).kind, "closeTagName");
  });

  it("still resolves the enclosing message across earlier closed blocks", () => {
    // Regression guard for the closer walk in findEnclosingMessage.
    const text = [
      "[429_A]",
      "    time = 1",
      "[/429_A]",
      "[429_B]",
      "    ",
      "[/429_B]",
    ].join("\r\n");
    const ctx = resolveContext(text, 4, 4);
    assert.deepStrictEqual(ctx, { kind: "fieldName", messageName: "429_B" });
  });

  it("returns 'fieldName' on a blank line inside an open component block", () => {
    const text = ["[429_L100SelectedCourseBNR_input1]", "    ", "[/429_L100SelectedCourseBNR_input1]"].join("\n");
    const ctx = resolveContext(text, 1, 4);
    assert.strictEqual(ctx.kind, "fieldName");
    if (ctx.kind === "fieldName") {
      assert.strictEqual(ctx.messageName, "429_L100SelectedCourseBNR_input1");
    }
  });

  it("returns 'fieldValue' for dotted field names (Mode.SelectedCourse)", () => {
    const text = [
      "[1553_VORILSOutput]",
      "    Mode.SelectedCourse = ",
      "[/1553_VORILSOutput]",
    ].join("\n");
    const ctx = resolveContext(text, 1, "    Mode.SelectedCourse = ".length);
    assert.strictEqual(ctx.kind, "fieldValue");
    if (ctx.kind === "fieldValue") {
      assert.strictEqual(ctx.fieldName, "Mode.SelectedCourse");
    }
  });

  it("returns 'fieldValue' on the RHS of an = inside an open component block", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = ",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    const ctx = resolveContext(text, 1, "    SDI = ".length);
    assert.strictEqual(ctx.kind, "fieldValue");
    if (ctx.kind === "fieldValue") {
      assert.strictEqual(ctx.messageName, "429_L100SelectedCourseBNR_input1");
      assert.strictEqual(ctx.fieldName, "SDI");
    }
  });

  it("returns 'variableRef' after a % character", () => {
    const text = "value = %";
    const ctx = resolveContext(text, 0, text.length);
    assert.strictEqual(ctx.kind, "variableRef");
  });

  it("returns 'variableRef' with the partial typed so far", () => {
    const text = "value = %TIM";
    const ctx = resolveContext(text, 0, text.length);
    assert.strictEqual(ctx.kind, "variableRef");
    if (ctx.kind === "variableRef") {
      assert.strictEqual(ctx.partial, "TIM");
    }
  });

  it("ignores non-component enclosing tags like [STEP 10]", () => {
    // [STEP 10] doesn't match a 429_/1553_/DIS_/Mem_ prefix → no fieldName context
    const text = ["[STEP 10]", "    ", "[/STEP 10]"].join("\n");
    const ctx = resolveContext(text, 1, 4);
    assert.strictEqual(ctx.kind, "other");
  });

  it("picks the innermost component when nested", () => {
    const text = [
      "[STEP 10]",
      "    [STEP INPUTS]",
      "        [429_L100SelectedCourseBNR_input1]",
      "            ",
      "        [/429_L100SelectedCourseBNR_input1]",
      "    [/STEP INPUTS]",
      "[/STEP 10]",
    ].join("\n");
    const ctx = resolveContext(text, 3, 12);
    assert.strictEqual(ctx.kind, "fieldName");
    if (ctx.kind === "fieldName") {
      assert.strictEqual(ctx.messageName, "429_L100SelectedCourseBNR_input1");
    }
  });

  it("returns 'other' outside of any block", () => {
    const text = "just some text";
    assert.strictEqual(resolveContext(text, 0, 5).kind, "other");
  });

  it("returns 'other' for an out-of-range lineIndex", () => {
    const text = "single line";
    assert.strictEqual(resolveContext(text, 99, 0).kind, "other");
    assert.strictEqual(resolveContext(text, -1, 0).kind, "other");
  });

  it("does not pick up a non-component tag on the same line as the cursor", () => {
    // [STEP 10] is on line 0, cursor is on line 0 — but [STEP 10] isn't a
    // component tag, so it shouldn't be returned as the enclosing message.
    const text = "[STEP 10]\n";
    assert.strictEqual(resolveContext(text, 0, 9).kind, "other");
  });

  describe("findEnclosingBlock (tag grammar from parseSectionTag)", () => {
    it("returns the block's name and opening line", () => {
      const lines = ["[STEP INPUTS]", "  [429_A]", "    time = 1", "  [/429_A]", "[/STEP INPUTS]"];
      assert.deepStrictEqual(findEnclosingBlock(lines, 2), { name: "429_A", line: 1 });
      assert.strictEqual(findEnclosingBlock(lines, 4), undefined);
    });

    it("is never enclosed by a one-liner", () => {
      const lines = ["[429_A/]", "    "];
      assert.strictEqual(findEnclosingBlock(lines, 1), undefined);
      assert.strictEqual(resolveContext(lines.join("\n"), 1, 4).kind, "other");
      // …and a one-liner inside a block does not hide the block.
      assert.deepStrictEqual(findEnclosingBlock(["[429_A]", "[DIS_X/]", ""], 2), { name: "429_A", line: 0 });
    });

    it("reads the sloppy forms TestPit repairs", () => {
      assert.deepStrictEqual(findEnclosingBlock(["[[429_A]]", ""], 1), { name: "429_A", line: 0 });
      assert.deepStrictEqual(findEnclosingBlock(["[429_A] junk", ""], 1), { name: "429_A", line: 0 });
      assert.strictEqual(findEnclosingBlock(["[429_A]", "[//429_A]", ""], 2), undefined);
    });

    it("ignores a tag inside a comment or in the middle of a line", () => {
      assert.strictEqual(findEnclosingBlock(["# [429_A]", ""], 1), undefined);
      assert.deepStrictEqual(findEnclosingBlock(["[429_A]", "  x = 1 # [/429_A]", ""], 2), {
        name: "429_A",
        line: 0,
      });
    });

    it("pairs each close with one opener of the same name", () => {
      const lines = ["[429_A]", "[429_A]", "[/429_A]", ""];
      assert.deepStrictEqual(findEnclosingBlock(lines, 3), { name: "429_A", line: 0 });
    });

    it("walks past structural sections to the component above", () => {
      assert.deepStrictEqual(findEnclosingBlock(["[429_A]", "[NOTES]", ""], 2), { name: "429_A", line: 0 });
    });
  });
});
