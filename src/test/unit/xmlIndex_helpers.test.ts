import * as assert from "assert";
import {
  asArray,
  str,
  numOrUndef,
  boolOrUndef,
  parseConnectionName,
  parseEnumsBlock,
  parseElementStyleField,
  parseAttributeStyleField,
} from "../../lib/xmlIndex";
import { renderConnection } from "../../lib/renderComponent";

describe("xmlIndex helpers", () => {
  it("asArray handles undefined, single, and array", () => {
    assert.deepStrictEqual(asArray(undefined), []);
    assert.deepStrictEqual(asArray(1), [1]);
    assert.deepStrictEqual(asArray([1, 2]), [1, 2]);
  });

  it("str converts values correctly", () => {
    assert.strictEqual(str(undefined), undefined);
    assert.strictEqual(str(null), undefined);
    assert.strictEqual(str("abc"), "abc");
    assert.strictEqual(str(123), "123");
    assert.strictEqual(str(true), "true");
    assert.strictEqual(str({ "#text": "hi" }), "hi");
  });

  it("numOrUndef and boolOrUndef behaviour", () => {
    assert.strictEqual(numOrUndef("42"), 42);
    assert.strictEqual(numOrUndef("") , undefined);
    assert.strictEqual(numOrUndef("abc"), undefined);
    assert.strictEqual(boolOrUndef("true"), true);
    assert.strictEqual(boolOrUndef("false"), false);
    assert.strictEqual(boolOrUndef(undefined), undefined);
  });

  it("parseConnectionName recognizes L-prefixed names and falls back", () => {
    assert.deepStrictEqual(parseConnectionName("L100SelectedCourseBNR_input1"), {
      messageName: "SelectedCourseBNR",
      label: 100,
    });
    assert.deepStrictEqual(parseConnectionName("BareName"), {
      messageName: "BareName",
      label: undefined,
    });
  });

  it("parseEnumsBlock and parseElement/Attribute field parsers", () => {
    const enums = parseEnumsBlock({ Enum: [{ "@_Name": "A", "#text": "1" }] });
    assert.strictEqual(enums.length, 1);
    const elem = parseElementStyleField({ FieldName: "F", DataType: "Enum", Enums: { Enum: [{ "@_Name": "X", "#text": "5" }] } }, "M");
    assert.strictEqual(elem.name, "F");
    assert.strictEqual(elem.parentMessage, "M");
    const attrib = parseAttributeStyleField({ "@_Name": "G", "@_DataType": "UInt8", "@_Default": "3" }, "N");
    assert.strictEqual(attrib.name, "G");
    assert.strictEqual(attrib.defaultValue, "3");
  });

  it("renderConnection renders '... more' when fields > 12", () => {
    // Build a fake connection and index with a message with 15 fields
    const conn: any = { fullName: "429_X", bus: "429" };
    const index: any = { messages: new Map() };
    const msg: any = { name: "M", type: "BNR", fields: [] };
    for (let i = 0; i < 15; i++) msg.fields.push({ name: `F${i}` });
    index.messages.set("M", msg);
    conn.messageName = "M";
    const md = renderConnection(conn, index);
    const out = (md as any).value || "";
    assert.ok(out.includes("… 3 more") || out.includes("more"));
  });
});
