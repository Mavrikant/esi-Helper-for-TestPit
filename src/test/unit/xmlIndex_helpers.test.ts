import * as assert from "assert";
import {
  asArray,
  str,
  numOrUndef,
  boolOrUndef,
  parseConnectionName,
  parseEnumsBlock,
  parseField,
  nodeValue,
  formatVersion,
  XML_CONFIG_VERSION_LEGACY,
  XML_CONFIG_VERSION_LATEST,
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

  it("nodeValue takes the attribute first and the child element second", () => {
    assert.strictEqual(nodeValue({ "@_Name": "A", Name: "B" }, "Name"), "A");
    assert.strictEqual(nodeValue({ Name: "B" }, "Name"), "B");
    assert.strictEqual(nodeValue({}, "Name"), undefined);
    // An empty value counts as absent, the way TestPit's own accessor treats it.
    assert.strictEqual(nodeValue({ "@_Name": "" }, "Name"), undefined);
    assert.strictEqual(nodeValue({ Name: "" }, "Name"), undefined);
  });

  it("formatVersion reads Version off the root, defaulting to format 1", () => {
    assert.strictEqual(formatVersion({}), XML_CONFIG_VERSION_LEGACY);
    assert.strictEqual(formatVersion({ "@_Version": "2" }), XML_CONFIG_VERSION_LATEST);
    assert.strictEqual(formatVersion({ "@_Version": "1" }), XML_CONFIG_VERSION_LEGACY);
  });

  it("parseEnumsBlock reads wrapped and unwrapped states alike", () => {
    // No wrapper, <Enums> (format 1) and <EnumDef> (format 2) all read.
    assert.strictEqual(parseEnumsBlock({ Enum: [{ "@_Name": "A", "#text": "1" }] }).length, 1);
    assert.strictEqual(parseEnumsBlock({ Enums: { Enum: [{ "@_Name": "A", "#text": "1" }] } }).length, 1);
    assert.strictEqual(parseEnumsBlock({ EnumDef: { Enum: [{ "@_Name": "A", "#text": "1" }] } }).length, 1);
    // <ValidEnums> sits beside <Enums> in a format 1 field and is never read.
    const both = parseEnumsBlock({
      Enums: { Enum: [{ "@_Name": "A", "#text": "1" }] },
      ValidEnums: { Enum: [{ "@_Name": "B", "#text": "2" }] },
    });
    assert.deepStrictEqual(both.map((e) => e.name), ["A"]);
  });

  it("parseField reads a format 1 field and its format 2 twin the same way", () => {
    const v1 = parseField(
      {
        FieldName: "F",
        DataType: "Enum",
        StartBit: "9",
        Size: "2",
        DefaultValue: "X",
        Enums: { Enum: [{ "@_Name": "X", "#text": "5" }] },
      },
      "M"
    );
    const v2 = parseField(
      {
        "@_Name": "F",
        "@_DataType": "Enum",
        "@_StartBit": "9",
        "@_BitSize": "2",
        "@_DefaultValue": "X",
        EnumDef: { Enum: [{ "@_Name": "X", "#text": "5" }] },
      },
      "M"
    );
    assert.deepStrictEqual(v1, v2);
    assert.strictEqual(v1.name, "F");
    assert.strictEqual(v1.size, "2");
    assert.strictEqual(v1.parentMessage, "M");
    assert.strictEqual(v1.enums?.[0].value, "5");
  });

  it("parseField takes 1553's Default as DefaultValue and resolves Ref", () => {
    const common = new Map([[ "Validity", [{ name: "VALID", value: "1" }] ]]);
    const legacy = parseField({ "@_Name": "G", "@_DataType": "UInt8", "@_Default": "3" }, "N");
    assert.strictEqual(legacy.name, "G");
    assert.strictEqual(legacy.defaultValue, "3");
    const shared = parseField(
      { "@_Name": "H", "@_DataType": "Enum", "@_Ref": "Validity" },
      "N",
      common
    );
    assert.deepStrictEqual(shared.enums, [{ name: "VALID", value: "1" }]);
    // A Ref that resolves to nothing leaves the field stateless rather than
    // guessing - TestPit reports the dangling reference when it loads the file.
    const dangling = parseField(
      { "@_Name": "I", "@_DataType": "Enum", "@_Ref": "Nope" },
      "N",
      common
    );
    assert.deepStrictEqual(dangling.enums, []);
  });

  it("parseField marks a reserved field, stated or named", () => {
    assert.strictEqual(parseField({ "@_Name": "Pad", "@_Used": "false" }, "M").used, false);
    assert.strictEqual(parseField({ "@_Name": "SpareCapacity", "@_Used": "true" }, "M").used, true);
    // No Used: the name rule TestPit has always guessed with is the fallback.
    assert.strictEqual(parseField({ "@_Name": "Reserved1" }, "M").used, false);
    assert.strictEqual(parseField({ "@_Name": "FutureSpare" }, "M").used, false);
    assert.strictEqual(parseField({ "@_Name": "Course" }, "M").used, undefined);
  });

  it("renderConnection renders '... more' when fields > 12", () => {
    // Build a fake connection and index with a message with 15 fields
    const conn: any = { fullName: "429_X", bus: "429" };
    const index: any = { messages: new Map(), messagesByBus: new Map() };
    const msg: any = { name: "M", type: "BNR", fields: [] };
    for (let i = 0; i < 15; i++) msg.fields.push({ name: `F${i}` });
    index.messages.set("M", msg);
    conn.messageName = "M";
    const md = renderConnection(conn, index);
    const out = (md as any).value || "";
    assert.ok(out.includes("… 3 more") || out.includes("more"));
  });
});
