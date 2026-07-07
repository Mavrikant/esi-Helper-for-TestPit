import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";
import {
  validateComponents,
  validateStructure,
} from "../../lib/componentValidator";

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

  it("does not warn about timing fields (time, interval, occurrence, period)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    time = 100",
      "    interval = 50",
      "    occurrence = 1",
      "    period = 1000",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("does not warn about TestPit parameter fields (count, parity, synchronize, …)", () => {
    // Per TestPit ScriptMessageValidator.cpp these are accepted in any message
    // block alongside the message's own data fields — they must not be flagged
    // as 'Unknown field'. (Multi-word params like "time offset"/"clear time"
    // aren't matched by the single-token assignment regex, so they're skipped
    // too.)
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    count = 3",
      "    parity = ODD",
      "    synchronize = 1",
      "    validity = VALID",
      "    occurrence = 1",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("still validates the discrete 'value' field's enum (value is NOT a free param)", () => {
    // Regression guard for the PARAMETER_FIELDS allowlist: `value` is a real
    // enum field for DIS_ messages, so a bad value must still be flagged.
    const text = [
      "[DIS_PowerOnOff]",
      "    value = POWER_NOPE",
      "[/DIS_PowerOnOff]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "POWER_NOPE");
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

  describe("numeric range check (MinValue/MaxValue)", () => {
    // Course is BNR with MinValue=0, MaxValue=359.9 in the fixtures.
    const courseLine = (rhs: string) =>
      [
        "[429_L100SelectedCourseBNR_input1]",
        `    Course = ${rhs}`,
        "[/429_L100SelectedCourseBNR_input1]",
      ].join("\n");

    it("flags a numeric literal above MaxValue", () => {
      const issues = validateComponents(courseLine("400.0"), idx);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].kind, "valueOutOfRange");
      assert.strictEqual(issues[0].identifier, "400.0");
      assert.match(issues[0].message, /0\.\.359\.9/);
    });

    it("flags a numeric literal below MinValue", () => {
      const issues = validateComponents(courseLine("-5"), idx);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].kind, "valueOutOfRange");
    });

    it("accepts a value at the boundary and inside the range", () => {
      assert.deepStrictEqual(validateComponents(courseLine("0"), idx), []);
      assert.deepStrictEqual(validateComponents(courseLine("359.9"), idx), []);
      assert.deepStrictEqual(validateComponents(courseLine("180"), idx), []);
    });

    it("skips a macro RHS (value only known after preprocessing)", () => {
      assert.deepStrictEqual(validateComponents(courseLine("%COURSE%"), idx), []);
    });

    it("skips a range/expression RHS and tolerates a trailing comment", () => {
      assert.deepStrictEqual(validateComponents(courseLine("100-200"), idx), []);
      assert.deepStrictEqual(validateComponents(courseLine("180 # mid"), idx), []);
    });
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

  it("accepts a valid numeric enum value (SDI = 0 → INSTALLATION_NUMBER_ALL_CALL)", () => {
    // TestPit accepts an enum by its numeric value; 0 maps to a defined enum.
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = 0",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("accepts the other valid numeric enum value (SDI = 1) and tolerates a trailing comment", () => {
    const good = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = 1 # INSTALLATION_NUMBER_ONE",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(good, idx), []);
  });

  it("flags an out-of-table numeric enum value (SDI = 7)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = 7",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "7");
  });

  it("skips a macro RHS on an enum field (no numeric guess)", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = %SDI_VALUE%",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("validates VORILS<N>_ tags for any unit number (matches the user's [VORILS1_VORILSDataMsg] sample)", () => {
    const text = [
      "[VORILS1_VORILSDataMsg]",
      "    time = 2145-2200",
      "    period = 200",
      "    interval = 36000",
      "    VORILSFrequency = 117000",
      "    VOROmnibearing = 100",
      "    VOROmnibearingValidity = VALID",
      "    VORLOCStatus = OK",
      "[/VORILS1_VORILSDataMsg]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("treats VORILS2_ (non-canonical unit) as a known component too", () => {
    const text = [
      "[VORILS2_VORILSDataMsg]",
      "    VOROmnibearingValidity = VALID",
      "[/VORILS2_VORILSDataMsg]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(text, idx), []);
  });

  it("flags an unknown VORILS message name as unknownConnection", () => {
    const text = [
      "[VORILS1_NotARealVORILSMsg]",
      "    foo = bar",
      "[/VORILS1_NotARealVORILSMsg]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.ok(issues.some((i) => i.kind === "unknownConnection"));
  });

  it("validates PART_<partition>_<port> as a known memory-port reference", () => {
    // Good — PART_TEST_MBPBITStatus has an Enum field "Value" with FAILURE/SUCCESS.
    const good = [
      "[PART_TEST_MBPBITStatus]",
      "    Value = SUCCESS",
      "[/PART_TEST_MBPBITStatus]",
    ].join("\n");
    assert.deepStrictEqual(validateComponents(good, idx), []);

    // Bad enum on the same port.
    const bad = [
      "[PART_TEST_MBPBITStatus]",
      "    Value = NOPE_VALUE",
      "[/PART_TEST_MBPBITStatus]",
    ].join("\n");
    const issues = validateComponents(bad, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "NOPE_VALUE");
  });

  it("flags an unknown PART_<partition>_<port> as unknownConnection", () => {
    const text = [
      "[PART_HSI_NoSuchPort]",
      "    foo = bar",
      "[/PART_HSI_NoSuchPort]",
    ].join("\n");
    const issues = validateComponents(text, idx);
    assert.ok(issues.some((i) => i.kind === "unknownConnection"));
  });

  describe("CSV reference values", () => {
    // SDI is Enum on the SelectedCourseBNR (429) message in the fixtures.
    const enumLine = (csvCell: string) =>
      [
        "[429_L100SelectedCourseBNR_input1]",
        `    SDI = ${csvCell}`,
        "[/429_L100SelectedCourseBNR_input1]",
      ].join("\n");

    it("looks up the cell value via csvLookup and validates that against the enum table", () => {
      const csvLookup = (file: string, line: number, col: number): string | undefined => {
        // Mocked CSV: line 4 col 1 contains a valid SDI enum value.
        if (file === "fix.csv" && line === 4 && col === 1) return "INSTALLATION_NUMBER_ONE";
        return undefined;
      };
      const issues = validateComponents(enumLine("fix.csv line:4 col:1"), idx, csvLookup);
      assert.deepStrictEqual(issues, []);
    });

    it("flags an unknown CSV cell value with the file/line/col in the message", () => {
      const csvLookup = (): string | undefined => "BOGUS_VALUE";
      const issues = validateComponents(enumLine("fix.csv line:4 col:1"), idx, csvLookup);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].kind, "unknownEnum");
      assert.strictEqual(issues[0].identifier, "BOGUS_VALUE");
      assert.match(issues[0].message, /BOGUS_VALUE/);
      assert.match(issues[0].message, /fix\.csv line:4 col:1/);
    });

    it("emits unknownCsvCell when the lookup returns undefined", () => {
      const csvLookup = (): string | undefined => undefined;
      const issues = validateComponents(enumLine("missing.csv line:1 col:1"), idx, csvLookup);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].kind, "unknownCsvCell");
      assert.match(issues[0].message, /missing\.csv/);
    });

    it("does NOT misfire as unknownEnum when the field is non-Enum", () => {
      // Course is BNR (Float) — no enum check ever fires. Even with no
      // csvLookup at all, the CSV reference shouldn't produce a warning.
      const text = [
        "[429_L100SelectedCourseBNR_input1]",
        "    Course = fix.csv line:4 col:1",
        "[/429_L100SelectedCourseBNR_input1]",
      ].join("\n");
      assert.deepStrictEqual(validateComponents(text, idx), []);
    });

    it("does not warn for a CSV reference when csvLookup is not provided (regression vs the old false-positive)", () => {
      // Before this change, the validator would match `fix` as the RHS
      // identifier (RHS_IDENT_RE stops at `.`), look it up as an enum,
      // and emit unknownEnum: 'fix'. With CSV-aware detection we just
      // skip when no resolver is wired up.
      const issues = validateComponents(enumLine("fix.csv line:4 col:1"), idx);
      assert.deepStrictEqual(issues, []);
    });
  });

  it("flags bad enums on CRLF-line-ended documents (Windows line endings)", () => {
    // Regression: validator was using text.split("\n") which left a trailing
    // \r on every line. The ASSIGNMENT_RE's $ anchor then couldn't match
    // (`.` doesn't include \r) and field-level validation silently produced
    // 0 issues for the entire document. This test reproduces that scenario.
    const text = [
      "[429_L100SelectedCourseBNR_input1]",
      "    SDI = INSTALLATION_NUMBER_NOPE",
      "[/429_L100SelectedCourseBNR_input1]",
    ].join("\r\n");
    const issues = validateComponents(text, idx);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unknownEnum");
    assert.strictEqual(issues[0].identifier, "INSTALLATION_NUMBER_NOPE");
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

describe("validateStructure (index-independent structural checks)", () => {
  const wrap = (...inner: string[]) =>
    ["[TEST STEPS]", "    [STEP 10]", ...inner, "    [/STEP 10]", "[/TEST STEPS]"].join(
      "\n"
    );

  it("returns nothing for a balanced complete script", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [429_Foo]",
      "                time = 5",
      "            [/429_Foo]",
      "        [/STEP INPUTS]"
    );
    assert.deepStrictEqual(validateStructure(text), []);
  });

  it("skips include-fragments (no TEST STEPS / TEST DEFINITION root)", () => {
    // A fragment can legitimately have tags closed by its parent — never flag.
    const text = ["[STEP INPUTS]", "    [429_Foo]", "[/STEP 10]"].join("\n");
    assert.deepStrictEqual(validateStructure(text), []);
  });

  it("flags an unclosed section at end of file", () => {
    const text = ["[TEST STEPS]", "    [STEP 10]", "    [/STEP 10]"].join("\n");
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unbalancedTag");
    assert.strictEqual(issues[0].severity, "error");
    assert.strictEqual(issues[0].identifier, "TEST STEPS");
  });

  it("flags a stray closing tag with no opener", () => {
    const text = ["[TEST STEPS]", "    [/STEP 99]", "[/TEST STEPS]"].join("\n");
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "unbalancedTag");
    assert.match(issues[0].message, /no matching opening tag/);
  });

  it("errors on an A708 message under STEP INPUTS", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [708_WeatherRadar]",
      "                time = 1",
      "            [/708_WeatherRadar]",
      "        [/STEP INPUTS]"
    );
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "invalidNesting");
    assert.strictEqual(issues[0].severity, "error");
    assert.match(issues[0].message, /A708/);
  });

  it("warns on MANUAL_VERIFY under STEP INPUTS", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [MANUAL_VERIFY]",
      "                text = check",
      "            [/MANUAL_VERIFY]",
      "        [/STEP INPUTS]"
    );
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "invalidNesting");
    assert.strictEqual(issues[0].severity, "warning");
  });

  it("warns on an output-only field (occurrence) in a STEP INPUTS message", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [429_Foo]",
      "                occurrence = 1",
      "            [/429_Foo]",
      "        [/STEP INPUTS]"
    );
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "outputFieldInInput");
    assert.strictEqual(issues[0].identifier, "occurrence");
  });

  it("does NOT flag output-only fields in a STEP OUTPUTS message", () => {
    const text = wrap(
      "        [STEP OUTPUTS]",
      "            [429_Foo]",
      "                occurrence = 1",
      "                synchronize = 1",
      "            [/429_Foo]",
      "        [/STEP OUTPUTS]"
    );
    assert.deepStrictEqual(validateStructure(text), []);
  });

  it("does not treat [..] inside prose/values as a tag", () => {
    const text = wrap(
      "        [STEP DEFINITION]",
      "            Step Description = see note [TBD] and [ref 5]",
      "        [/STEP DEFINITION]"
    );
    assert.deepStrictEqual(validateStructure(text), []);
  });

  it("flags a duplicate key within a message block", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [429_Foo]",
      "                SDI = X",
      "                SDI = Y",
      "            [/429_Foo]",
      "        [/STEP INPUTS]"
    );
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "duplicateKey");
    assert.strictEqual(issues[0].severity, "error");
    assert.strictEqual(issues[0].identifier, "SDI");
    assert.strictEqual(issues[0].line, 5); // the second (duplicate) SDI line
  });

  it("does not treat the same key in two separate message blocks as a duplicate", () => {
    const text = wrap(
      "        [STEP INPUTS]",
      "            [429_Foo]",
      "                SDI = X",
      "            [/429_Foo]",
      "            [429_Bar]",
      "                SDI = Y",
      "            [/429_Bar]",
      "        [/STEP INPUTS]"
    );
    assert.deepStrictEqual(validateStructure(text), []);
  });

  it("detects duplicate 1553 dot-notation keys", () => {
    const text = wrap(
      "        [STEP OUTPUTS]",
      "            [1553_Foo]",
      "                Mode.SelectedCourse = 1",
      "                Mode.SelectedCourse = 2",
      "            [/1553_Foo]",
      "        [/STEP OUTPUTS]"
    );
    const issues = validateStructure(text);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].kind, "duplicateKey");
    assert.strictEqual(issues[0].identifier, "Mode.SelectedCourse");
  });
});
