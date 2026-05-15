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
  });
});
