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

  it("does not warn about timing fields (time, delay, interval, occurrence, period)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    time = 100",
      "    delay = 200",
      "    interval = 50",
      "    occurrence = 1",
      "    period = 1000",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("validates 1553 dot-notation fields (Word.Field) inside an open block", () => {
    // Good: TACANDMEOutput1 has DataValidity.TransmitReceive (Enum: RECEIVE/TRANSMITRECEIVE).
    const good = [
      "[1553_L042TACANDMEOutput1_1]",
      "    DataValidity.TransmitReceive = RECEIVE",
      "[/1553_L042TACANDMEOutput1_1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(good, idx), []);

    // Bad enum: DataValidity.TransmitReceive doesn't have a NOPE value.
    const badEnum = [
      "[1553_L042TACANDMEOutput1_1]",
      "    DataValidity.TransmitReceive = NOPE",
      "[/1553_L042TACANDMEOutput1_1]",
    ].join("\n");
    const enumIssues = validateComponents(badEnum, idx);
    assert.strictEqual(enumIssues.length, 1);
    assert.strictEqual(enumIssues[0].kind, "unknownEnum");
    assert.strictEqual(enumIssues[0].identifier, "NOPE");

    // Bad field: Word.NotAField doesn't exist on TACANDMEOutput1.
    const badField = [
      "[1553_L042TACANDMEOutput1_1]",
      "    DataValidity.NotAField = 1",
      "[/1553_L042TACANDMEOutput1_1]",
    ].join("\n");
    const fieldIssues = validateComponents(badField, idx);
    assert.strictEqual(fieldIssues.length, 1);
    assert.strictEqual(fieldIssues[0].kind, "unknownField");
    assert.strictEqual(fieldIssues[0].identifier, "DataValidity.NotAField");
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

  it("recognises DIS_ as the discrete-signal prefix and validates enums under it", () => {
    const good = [
      "[DIS_PowerOnOff]",
      "    value = POWER_ON",
      "[/DIS_PowerOnOff]",
    ].join("\n");
    const bad = [
      "[DIS_PowerOnOff]",
      "    value = POWER_NOPE",
      "[/DIS_PowerOnOff]",
    ].join("\n");

    assert.deepStrictEqual(validateComponents(good, idx), []);
    const issues = validateComponents(bad, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "POWER_NOPE");
  });

  it("ignores a field-name line with no '=' (e.g. mid-edit)", () => {
    // Edge case: user is mid-typing — a field name on a line with no `=` yet.
    // Validator should not crash or warn.
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("ignores an Enum-field assignment whose RHS is a numeric literal (no enum check fires)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = 0",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    // RHS doesn't start with an identifier char, so no unknownEnum is raised.
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("does not treat [Discrete_*] as a component tag (Discrete_ is not a valid prefix)", () => {
    // Discrete_PowerOnOff isn't recognised as a component tag at all, so the
    // line inside the block is just plain content — no warnings, no field
    // validation.
    const text = [
      "[Discrete_PowerOnOff]",
      "    value = POWER_NOPE",
      "[/Discrete_PowerOnOff]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });
});
