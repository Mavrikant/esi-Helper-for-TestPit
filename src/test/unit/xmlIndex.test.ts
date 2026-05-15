import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";

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

describe("xmlIndex", () => {
  describe("parseConfigFolder", () => {
    it("returns an empty index for a non-existent folder", () => {
      const idx = parseConfigFolder(path.join(FIXTURE_DIR, "_does_not_exist"));
      assert.strictEqual(idx.connections.size, 0);
      assert.strictEqual(idx.messages.size, 0);
    });

    it("returns an empty index for an empty configFolderpath string", () => {
      const idx = parseConfigFolder("");
      assert.strictEqual(idx.connections.size, 0);
    });

    const idx = parseConfigFolder(FIXTURE_DIR);

    it("ingests A429 connections and prefixes them with '429_'", () => {
      assert.ok(idx.connections.has("429_L100SelectedCourseBNR_input1"));
      assert.ok(idx.connections.has("429_L100SelectedCourseBNR_input2"));
      const conn = idx.connections.get("429_L100SelectedCourseBNR_input1")!;
      assert.strictEqual(conn.bus, "429");
      assert.strictEqual(conn.rawName, "L100SelectedCourseBNR_input1");
      assert.strictEqual(conn.label, 100);
      assert.strictEqual(conn.messageName, "SelectedCourseBNR");
      assert.strictEqual(conn.card, "1");
      assert.strictEqual(conn.channel, "16");
      assert.strictEqual(conn.speed, "100000");
    });

    it("ingests 1553 connections and prefixes them with '1553_'", () => {
      assert.ok(idx.connections.has("1553_L042TACANDMEOutput1_1"));
      const conn = idx.connections.get("1553_L042TACANDMEOutput1_1")!;
      assert.strictEqual(conn.bus, "1553");
      assert.strictEqual(conn.label, 42);
    });

    it("ingests A429 messages with their fields", () => {
      const msg = idx.messages.get("SelectedCourseBNR");
      assert.ok(msg, "expected SelectedCourseBNR message");
      assert.strictEqual(msg!.bus, "429");
      assert.strictEqual(msg!.label, 100);
      assert.strictEqual(msg!.direction, "Output");
      assert.strictEqual(msg!.type, "BNR");
      assert.strictEqual(msg!.fields.length, 3);
    });

    it("parses Enum fields with their enum values", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const sdi = msg.fields.find((f) => f.name === "SDI");
      assert.ok(sdi, "expected SDI field");
      assert.strictEqual(sdi!.dataType, "Enum");
      assert.strictEqual(sdi!.defaultValue, "INSTALLATION_NUMBER_ALL_CALL");
      assert.strictEqual(sdi!.enums?.length, 2);
      assert.deepStrictEqual(
        sdi!.enums?.map((e) => e.name),
        ["INSTALLATION_NUMBER_ALL_CALL", "INSTALLATION_NUMBER_ONE"]
      );
      assert.strictEqual(sdi!.enums?.[1].value, "1");
    });

    it("parses BNR fields with min/max/resolution/unit", () => {
      const msg = idx.messages.get("SelectedCourseBNR")!;
      const course = msg.fields.find((f) => f.name === "Course");
      assert.ok(course, "expected Course field");
      assert.strictEqual(course!.dataType, "BNR");
      assert.strictEqual(course!.minValue, "0");
      assert.strictEqual(course!.maxValue, "359.9");
      assert.strictEqual(course!.resolution, "0.0055");
      assert.strictEqual(course!.unit, "deg");
    });

    it("ingests discrete signals as both messages and connections", () => {
      const msg = idx.messages.get("PowerOnOff");
      assert.ok(msg, "expected PowerOnOff message");
      assert.strictEqual(msg!.bus, "DIS");
      assert.strictEqual(msg!.fields.length, 1);
      assert.strictEqual(msg!.fields[0].dataType, "Enum");
      assert.strictEqual(msg!.fields[0].enums?.length, 2);
      assert.ok(idx.connections.has("DIS_PowerOnOff"));
    });

    it("registers each discrete signal under the DIS_ prefix (Discrete_ is not a valid tag)", () => {
      assert.ok(
        idx.connections.has("DIS_PowerOnOff"),
        "expected DIS_PowerOnOff"
      );
      assert.strictEqual(
        idx.connections.has("Discrete_PowerOnOff"),
        false,
        "Discrete_ should NOT be registered — DIS_ is the only valid prefix"
      );
      const resolved = idx.resolveConnectionMessage("DIS_PowerOnOff");
      assert.ok(resolved);
      assert.strictEqual(resolved!.name, "PowerOnOff");
    });

    it("resolveConnectionMessage maps a connection to its A429 message", () => {
      const msg = idx.resolveConnectionMessage("429_L100SelectedCourseBNR_input1");
      assert.ok(msg);
      assert.strictEqual(msg!.name, "SelectedCourseBNR");
    });

    it("resolveConnectionMessage returns undefined for unknown names", () => {
      assert.strictEqual(idx.resolveConnectionMessage("429_NopeNope"), undefined);
    });

    it("resolveConnectionMessage works for bare-named 1553 connections (no L<digits> prefix)", () => {
      // Real-world 1553 / Memory connections in MessageConfig don't follow
      // the `L<label><Name>_<suffix>` pattern that 429 connections use —
      // their names ARE the message name directly. Bug fix: when the
      // L-pattern doesn't match, parseConnectionName falls back to using
      // the raw name as messageName.
      assert.ok(idx.connections.has("1553_TACANDMEOutput1"));
      const conn = idx.connections.get("1553_TACANDMEOutput1")!;
      assert.strictEqual(conn.messageName, "TACANDMEOutput1");
      assert.strictEqual(conn.label, undefined);
      const msg = idx.resolveConnectionMessage("1553_TACANDMEOutput1");
      assert.ok(msg, "expected resolveConnectionMessage to return a MessageDef");
      assert.strictEqual(msg!.name, "TACANDMEOutput1");
      assert.strictEqual(msg!.fields.length, 3);
    });

    it("ingests 1553 messages with Word.Field dot-qualified field names", () => {
      const msg = idx.messages.get("TACANDMEOutput1");
      assert.ok(msg, "expected TACANDMEOutput1 message");
      assert.strictEqual(msg!.bus, "1553");
      assert.strictEqual(msg!.direction, "Output");
      // 2 fields from word "DataValidity" + 1 from word "Range" = 3 total
      assert.strictEqual(msg!.fields.length, 3);
      // Field names are qualified by their parent Word (1553 .esi scripts
      // address them as `WordName.FieldName`).
      const tx = msg!.fields.find((f) => f.name === "DataValidity.TransmitReceive");
      assert.ok(tx, "expected DataValidity.TransmitReceive field");
      assert.strictEqual(tx!.dataType, "Enum");
      assert.strictEqual(tx!.defaultValue, "RECEIVE");
      assert.strictEqual(tx!.enums?.length, 2);
      const range = msg!.fields.find((f) => f.name === "Range.RangeValue");
      assert.ok(range, "expected Range.RangeValue field");
      assert.strictEqual(range!.dataType, "UInt16");
      assert.strictEqual(range!.unit, "nm");
    });

    it("ingests VORILS messages and registers them under canonical VORILS1_ prefix", () => {
      // VORILSMessageFields uses Messages > InputMessages/OutputMessages > Message
      // structure, distinct from A429 / 1553 / Discrete shapes.
      const dataMsg = idx.messages.get("VORILSDataMsg");
      assert.ok(dataMsg, "expected VORILSDataMsg message");
      assert.strictEqual(dataMsg!.bus, "VORILS");
      assert.strictEqual(dataMsg!.direction, "Output");
      assert.strictEqual(dataMsg!.fields.length, 4);

      const cmdMsg = idx.messages.get("VORILSCommandMsg");
      assert.ok(cmdMsg, "expected VORILSCommandMsg message");
      assert.strictEqual(cmdMsg!.direction, "Input");

      // Canonical VORILS1_<name> connection registered for completion.
      assert.ok(idx.connections.has("VORILS1_VORILSDataMsg"));
      assert.ok(idx.connections.has("VORILS1_VORILSCommandMsg"));
    });

    it("parses VORILS Enum fields with their enums and numeric fields with <Encoding>", () => {
      const msg = idx.messages.get("VORILSDataMsg")!;
      const validity = msg.fields.find((f) => f.name === "VOROmnibearingValidity");
      assert.ok(validity);
      assert.strictEqual(validity!.dataType, "Enum");
      assert.deepStrictEqual(
        validity!.enums?.map((e) => e.name),
        ["INVALID", "VALID"]
      );
      const bearing = msg.fields.find((f) => f.name === "VOROmnibearing");
      assert.ok(bearing);
      assert.strictEqual(bearing!.dataType, "DoubleDegree");
      // Encoding metadata flattened onto the field
      assert.strictEqual(bearing!.minValue, "0.0");
      assert.strictEqual(bearing!.maxValue, "359.99");
      assert.strictEqual(bearing!.resolution, "0.005");
    });

    it("resolveConnectionMessage handles VORILS<N>_ for any unit number, not just N=1", () => {
      // VORILS1 is canonical (registered)
      const m1 = idx.resolveConnectionMessage("VORILS1_VORILSDataMsg");
      assert.ok(m1);
      assert.strictEqual(m1!.name, "VORILSDataMsg");
      // VORILS2/3/etc. are NOT registered as connections, but resolve via
      // the unit-number-stripping fallback to the same message.
      const m2 = idx.resolveConnectionMessage("VORILS2_VORILSDataMsg");
      assert.ok(m2, "expected VORILS2_ to resolve via fallback");
      assert.strictEqual(m2!.name, "VORILSDataMsg");
      const m99 = idx.resolveConnectionMessage("VORILS99_VORILSDataMsg");
      assert.ok(m99);
      assert.strictEqual(m99!.name, "VORILSDataMsg");
    });

    it("ingests memory ports under both Mem_ and PART_<partition>_ forms", () => {
      // Short Mem_ prefix
      assert.ok(idx.connections.has("Mem_RNEGeneralWriteLedStatus"));
      // Fully-qualified PART_<partition>_ prefix
      assert.ok(idx.connections.has("PART_HSI_RNEGeneralWriteLedStatus"));

      const memConn = idx.connections.get("Mem_RNEGeneralWriteLedStatus")!;
      const partConn = idx.connections.get("PART_HSI_RNEGeneralWriteLedStatus")!;
      assert.strictEqual(memConn.bus, "Mem");
      assert.strictEqual(partConn.bus, "Mem");
      assert.strictEqual(memConn.messageName, partConn.messageName);

      const msg = idx.resolveConnectionMessage("PART_HSI_RNEGeneralWriteLedStatus");
      assert.ok(msg);
      assert.strictEqual(msg!.fields.length, 2);
      const led = msg!.fields.find((f) => f.name === "LedStatus");
      assert.ok(led);
      // attribute-style fields use `Type` (not `DataType`) and `BitSize` (not `Size`)
      assert.strictEqual(led!.dataType, "UInt32");
      assert.strictEqual(led!.size, "1");
      assert.strictEqual(led!.startBit, "0");
    });

    it("registers PART_<partition>_<port> for ports across multiple partitions", () => {
      // Port in HSI partition
      assert.ok(idx.connections.has("PART_HSI_RNEGeneralWritePSAlive"));
      // Port in TEST partition (with its own Enum field)
      assert.ok(idx.connections.has("PART_TEST_MBPBITStatus"));
      const msg = idx.resolveConnectionMessage("PART_TEST_MBPBITStatus");
      assert.ok(msg);
      const value = msg!.fields.find((f) => f.name === "Value");
      assert.ok(value);
      assert.strictEqual(value!.dataType, "Enum");
      assert.deepStrictEqual(
        value!.enums?.map((e) => e.name),
        ["FAILURE", "SUCCESS"]
      );
    });
  });
});
