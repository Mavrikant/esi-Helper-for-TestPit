import * as assert from "assert";
import { findConnectionByBareName } from "../../lib/bareConnectionLookup";
import { Bus, ConnectionDef } from "../../lib/xmlIndex";

function connections(...defs: Array<[string, Bus, string]>): Map<string, ConnectionDef> {
  const map = new Map<string, ConnectionDef>();
  for (const [fullName, bus, rawName] of defs) {
    map.set(fullName, { fullName, bus, rawName });
  }
  return map;
}

describe("bareConnectionLookup.findConnectionByBareName", () => {
  const index = connections(
    ["PART_HSI_Alive", "Mem", "Alive"],
    ["Mem_Alive", "Mem", "Alive"],
    ["429_L100Sel_input1", "429", "L100Sel_input1"],
    ["1553_RT1_Msg", "1553", "RT1_Msg"],
    ["DIS_AirGround", "DIS", "AirGround"],
    ["VORILS1_VORILSDataMsg", "VORILS", "VORILSDataMsg"],
    ["ED_Type1", "ED", "Type1"],
    ["PART_TEST_MBPBITStatus", "Mem", "MBPBITStatus"],
    ["PART_A429_Port_One", "Mem", "Port_One"]
  );
  const find = (name: string): string | undefined =>
    findConnectionByBareName(index, name)?.fullName;

  it("finds the classic bus prefixes", () => {
    assert.strictEqual(find("L100Sel_input1"), "429_L100Sel_input1");
    assert.strictEqual(find("RT1_Msg"), "1553_RT1_Msg");
    assert.strictEqual(find("AirGround"), "DIS_AirGround");
    assert.strictEqual(find("VORILSDataMsg"), "VORILS1_VORILSDataMsg");
  });

  it("finds ED_ and PART_<partition>_ connections", () => {
    assert.strictEqual(find("Type1"), "ED_Type1");
    assert.strictEqual(find("MBPBITStatus"), "PART_TEST_MBPBITStatus");
    assert.strictEqual(find("Port_One"), "PART_A429_Port_One");
  });

  it("prefers the earlier prefix when buses share a bare name", () => {
    // Mem_ comes before PART_ in COMPONENT_TAG_PREFIXES, whatever the map order.
    assert.strictEqual(find("Alive"), "Mem_Alive");
  });

  it("matches the whole remainder only", () => {
    assert.strictEqual(find("Sel_input1"), undefined);
    assert.strictEqual(find("input1"), undefined);
    assert.strictEqual(find("HSI_Alive"), undefined);
    assert.strictEqual(find("429_L100Sel_input1"), undefined);
    assert.strictEqual(find(""), undefined);
    assert.strictEqual(find("Nope"), undefined);
  });
});
