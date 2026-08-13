import * as assert from "assert";
import { parseSectionTagLine } from "../../lib/parseSectionTag";

// The expectations below are taken from TestPit's own reader
// (ScriptParser.cpp readSection + checkTagName) and from the regression case
// that pins the tolerated forms, TRT/Scripts/Validation/val_test_tag_recovery_pass.esi.
describe("parseSectionTag", () => {
  it("reads a plain opening tag", () => {
    const t = parseSectionTagLine("[STEP INPUTS]");
    assert.ok(t);
    assert.strictEqual(t.kind, "open");
    assert.strictEqual(t.name, "STEP INPUTS");
    assert.strictEqual(t.invalid, false);
    assert.strictEqual(t.repaired, false);
  });

  it("reads a plain closing tag", () => {
    const t = parseSectionTagLine("[/STEP INPUTS]");
    assert.ok(t);
    assert.strictEqual(t.kind, "close");
    assert.strictEqual(t.name, "STEP INPUTS");
  });

  it("reads the one-liner form [NAME/] and keeps the slash out of the name", () => {
    const t = parseSectionTagLine("[STEP DUMP/]");
    assert.ok(t);
    assert.strictEqual(t.kind, "oneLiner");
    assert.strictEqual(t.name, "STEP DUMP");
    assert.strictEqual(t.invalid, false);
  });

  it("reads an indented one-liner and reports the bracket columns", () => {
    const t = parseSectionTagLine("    [UnusedOneLiner/]");
    assert.ok(t);
    assert.strictEqual(t.kind, "oneLiner");
    assert.strictEqual(t.name, "UnusedOneLiner");
    assert.strictEqual(t.startCol, 4);
    assert.strictEqual(t.endCol, "    [UnusedOneLiner/]".length);
  });

  it("reads a one-liner component tag", () => {
    const t = parseSectionTagLine("[429_MSG/]");
    assert.ok(t);
    assert.strictEqual(t.kind, "oneLiner");
    assert.strictEqual(t.name, "429_MSG");
  });

  it("keeps a trailing comment out of the name", () => {
    const t = parseSectionTagLine("[STEP 10]  # first step");
    assert.ok(t);
    assert.strictEqual(t.kind, "open");
    assert.strictEqual(t.name, "STEP 10");
  });

  // --- the forms TestPit repairs with a warning ---

  it("strips repeated braces on an opener ([[NAME]])", () => {
    const t = parseSectionTagLine("[[ED_Nums]]");
    assert.ok(t);
    assert.strictEqual(t.kind, "open");
    assert.strictEqual(t.name, "ED_Nums");
    assert.strictEqual(t.repaired, true);
  });

  it("strips repeated slashes on a closer ([//NAME])", () => {
    const t = parseSectionTagLine("[//ED_Nums]");
    assert.ok(t);
    assert.strictEqual(t.kind, "close");
    assert.strictEqual(t.name, "ED_Nums");
    assert.strictEqual(t.repaired, true);
  });

  it("truncates text left after the tag end", () => {
    const t = parseSectionTagLine("[ED_Nums] leftover");
    assert.ok(t);
    assert.strictEqual(t.kind, "open");
    assert.strictEqual(t.name, "ED_Nums");
    assert.strictEqual(t.repaired, true);
    assert.strictEqual(t.endCol, 9);
  });

  it("supplies a missing closing brace", () => {
    const t = parseSectionTagLine("[ED_Nums");
    assert.ok(t);
    assert.strictEqual(t.kind, "open");
    assert.strictEqual(t.name, "ED_Nums");
    assert.strictEqual(t.repaired, true);
  });

  it("treats [/NAME/] as a close, not a one-liner", () => {
    const t = parseSectionTagLine("[/NAME/]");
    assert.ok(t);
    assert.strictEqual(t.kind, "close");
    assert.strictEqual(t.name, "NAME");
  });

  it("collapses a doubled slash on a one-liner", () => {
    const t = parseSectionTagLine("[STEP DUMP//]");
    assert.ok(t);
    assert.strictEqual(t.kind, "oneLiner");
    assert.strictEqual(t.name, "STEP DUMP");
  });

  // --- names TestPit rejects outright ---

  it("marks a name that still holds a slash as invalid", () => {
    // The space before ']' means the line does NOT end in '/]', so this is
    // not a one-liner — TestPit logs "Invalid section tag".
    const t = parseSectionTagLine("[ STEP DUMP / ]");
    assert.ok(t);
    assert.strictEqual(t.invalid, true);
  });

  it("marks an empty name as invalid", () => {
    const t = parseSectionTagLine("[]");
    assert.ok(t);
    assert.strictEqual(t.invalid, true);
  });

  // --- non-tag lines ---

  it("returns undefined for content, comments and blank lines", () => {
    assert.strictEqual(parseSectionTagLine("time = 100"), undefined);
    assert.strictEqual(parseSectionTagLine("# just a comment"), undefined);
    assert.strictEqual(parseSectionTagLine(""), undefined);
    assert.strictEqual(parseSectionTagLine("    "), undefined);
  });

  it("does not treat a bracket inside a value as a tag", () => {
    assert.strictEqual(
      parseSectionTagLine("Step Conditions = opens as [[ED_Nums]]"),
      undefined
    );
  });
});
