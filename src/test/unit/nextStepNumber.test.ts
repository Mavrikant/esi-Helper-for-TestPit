import * as assert from "assert";
import { nextStepNumber } from "../../lib/nextStepNumber";

/** Next number for a step typed at the `|` line (the marker line is the cursor line). */
function next(lines: string[]): string {
  const at = lines.indexOf("|");
  assert.notStrictEqual(at, -1, "test needs a | line");
  const clean = lines.map((l) => (l === "|" ? "" : l));
  return nextStepNumber(clean, at);
}

const step = (n: string): string[] => [`[STEP ${n}]`, `[/STEP ${n}]`];

describe("nextStepNumber", () => {
  it("starts at 10 (the renumber default) in a file with no numbered step", () => {
    assert.strictEqual(next(["[TEST STEPS]", "|", "[/TEST STEPS]"]), "10");
    assert.strictEqual(next(["[STEP GET_DUMP]", "[/STEP GET_DUMP]", "[STEP %N%]", "[/STEP %N%]", "|"]), "10");
  });

  it("continues with the gap the file uses", () => {
    assert.strictEqual(next([...step("10"), ...step("20"), "|"]), "30");
    assert.strictEqual(next([...step("1"), ...step("2"), ...step("3"), "|"]), "4");
    assert.strictEqual(next([...step("100"), ...step("200"), "|"]), "300");
  });

  it("takes the most frequent gap, ignoring one irregular jump", () => {
    assert.strictEqual(next([...step("10"), ...step("20"), ...step("30"), ...step("100"), "|"]), "110");
  });

  it("reads a single step's own number as the gap", () => {
    assert.strictEqual(next([...step("10"), "|"]), "20");
    assert.strictEqual(next([...step("1"), "|"]), "2");
    assert.strictEqual(next([...step("0"), "|"]), "10");
  });

  it("fits a step typed between two others", () => {
    // 10 + 10 would collide with 20: half-way instead.
    assert.strictEqual(next([...step("10"), "|", ...step("20"), ...step("30")]), "15");
    // Room for the regular gap.
    assert.strictEqual(next([...step("10"), "|", ...step("30"), ...step("40"), ...step("50")]), "20");
    // No free number between the neighbours: past the highest, never a duplicate.
    assert.strictEqual(next([...step("1"), "|", ...step("2"), ...step("3")]), "4");
  });

  it("numbers a step typed before the first one", () => {
    assert.strictEqual(next(["|", ...step("20"), ...step("30")]), "10");
    // 10 - 10 is not a step number: past the highest.
    assert.strictEqual(next(["|", ...step("10"), ...step("20")]), "30");
  });

  it("never proposes a number already in the file", () => {
    assert.strictEqual(next([...step("10"), ...step("30"), ...step("20"), "|"]), "40");
  });

  it("keeps zero padding", () => {
    assert.strictEqual(next([...step("001"), ...step("002"), "|"]), "003");
    assert.strictEqual(next([...step("010"), ...step("020"), "|"]), "030");
    assert.strictEqual(next([...step("10"), ...step("100"), "|"]), "190");
  });

  it("counts one-liners and repaired tags, not closers or the cursor line", () => {
    assert.strictEqual(next(["[STEP 10/]", "[[STEP 20]]", "[/STEP 20]", "|"]), "30");
    assert.strictEqual(nextStepNumber(["[STEP 10]", "[/STEP 10]", "[STEP 2"], 2), "20");
    assert.strictEqual(next(["[/STEP 70]", "|"]), "10");
  });

  it("handles CRLF-split and tab-indented lines", () => {
    const lines = "[TEST STEPS]\r\n\t[STEP 5]\r\n\t[/STEP 5]\r\n\t\r\n[/TEST STEPS]".split(/\r?\n/);
    assert.strictEqual(nextStepNumber(lines, 3), "10");
  });
});
