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

  it("treats <pre>/</pre> as a column-anchored block: content one indent right of <pre>, </pre> aligned with <pre>", () => {
    const input = [
      "[A]",
      "cond = <pre>",
      "<br/> step 1",
      "<br/> step 2",
      "</pre>",
      "[/A]",
    ].join("\n");
    // `<pre>` lands at col 11 in `    cond = <pre>` (4 indent + "cond = " = 11).
    // Content -> col 15 (one indent right). `</pre>` -> col 11.
    const expected = [
      "[A]",
      "    cond = <pre>",
      "               <br/> step 1",
      "               <br/> step 2",
      "           </pre>",
      "[/A]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("re-aligns misaligned <pre> block content to col(<pre>)+indent / col(<pre>)", () => {
    // Both <pre> openers align to the widest key ("Step Expected Results", 21);
    // each <pre> body then follows its aligned <pre> (content at preCol+4,
    // </pre> at preCol), keeping the body text as authored.
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
    const I = (n: number): string => " ".repeat(n);
    const W = 21;
    const eq = (name: string, val: string): string =>
      I(8) + name + I(W - name.length + 1) + "= " + val;
    const br = (s: string): string => I(36) + s; // <pre> at col 32, content +4
    const closePre = I(32) + "</pre>";
    const expected = [
      "[STEP 20]",
      I(4) + "[STEP DEFINITION]",
      eq("Step Conditions", "<pre>"),
      br("<br/> Go to 'vorIlsMbPerformFunction'"),
      closePre,
      eq("Step Expected Results", "<pre>"),
      br("<br/> * Verify that inside the X is Y"),
      closePre,
      I(4) + "[/STEP DEFINITION]",
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
      "        time   = 5600",
      "        SDI    = INSTALLATION_NUMBER_ONE",
      "        Course = 179.6484375",
      "    [/429_L100SelectedCourseBNR_input1]",
      "[/STEP INPUTS]",
    ].join("\n");
    // '=' signs are aligned to the widest field name (Course) in the block.
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
    // `<pre>` at col 11 in `    cond = <pre>`; content -> col 15, </pre> -> col 11.
    const expected = [
      "[A]",
      "    cond = <pre>",
      "               content",
      "           </pre>   # end of pre",
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
      "               content",
      "           </pre>",
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
      "               [STEP X]",
      "               some content",
      "           </pre>",
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
      "               foo",
      "           content here </pre>",
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
      "               foo",
      "           </PRE>",
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
      "               foo",
      "           </pre>",
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

  it("handles [BRACKET_LHS] = <pre> blocks (column-anchored: <br/> at col(<pre>)+indent, </pre> at col(<pre>))", () => {
    const input = [
      "[STEP 30]",
      "[STEP DEFINITION]",
      "[FOO_BAR_input1] = <pre>",
      "<br/> first line",
      "<br/> second line",
      "</pre>",
      "[/STEP DEFINITION]",
      "[/STEP 30]",
    ].join("\n");
    // "[FOO_BAR_input1] = " is 19 chars, opener renders at col 8 (depth 2) =>
    // `<pre>` lands at col 27, content at col 31, `</pre>` at col 27.
    const expected = [
      "[STEP 30]",
      "    [STEP DEFINITION]",
      "        [FOO_BAR_input1] = <pre>",
      "                               <br/> first line",
      "                               <br/> second line",
      "                           </pre>",
      "    [/STEP DEFINITION]",
      "[/STEP 30]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("re-aligns misaligned [BRACKET_LHS] = <pre> content", () => {
    const input = [
      "[STEP 40]",
      "[FOO_BAR_input1] = <pre>",
      "                <br/> wildly indented",
      "        </pre>",
      "[/STEP 40]",
    ].join("\n");
    // opener renders at col 4 (depth 1) => `<pre>` at col 23 (4 + 19),
    // content at col 27, `</pre>` at col 23.
    const expected = [
      "[STEP 40]",
      "    [FOO_BAR_input1] = <pre>",
      "                           <br/> wildly indented",
      "                       </pre>",
      "[/STEP 40]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("handles <pre> with inline trailing content (content lines and </pre> anchor to col(<pre>))", () => {
    // User's real-world case: opener has text after `<pre>` on the same line.
    // Because the "first" content piece is already inline with `<pre>`,
    // subsequent <br/> lines stay at col(<pre>), not col(<pre>)+indent.
    //   "            Step Expected Results = <pre> Following ..."  (col 36 for <pre>)
    //   "                                    <br/> ..."            (col 36 — same)
    //   "                                    </pre>"               (col 36)
    const input = [
      "[TEST]",
      "[STEP 10]",
      "[STEP DEFINITION]",
      "Step Expected Results = <pre> Following results are obtained:",
      "<br/> * The maintenance logs not contains IBIT errors of VORILSMB_VORLOC_BIT_ERROR, VORILSMB_GS_BIT_ERROR",
      "<br/> * The maintenance logs contains IBIT errors of VORILSMB_MB_BIT_ERROR",
      "</pre>",
      "[/STEP DEFINITION]",
      "[/STEP 10]",
      "[/TEST]",
    ].join("\n");
    const expected = [
      "[TEST]",
      "    [STEP 10]",
      "        [STEP DEFINITION]",
      "            Step Expected Results = <pre> Following results are obtained:",
      "                                    <br/> * The maintenance logs not contains IBIT errors of VORILSMB_VORLOC_BIT_ERROR, VORILSMB_GS_BIT_ERROR",
      "                                    <br/> * The maintenance logs contains IBIT errors of VORILSMB_MB_BIT_ERROR",
      "                                    </pre>",
      "        [/STEP DEFINITION]",
      "    [/STEP 10]",
      "[/TEST]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("matches the user's Step Conditions / Step Expected Results example (column-anchored <pre>)", () => {
    // Lifted from the user's real-world report: two sibling `<pre>` blocks at
    // depth 3 with different LHS lengths must independently anchor their `<br/>`
    // content and `</pre>` closers to col(<pre>)+indent and col(<pre>).
    //   "Step Conditions = "       18 chars -> <pre> at col 30, <br/> at 34, </pre> at 30
    //   "Step Expected Results = " 24 chars -> <pre> at col 36, <br/> at 40, </pre> at 36
    const input = [
      "[TEST]",
      "[STEP 10]",
      "[STEP DEFINITION]",
      "Step Description = Verify reading ground station binary values from hardware - SW_LLR_VORILS_VORILSMB_128",
      "Step Requirements = SW_LLR_VORILS_VORILSMB_128, SW_LLR_VORILS_VORILSMB_288",
      "Step Dependencies = N/A",
      "Step Conditions = <pre>",
      "<br/> Scenario: VORLOCFunctionMode is FUNCTION_MODE_ACTIVE",
      "<br/> * Set DD.VORILSMBOutput.VORLOCFunctionMode to FUNCTION_MODE_ACTIVE",
      "<br/> * Set HSI.Read.VORLOCGroundStationID1 to test value (0x12345678)",
      "<br/> * Set HSI.Read.VORLOCGroundStationID2 to test value (0x9ABCDEF0)",
      "<br/> * Tune to VOR frequency 108.00 MHz",
      "</pre>",
      "Step Expected Results = <pre>",
      "<br/> * GroundStationBinaryValue is constructed from HSI.Read values",
      "<br/> * First 32 bits = HSI.Read.VORLOCGroundStationID1",
      "<br/> * Last 32 bits = HSI.Read.VORLOCGroundStationID2",
      "<br/> * System reads hardware registers correctly",
      "</pre>",
      "[/STEP DEFINITION]",
      "[/STEP 10]",
      "[/TEST]",
    ].join("\n");
    // All section keys — including the two `<pre>` openers — align their `=`
    // to the widest key ("Step Expected Results", 21). Each <pre> body then
    // follows its aligned `<pre>` (content at preCol+4, </pre> at preCol).
    const I = (n: number): string => " ".repeat(n);
    const W = 21;
    const eq = (name: string, val: string): string =>
      I(12) + name + I(W - name.length + 1) + "= " + val;
    const br = (s: string): string => I(40) + s; // <pre> at col 36, content +4
    const closePre = I(36) + "</pre>";
    const expected = [
      "[TEST]",
      I(4) + "[STEP 10]",
      I(8) + "[STEP DEFINITION]",
      eq(
        "Step Description",
        "Verify reading ground station binary values from hardware - SW_LLR_VORILS_VORILSMB_128"
      ),
      eq(
        "Step Requirements",
        "SW_LLR_VORILS_VORILSMB_128, SW_LLR_VORILS_VORILSMB_288"
      ),
      eq("Step Dependencies", "N/A"),
      eq("Step Conditions", "<pre>"),
      br("<br/> Scenario: VORLOCFunctionMode is FUNCTION_MODE_ACTIVE"),
      br("<br/> * Set DD.VORILSMBOutput.VORLOCFunctionMode to FUNCTION_MODE_ACTIVE"),
      br("<br/> * Set HSI.Read.VORLOCGroundStationID1 to test value (0x12345678)"),
      br("<br/> * Set HSI.Read.VORLOCGroundStationID2 to test value (0x9ABCDEF0)"),
      br("<br/> * Tune to VOR frequency 108.00 MHz"),
      closePre,
      eq("Step Expected Results", "<pre>"),
      br("<br/> * GroundStationBinaryValue is constructed from HSI.Read values"),
      br("<br/> * First 32 bits = HSI.Read.VORLOCGroundStationID1"),
      br("<br/> * Last 32 bits = HSI.Read.VORLOCGroundStationID2"),
      br("<br/> * System reads hardware registers correctly"),
      closePre,
      I(8) + "[/STEP DEFINITION]",
      I(4) + "[/STEP 10]",
      "[/TEST]",
    ].join("\n");
    assert.strictEqual(formatEsi(input), expected);
  });

  it("aligns a <pre> opener with sibling keys and shifts its body to follow", () => {
    const input = [
      "[STEP DEFINITION]",
      "Step Requirements = X",
      "Step Conditions = <pre>",
      "<br/> do thing",
      "</pre>",
      "[/STEP DEFINITION]",
    ].join("\n");
    const lines = formatEsi(input).split("\n");
    const reqEq = lines.find((l) => l.includes("Step Requirements"))!.indexOf("=");
    const condEq = lines.find((l) => l.includes("Step Conditions"))!.indexOf("=");
    // Both align to "Step Requirements" (17); indent 4 → '=' at col 22.
    assert.strictEqual(reqEq, condEq);
    assert.strictEqual(condEq, 4 + 17 + 1);
    const preCol = condEq + 2; // "= <pre>" → <pre> two cols after '='
    // Body follows the aligned <pre>: content at preCol+4, </pre> at preCol.
    assert.ok(lines.includes(" ".repeat(preCol + 4) + "<br/> do thing"));
    assert.ok(lines.includes(" ".repeat(preCol) + "</pre>"));
  });

  it("aligns '=' of field assignments within a component block to one column", () => {
    const input = [
      "[STEP INPUTS]",
      "[ED_Type1]",
      "time = a",
      "flight_id = b",
      "type_code = c",
      "aircraft_category = d",
      "[/ED_Type1]",
      "[/STEP INPUTS]",
    ].join("\n");
    const lines = formatEsi(input).split("\n");
    const fieldLines = lines.filter((l) => /=/.test(l) && /^\s+[A-Za-z_]/.test(l));
    const eqCols = fieldLines.map((l) => l.indexOf("="));
    // All '=' aligned to a single column = indent(8) + widest name(17) + 1.
    assert.strictEqual(new Set(eqCols).size, 1);
    assert.strictEqual(eqCols[0], 8 + 17 + 1);
    // The widest field keeps exactly one space before '='.
    assert.ok(lines.includes("        aircraft_category = d"));
  });

  it("aligns each component block independently", () => {
    const input = [
      "[ED_A]",
      "x = 1",
      "longname = 2",
      "[/ED_A]",
      "[ED_B]",
      "p = 3",
      "[/ED_B]",
    ].join("\n");
    const lines = formatEsi(input).split("\n");
    // Block A aligns to 'longname' (8); block B has only 'p'.
    assert.ok(lines.includes("    x        = 1"));
    assert.ok(lines.includes("    longname = 2"));
    assert.ok(lines.includes("    p = 3"));
  });

  it("aligns '=' inside definition sections (multi-word keys), to the widest key", () => {
    const input = [
      "[STEP DEFINITION]",
      "Step Description = foo",
      "Step Requirements = bar",
      "Step Dependencies = baz",
      "[/STEP DEFINITION]",
    ].join("\n");
    const lines = formatEsi(input).split("\n");
    const fieldLines = lines.filter((l) => /^\s+Step/.test(l));
    const eqCols = fieldLines.map((l) => l.indexOf("="));
    assert.strictEqual(new Set(eqCols).size, 1);
    // widest = "Step Requirements"/"Step Dependencies" (17); indent 4.
    assert.strictEqual(eqCols[0], 4 + 17 + 1);
    // "Step Description" (16) gets two spaces before '='.
    assert.ok(lines.includes("    Step Description  = foo"));
  });

  it("converts tabs to spaces and then aligns the component block", () => {
    const input = ["[ED_Type1]", "\ttime\t= 1", "\tflight_id\t= 2", "[/ED_Type1]"].join(
      "\n"
    );
    const lines = formatEsi(input).split("\n");
    assert.ok(!lines.some((l) => l.includes("\t")));
    const fieldLines = lines.filter((l) => /=/.test(l) && /^\s+[A-Za-z_]/.test(l));
    const eqCols = fieldLines.map((l) => l.indexOf("="));
    assert.strictEqual(new Set(eqCols).size, 1);
  });

  it("keeps a hanging multi-line value continuation as authored (no reflow)", () => {
    const input = [
      "[STEP DEFINITION]",
      "Step Description = line one",
      "          hanging continuation under the value",
      "Step Dependencies = None",
      "[/STEP DEFINITION]",
    ].join("\n");
    const lines = formatEsi(input).split("\n");
    // Indented MORE than its key, so preserved verbatim (10-space indent kept),
    // not re-indented to the block depth or reflowed to the value column.
    assert.ok(lines.includes("          hanging continuation under the value"));
  });

  it("re-indents non-hanging content after a key (not a continuation)", () => {
    // 'baz' is at the same indent as 'foo', so it's ordinary content, not a
    // hanging continuation — it gets re-indented to depth.
    const input = "[A]\nfoo = [bar]\nbaz\n[/A]";
    assert.strictEqual(formatEsi(input), "[A]\n    foo = [bar]\n    baz\n[/A]");
  });

  it("tier scope aligns same-depth blocks together; section scope does not", () => {
    const input = [
      "[STEP INPUTS]",
      "[ED_A]",
      "x = 1",
      "[/ED_A]",
      "[ED_B]",
      "longerkey = 2",
      "[/ED_B]",
      "[/STEP INPUTS]",
    ].join("\n");
    const sec = formatEsi(input, { alignScope: "section" }).split("\n");
    const tier = formatEsi(input, { alignScope: "tier" }).split("\n");
    const eqCol = (arr: string[], needle: string): number =>
      (arr.find((l) => l.includes(needle)) as string).indexOf("=");
    // Section: 'x' aligns to its own block (just 'x', width 1) at indent 8.
    assert.strictEqual(eqCol(sec, "x ="), 8 + 1 + 1);
    // Tier: both depth-2 blocks align to 'longerkey' (width 9) at indent 8.
    assert.strictEqual(eqCol(tier, "x "), 8 + 9 + 1);
    assert.strictEqual(eqCol(tier, "longerkey "), 8 + 9 + 1);
  });
});
