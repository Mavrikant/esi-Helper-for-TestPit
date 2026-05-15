import * as assert from "assert";
import { parseValidityOutput } from "../../lib/parseValidityOutput";

describe("parseValidityOutput", () => {
  const docLines = [
    "  first line content",
    "second line",
    "    indented third",
    "fourth",
    "fifth",
  ];

  it("returns no issues when output is empty", () => {
    assert.deepStrictEqual(parseValidityOutput("", docLines), []);
  });

  it("returns no issues when output has no matching lines", () => {
    const out = "some unrelated text\n[Info] just informational";
    assert.deepStrictEqual(parseValidityOutput(out, docLines), []);
  });

  it("parses a single Error issue with Line:", () => {
    const out = "[Error] something is broken Line: 2";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].lineNumber, 1);
    assert.strictEqual(result[0].severity, "error");
    assert.strictEqual(result[0].startCol, 0);
    assert.strictEqual(result[0].endCol, "second line".length);
  });

  it("parses Warn. severity", () => {
    const out = "[Warn.] careful Line(s): 1";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].severity, "warning");
  });

  it("parses Fatal as error", () => {
    const out = "[Fatal] kaboom Line: 3";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result[0].severity, "error");
  });

  it("uses 0-indexed line numbers", () => {
    const out = "[Error] x Line: 1\n[Error] y Line: 5";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result[0].lineNumber, 0);
    assert.strictEqual(result[1].lineNumber, 4);
  });

  it("clamps line numbers past the document end to the last line", () => {
    const out = "[Error] off the end Line: 9999";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result[0].lineNumber, docLines.length - 1);
  });

  it("computes startCol from the first non-whitespace character", () => {
    const out = "[Error] x Line: 3";
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result[0].startCol, "    ".length);
  });

  it("ignores lines that match severity but lack a line number", () => {
    const out = "[Error] no number here";
    assert.deepStrictEqual(parseValidityOutput(out, docLines), []);
  });

  it("returns no issues when the document is empty", () => {
    const out = "[Error] x Line: 1";
    assert.deepStrictEqual(parseValidityOutput(out, []), []);
  });

  it("parses multiple issues across the output", () => {
    const out = [
      "[Error] first issue Line: 1",
      "noise",
      "[Warn.] second issue Line(s): 4",
    ].join("\n");
    const result = parseValidityOutput(out, docLines);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].severity, "error");
    assert.strictEqual(result[1].severity, "warning");
    assert.strictEqual(result[1].lineNumber, 3);
  });
});
