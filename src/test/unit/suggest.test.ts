import * as assert from "assert";
import {
  editDistance,
  rankSuggestions,
  suggest,
  suggestionThreshold,
} from "../../lib/suggest";

describe("suggest", () => {
  it("measures plain edits, transpositions and case-only differences", () => {
    assert.strictEqual(editDistance("Course", "Course"), 0);
    assert.strictEqual(editDistance("Course", "Coarse"), 1);
    assert.strictEqual(editDistance("Course", "Cours"), 1);
    assert.strictEqual(editDistance("Course", "Cuorse"), 1); // transposition
    assert.strictEqual(editDistance("course", "Course"), 0.5); // case only
    assert.strictEqual(editDistance("", "abc"), 3);
  });

  it("gives up early past the limit", () => {
    assert.strictEqual(editDistance("abcdef", "uvwxyz", 2), Infinity);
    assert.strictEqual(editDistance("a", "abcdef", 2), Infinity);
    assert.strictEqual(editDistance("abc", "abd", 1), 1);
  });

  it("scales the threshold with length but caps it", () => {
    assert.strictEqual(suggestionThreshold(2), 1);
    assert.strictEqual(suggestionThreshold(6), 2);
    assert.strictEqual(suggestionThreshold(40), 4);
  });

  it("ranks the closest first and prefers a case-only match", () => {
    assert.deepStrictEqual(
      suggest("course", ["Coarse", "Course", "Label1"]),
      ["Course", "Coarse"]
    );
  });

  it("returns nothing when no candidate is close", () => {
    assert.deepStrictEqual(suggest("NotAField", ["SDI", "Course", "Label1"]), []);
    assert.deepStrictEqual(suggest("", ["SDI"]), []);
  });

  it("caps the list, drops the input itself and duplicates", () => {
    const got = suggest("Label", ["Label1", "Label2", "Label3", "Label4", "Label", "Label1"]);
    assert.deepStrictEqual(got, ["Label1", "Label2", "Label3"]);
    assert.strictEqual(rankSuggestions("Label", ["Label1"], 5)[0].distance, 1);
  });

  it("breaks ties alphabetically so the order is stable", () => {
    assert.deepStrictEqual(suggest("input3", ["input2", "input1"]), ["input1", "input2"]);
  });
});
