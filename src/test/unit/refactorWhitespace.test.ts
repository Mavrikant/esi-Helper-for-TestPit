import * as assert from "assert";
import { refactorWhitespace } from "../../lib/refactorWhitespace";

describe("refactorWhitespace", () => {
  it("trims trailing whitespace from each line", () => {
    const input = "alpha   \nbeta\t\ngamma";
    assert.strictEqual(refactorWhitespace(input), "alpha\nbeta\ngamma");
  });

  it("converts tabs to four spaces by default", () => {
    const input = "if (x) {\n\treturn;\n}";
    assert.strictEqual(refactorWhitespace(input), "if (x) {\n    return;\n}");
  });

  it("converts tabs using a custom width", () => {
    assert.strictEqual(refactorWhitespace("\tx", 2), "  x");
  });

  it("handles consecutive tabs", () => {
    assert.strictEqual(refactorWhitespace("\t\tx"), "        x");
  });

  it("preserves leading whitespace and blank lines", () => {
    const input = "  keep\n\n  keep again";
    assert.strictEqual(refactorWhitespace(input), input);
  });

  it("returns empty string unchanged", () => {
    assert.strictEqual(refactorWhitespace(""), "");
  });
});
