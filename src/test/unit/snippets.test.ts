import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { formatEsi } from "../../lib/formatEsi";

const SNIPPETS_FILE = path.resolve(__dirname, "..", "..", "..", "snippets.json");

interface Snippet {
  prefix: string;
  body: string[];
  description: string;
}

describe("snippets.json", () => {
  const snippets = JSON.parse(
    fs.readFileSync(SNIPPETS_FILE, "utf-8")
  ) as Record<string, Snippet>;

  it("is non-empty valid JSON", () => {
    assert.ok(Object.keys(snippets).length > 0);
  });

  for (const [name, snippet] of Object.entries(snippets)) {
    // A snippet the formatter would immediately rewrite is a snippet that
    // fights format-on-save. Expand each tabstop to typed text first: an empty
    // tabstop line is whitespace-only, which the formatter rightly trims.
    it(`"${name}" body is already formatter-clean`, () => {
      const expanded = snippet.body.join("\n").replace(/\$\d+/g, "x");
      assert.strictEqual(formatEsi(expanded).replace(/\n+$/, ""), expanded);
    });

    it(`"${name}" description has no "definiton" typo`, () => {
      assert.doesNotMatch(snippet.description, /definiton/i);
    });
  }
});
