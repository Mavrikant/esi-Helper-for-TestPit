import * as assert from "assert";
import { formatEsi } from "../../lib/formatEsi";

describe("formatEsi", () => {
  it("returns empty string unchanged", () => {
    assert.strictEqual(formatEsi(""), "");
  });

  it("indents content of a single block by 4 spaces", () => {
    const input = "[STEP 10]\nfoo\nbar\n[/STEP 10]";
    const expected = "[STEP 10]\n    foo\n    bar\n[/STEP 10]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("indents nested blocks cumulatively", () => {
    const input = [
      "[STEP 10]",
      "[STEP INPUTS]",
      "foo",
      "[/STEP INPUTS]",
      "[/STEP 10]",
    ].join("\n");
    const expected = [
      "[STEP 10]",
      "    [STEP INPUTS]",
      "        foo",
      "    [/STEP INPUTS]",
      "[/STEP 10]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("handles two sibling blocks at the same depth", () => {
    const input = [
      "[STEP 10]",
      "[STEP INPUTS]",
      "a",
      "[/STEP INPUTS]",
      "[STEP OUTPUTS]",
      "b",
      "[/STEP OUTPUTS]",
      "[/STEP 10]",
    ].join("\n");
    const expected = [
      "[STEP 10]",
      "    [STEP INPUTS]",
      "        a",
      "    [/STEP INPUTS]",
      "    [STEP OUTPUTS]",
      "        b",
      "    [/STEP OUTPUTS]",
      "[/STEP 10]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("preserves empty lines (no spaces injected)", () => {
    const input = "[A]\n\nfoo\n\n[/A]";
    const expected = "[A]\n\n    foo\n\n[/A]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("normalizes pre-existing wrong indentation", () => {
    const input = "[A]\n  foo\n            bar\n[/A]";
    const expected = "[A]\n    foo\n    bar\n[/A]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("does not underflow when a closing tag has no matching opening", () => {
    const input = "[/A]\n[B]\nfoo\n[/B]";
    const expected = "[/A]\n[B]\n    foo\n[/B]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("preserves <pre> block contents verbatim (no re-indent inside)", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "          some manually aligned text",
      "          <br/> more",
      "       </pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "          some manually aligned text",
      "          <br/> more",
      "       </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("treats inline `[name] = value` lines as content (no depth change)", () => {
    // mid-line tags don't affect depth — only lines that ARE just a tag do.
    const input = "[A]\nfoo = [bar]\nbaz\n[/A]";
    const expected = "[A]\n    foo = [bar]\n    baz\n[/A]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("still trims trailing whitespace and converts tabs to four spaces", () => {
    const input = "[A]\n\tfoo   \n[/A]";
    const expected = "[A]\n    foo\n[/A]";
    assert.strictEqual(formatEsi(input), expected);
  });

  it("is idempotent on already-correctly-indented input", () => {
    const input = "[A]\n    [B]\n        foo\n    [/B]\n[/A]";
    assert.strictEqual(formatEsi(input), input);
  });

  it("treats a tag with a trailing # comment as a tag (depth still increments)", () => {
    const input = [
      "[STEP INPUTS]",
      "[429_L100SelectedCourseBNR_input1]          # Scenario 1",
      "time = 5600",
      "SDI = INSTALLATION_NUMBER_ONE",
      "Course = 179.6484375",
      "[/429_L100SelectedCourseBNR_input1]",
      "[/STEP INPUTS]",
    ].join("\n");
    const expected = [
      "[STEP INPUTS]",
      "    [429_L100SelectedCourseBNR_input1]          # Scenario 1",
      "        time = 5600",
      "        SDI = INSTALLATION_NUMBER_ONE",
      "        Course = 179.6484375",
      "    [/429_L100SelectedCourseBNR_input1]",
      "[/STEP INPUTS]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("recognizes a closing tag with a trailing # comment", () => {
    const input = "[A]\nfoo\n[/A]   # done";
    const expected = "[A]\n    foo\n[/A]   # done";
    assert.strictEqual(formatEsi(input), expected);
  });
});
