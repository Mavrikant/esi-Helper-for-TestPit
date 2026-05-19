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

  it("treats <pre>/</pre> as a depth-affecting block: content one indent deeper, </pre> back to pre's level", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "<br/> step 1",
      "<br/> step 2",
      "</pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "        <br/> step 1",
      "        <br/> step 2",
      "    </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("re-aligns misaligned <pre> block content from the source", () => {
    // Mirrors the real-world Step Conditions screenshot: the `<br/>` and
    // `</pre>` lines were at random columns far to the right; the formatter
    // pulls them in to depth+1 / depth respectively.
    const input = [
      "[STEP 20]",
      "[STEP DEFINITION]",
      "Step Conditions = <pre>",
      "                                <br/> Go to 'vorIlsMbPerformFunction'",
      "                            </pre>",
      "Step Expected Results = <pre>",
      "                                    <br/> * Verify that inside the X is Y",
      "                                </pre>",
      "[/STEP DEFINITION]",
      "[/STEP 20]",
    ].join("\n");
    const expected = [
      "[STEP 20]",
      "    [STEP DEFINITION]",
      "        Step Conditions = <pre>",
      "            <br/> Go to 'vorIlsMbPerformFunction'",
      "        </pre>",
      "        Step Expected Results = <pre>",
      "            <br/> * Verify that inside the X is Y",
      "        </pre>",
      "    [/STEP DEFINITION]",
      "[/STEP 20]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("leaves a single-line <pre>foo</pre> alone (depth-neutral)", () => {
    const input = "[A]\ncond = <pre>foo</pre>\n[/A]";
    const expected = "[A]\n    cond = <pre>foo</pre>\n[/A]";
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

  it("recognizes </pre> with a trailing # comment as a pre closer", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "content",
      "</pre>   # end of pre",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "        content",
      "    </pre>   # end of pre",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("recognizes <pre> with a trailing # comment as a pre opener", () => {
    const input = [
      "[A]",
      "cond = <pre> # opener",
      "content",
      "</pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre> # opener",
      "        content",
      "    </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("treats bracket-tag-like lines inside a <pre> block as raw content", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "[STEP X]",
      "some content",
      "</pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "        [STEP X]",
      "        some content",
      "    </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("closes a <pre> when </pre> is preceded by content on the same line", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "foo",
      "content here </pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "        foo",
      "    content here </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("does not let an orphaned opening tag shift subsequent closers", () => {
    const input = [
      "[A]",
      "foo",
      "[StrayTag]",
      "bar",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    foo",
      "    [StrayTag]",
      "    bar",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("does not let an orphaned <pre> shift subsequent closers", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "content1",
      "content2",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre>",
      "    content1",
      "    content2",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("treats a mismatched closing tag as content (no pop)", () => {
    const input = [
      "[A]",
      "[B]",
      "foo",
      "[/C]",
      "bar",
      "[/B]",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    [B]",
      "        foo",
      "        [/C]",
      "        bar",
      "    [/B]",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("handles uppercase <PRE>/</PRE> the same as lowercase", () => {
    const input = [
      "[A]",
      "cond = <PRE>",
      "foo",
      "</PRE>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <PRE>",
      "        foo",
      "    </PRE>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("recognizes <pre> with attributes as a pre opener", () => {
    const input = [
      "[A]",
      "cond = <pre class=\"x\">",
      "foo",
      "</pre>",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    cond = <pre class=\"x\">",
      "        foo",
      "    </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("treats an orphan </pre> with no open <pre> as content", () => {
    const input = [
      "[A]",
      "foo",
      "</pre>",
      "bar",
      "[/A]",
    ].join("\n");
    const expected = [
      "[A]",
      "    foo",
      "    </pre>",
      "    bar",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("produces identical output for CRLF and LF input", () => {
    const lf = "[A]\nfoo\n[B]\nbar\n[/B]\n[/A]";
    const crlf = "[A]\r\nfoo\r\n[B]\r\nbar\r\n[/B]\r\n[/A]";
    assert.strictEqual(formatEsi(crlf), formatEsi(lf));
  });

  it("is idempotent on Bug 3 fixture (bracket-like content inside <pre>)", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "[STEP X]",
      "some content",
      "</pre>",
      "[/A]",
    ].join("\n");
    const once = formatEsi(input);
    const twice = formatEsi(once);
    assert.strictEqual(twice, once);
  });
});
