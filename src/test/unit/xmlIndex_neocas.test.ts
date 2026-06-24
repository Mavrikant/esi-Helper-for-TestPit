import * as assert from "assert";
import * as path from "path";
import { parseConfigFiles, isKnownComponent } from "../../lib/xmlIndex";

const DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "test",
  "fixtures",
  "config",
  "neocas"
);

describe("xmlIndex NEOCAS (route-by-role + Ref resolution)", () => {
  const idx = parseConfigFiles({
    cable: path.join(DIR, "MessageConfig_Cable.xml"),
    partition: path.join(DIR, "NeoCASPorts.xml"),
    ed: path.join(DIR, "EDMessageFields.xml"),
  });

  describe("ED messages (EDConfigFile, [ED_…] prefix)", () => {
    it("registers each ED message under the ED_ prefix", () => {
      assert.ok(isKnownComponent(idx, "ED_Type1"));
    });

    it("resolves a Field's enum table referenced via @Ref to CommonEnums", () => {
      const msg = idx.resolveConnectionMessage("ED_Type1");
      assert.ok(msg);
      const typeCode = msg!.fields.find((f) => f.name === "type_code");
      assert.deepStrictEqual(
        typeCode?.enums?.map((e) => e.name),
        ["AIRCRAFT_CATEGORY_SET_A", "AIRCRAFT_CATEGORY_SET_D"]
      );
    });

    it("leaves non-enum ED fields without an enum table", () => {
      const msg = idx.resolveConnectionMessage("ED_Type1");
      const cat = msg!.fields.find((f) => f.name === "aircraft_category");
      assert.ok(cat);
      assert.ok(!cat!.enums || cat!.enums.length === 0);
    });
  });

  describe("partition ports referencing CommonPorts", () => {
    it("resolves PART_<partition>_<localName> where local != common port name", () => {
      assert.ok(isKnownComponent(idx, "PART_HealthManager_IOHealthState_Alert"));
      const msg = idx.resolveConnectionMessage(
        "PART_HealthManager_IOHealthState_Alert"
      );
      assert.strictEqual(msg?.name, "IOHealthState");
    });

    it("resolves a port Field's @Ref enum (Enum8) via CommonEnums", () => {
      const msg = idx.resolveConnectionMessage(
        "PART_HealthManager_IOHealthState_Alert"
      );
      const state = msg!.fields.find((f) => f.name === "State");
      assert.deepStrictEqual(
        state?.enums?.map((e) => e.name),
        ["HEALTHY", "FAULTY"]
      );
    });

    it("accepts Sampling/Queuing port types (bucketed under Mem bus)", () => {
      assert.ok(isKnownComponent(idx, "PART_HealthManager_A429BITResults"));
      const conn = idx.connections.get("PART_HealthManager_A429BITResults");
      assert.strictEqual(conn?.bus, "Mem");
    });
  });

  describe("cable connections with @Ref to a <References> channel", () => {
    it("pulls card/channel/speed from the referenced channel", () => {
      const conn = idx.connections.get("429_L164RadioAltitude");
      assert.ok(conn);
      assert.strictEqual(conn!.card, "1");
      assert.strictEqual(conn!.channel, "19");
      assert.strictEqual(conn!.speed, "100000");
    });
  });
});
