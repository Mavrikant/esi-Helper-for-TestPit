import * as assert from "assert";
import { resolveContext } from "../../lib/esiContext";

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

  it("returns 'fieldName' on a blank line inside an open component block", () => {
    const text = ["[429_L100SelectedCourseBNR_input1]", "    ", "[/429_L100SelectedCourseBNR_input1]"].join("\n");
    const ctx = resolveContext(text, 1, 4);
    assert.strictEqual(ctx.kind, "fieldName");
    if (ctx.kind === "fieldName") {
      assert.strictEqual(ctx.messageName, "429_L100SelectedCourseBNR_input1");
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
    // [STEP 10] doesn't match a 429_/1553_/Discrete_/Mem_ prefix → no fieldName context
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
});
