import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";
import { validateComponents } from "../../lib/componentValidator";

const FIXTURE_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "test",
  "fixtures",
  "config"
);

const idx = parseConfigFolder(FIXTURE_DIR);

describe("componentValidator", () => {
  it("returns no issues for a fully valid block", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    time = 5600",
      "    SDI = INSTALLATION_NUMBER_ONE",
      "    Course = 100.0",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("warns on an unknown enum value with the field name in the message", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = INSTALLATION_NUMBER_NOPE",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "INSTALLATION_NUMBER_NOPE");
    assert.match(issues[0].message, /SDI/);
    // Range should cover the value, not the whole line.
    assert.strictEqual(issues[0].line, 1);
    assert.strictEqual(
      issues[0].endCol - issues[0].startCol,
      "INSTALLATION_NUMBER_NOPE".length
    );
  });

  it("warns on an unknown field for a known message", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    NotAField = 1",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownField");
    assert.strictEqual(issues[0].identifier, "NotAField");
  });

  it("warns on an unknown component (connection) name", () => {
    const text = [
      "[429_NotAConnection]",
      "    time = 100",
      "[/429_NotAConnection]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownConnection");
    assert.strictEqual(issues[0].identifier, "429_NotAConnection");
    // Range covers the connection name (between the brackets).
    assert.strictEqual(issues[0].startCol, 1);
    assert.strictEqual(
      issues[0].endCol - issues[0].startCol,
      "429_NotAConnection".length
    );
  });

  it("does not warn about timing fields like 'time' or 'delay'", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    time = 100",
      "    delay = 200",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("does not warn about non-component tags ([STEP 10] etc.)", () => {
    const text = [
      "[STEP 10]",
      "    SomeRandomKey = 5",
      "[/STEP 10]",
    ].join("\n");
    // SomeRandomKey is outside any component — no field check fires.
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("does not double-warn when both connection and field are unknown", () => {
    const text = [
      "[429_NotAConnection]",
      "    NotAField = NOT_AN_ENUM",
      "[/429_NotAConnection]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    // Just one warning for the unknown connection — field-level checks
    // are skipped because resolveConnectionMessage returns undefined.
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownConnection");
  });

  it("flags multiple bad enum values on consecutive lines", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = NOPE_ONE",
      "    SDI = NOPE_TWO",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 2);
    assert.deepStrictEqual(
      issues.map((i) => i.identifier),
      ["NOPE_ONE", "NOPE_TWO"]
    );
  });

  it("does not warn on numeric RHS values for non-Enum fields (e.g. Course = 50.0)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    Course = 359.5",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("returns no issues for an empty document", () => {
    assert.deepStrictEqual(validateComponents("", idx), []);
  });
});
