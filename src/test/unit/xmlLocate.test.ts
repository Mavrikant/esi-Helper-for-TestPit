import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  XmlIndex,
  parseConfigFiles,
  parseConfigFolder,
} from "../../lib/xmlIndex";
import {
  DefinitionTarget,
  XmlLocation,
  definitionLinkMarkdown,
  definitionUri,
  findDefinitionTargets,
  loadXmlTree,
  locateInXml,
  resolveDefinition,
  resolveDefinitions,
  scanXml,
  sourceFileOf,
} from "../../lib/xmlLocate";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "src", "test", "fixtures");
const V1 = path.join(FIXTURES, "config");
const V2 = path.join(FIXTURES, "config_v2");
const NEOCAS = path.join(V1, "neocas");

/** The line a location points at, and the text under its range. */
function at(loc: XmlLocation): { lineText: string; name: string; file: string } {
  const lines = fs.readFileSync(loc.file, "utf-8").split(/\r?\n/);
  const lineText = lines[loc.line];
  return {
    lineText,
    name: lineText.slice(loc.character, loc.character + loc.length),
    file: path.basename(loc.file),
  };
}

/** Cursor on the first occurrence of `needle` in `text`. */
function cursor(text: string, needle: string, offset = 1): [number, number] {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i].indexOf(needle);
    if (col !== -1) {
      return [i, col + offset];
    }
  }
  throw new Error(`needle not in text: ${needle}`);
}

function define(index: XmlIndex, text: string, needle: string): XmlLocation[] {
  const [line, col] = cursor(text, needle);
  const query = findDefinitionTargets(index, text, line, col);
  return query ? resolveDefinitions(query.targets) : [];
}

describe("xmlIndex source files", () => {
  it("stamps connections and messages with the file they came from", () => {
    const idx = parseConfigFolder(V1);
    assert.strictEqual(
      idx.connections.get("429_L100SelectedCourseBNR_input1")?.sourceFile,
      path.join(V1, "MessageConfig_Test.xml")
    );
    assert.strictEqual(
      idx.messagesByBus.get("429:SelectedCourseBNR")?.sourceFile,
      path.join(V1, "A429MessageFields.xml")
    );
    const part = idx.connections.get("PART_HSI_RNEGeneralWritePSAlive");
    assert.strictEqual(part?.sourceFile, path.join(V1, "MemoryPorts.xml"));
    assert.strictEqual(part?.partition, "HSI");
    assert.strictEqual(idx.connections.get("Mem_RNEGeneralWritePSAlive")?.partition, "HSI");
    assert.strictEqual(
      idx.connections.get("DIS_PowerOnOff")?.sourceFile,
      path.join(V1, "DiscreteSignals.xml")
    );
  });

  it("stamps by role in parseConfigFiles", () => {
    const idx = parseConfigFiles({ ed: path.join(NEOCAS, "EDMessageFields.xml") });
    assert.strictEqual(
      idx.connections.get("ED_Type1")?.sourceFile,
      path.join(NEOCAS, "EDMessageFields.xml")
    );
  });
});

describe("scanXml", () => {
  it("keeps offsets for attributes and child text, skipping comments / PI / CDATA", () => {
    const xml =
      '<?xml version="1.0"?>\n<!-- <Fake Name="no"/> -->\n<A Name = \'x&amp;y\'>\n  <B>  hi </B><![CDATA[<C/>]]><D/>\n</A>';
    const tree = scanXml(xml);
    assert.strictEqual(tree.root.children.length, 1);
    const a = tree.root.children[0];
    assert.strictEqual(a.tag, "A");
    assert.strictEqual(a.attrs[0].value, "x&y");
    assert.strictEqual(xml.slice(a.attrs[0].valueStart, a.attrs[0].valueStart + a.attrs[0].rawLength), "x&amp;y");
    assert.deepStrictEqual(a.children.map((c) => c.tag), ["B", "D"]);
    assert.strictEqual(a.children[0].text, "hi");
    assert.strictEqual(xml[a.children[0].textStart as number], "h");
  });

  it("does not throw on malformed input", () => {
    for (const xml of ["", "<", "<A", '<A Name="x', "<A><B></A></C>", "<!-- open", "plain"]) {
      assert.doesNotThrow(() => scanXml(xml));
    }
  });

  it("drops a byte-order mark so columns match the editor", () => {
    const pos = locateInXml('﻿<Root><Devices><Device Type="A429"><Connection Name="X"/></Device></Devices></Root>', {
      kind: "connection",
      conn: { fullName: "429_X", bus: "429", rawName: "X" },
    });
    assert.deepStrictEqual(pos, { line: 0, character: 53, length: 1, exact: true });
  });
});

describe("xmlLocate — format 1 (RNE-style)", () => {
  const idx = parseConfigFolder(V1);

  it("tag name → the cable connection and its message", () => {
    const text = "[429_L100SelectedCourseBNR_input1]\nSDI = INSTALLATION_NUMBER_ONE\n[/429_L100SelectedCourseBNR_input1]";
    const locs = define(idx, text, "429_L100");
    assert.strictEqual(locs.length, 2);
    assert.deepStrictEqual(
      [at(locs[0]).file, at(locs[0]).name, locs[0].kind],
      ["MessageConfig_Test.xml", "L100SelectedCourseBNR_input1", "connection"]
    );
    assert.deepStrictEqual(
      [at(locs[1]).file, at(locs[1]).name, locs[1].kind],
      ["A429MessageFields.xml", "SelectedCourseBNR", "message"]
    );
    assert.ok(at(locs[1]).lineText.includes("<Name>SelectedCourseBNR</Name>"));
    // Same answer from the closing tag.
    assert.strictEqual(define(idx, text, "/429_L100").length, 2);
  });

  it("field name → the <Field> (child-element <FieldName>)", () => {
    const text = "[429_L100SelectedCourseBNR_input1]\nCourse = 12\n[/429_L100SelectedCourseBNR_input1]";
    const [loc] = define(idx, text, "Course =");
    assert.strictEqual(at(loc).lineText.trim(), "<FieldName>Course</FieldName>");
    assert.strictEqual(at(loc).name, "Course");
    assert.strictEqual(loc.exact, true);
  });

  it("enum value → the <Enum> entry inside the field", () => {
    const text = "[429_L100SelectedCourseBNR_input1]\nSDI = INSTALLATION_NUMBER_ONE\n[/429_L100SelectedCourseBNR_input1]";
    const [loc] = define(idx, text, "INSTALLATION_NUMBER_ONE");
    assert.strictEqual(at(loc).name, "INSTALLATION_NUMBER_ONE");
    assert.ok(at(loc).lineText.includes("<Enum Name="));
    assert.strictEqual(loc.kind, "enum");
  });

  it("1553 dotted field → the <Field> inside its <Word>", () => {
    const text = "[1553_TACANDMEOutput1]\nDataValidity.RangeValid = VALID\n[/1553_TACANDMEOutput1]";
    const [field] = define(idx, text, "DataValidity.RangeValid");
    assert.strictEqual(at(field).name, "RangeValid");
    const [value] = define(idx, text, "VALID");
    assert.strictEqual(at(value).name, "VALID");
    // RangeValid's own VALID, not TransmitReceive's block above it.
    assert.ok(value.line > field.line);
  });

  it("discrete: the tag and its synthesized `value` field land on the message, '#' stripped", () => {
    const text = "[DIS_TAStatus1]\nvalue = TA_ON\n[/DIS_TAStatus1]";
    const tag = define(idx, text, "DIS_TAStatus1");
    assert.strictEqual(tag.length, 1); // connection and message are one place
    assert.strictEqual(at(tag[0]).name, "TAStatus#1");
    const [field] = define(idx, text, "value");
    assert.strictEqual(at(field).name, "TAStatus#1");
    assert.strictEqual(field.exact, true);
    const [value] = define(idx, text, "TA_ON");
    assert.strictEqual(at(value).name, "TA_ON");
  });

  it("memory port: PART_ and Mem_ land on the port, fields in its inline message", () => {
    const text = "[PART_TEST_MBPBITStatus]\nValue = SUCCESS\n[/PART_TEST_MBPBITStatus]\n[Mem_RNEGeneralWriteLedStatus]\nLedStatus = 1\n[/Mem_RNEGeneralWriteLedStatus]";
    const tag = define(idx, text, "PART_TEST");
    assert.strictEqual(at(tag[0]).name, "MBPBITStatus");
    assert.ok(at(tag[0]).lineText.includes("<Port"));
    assert.ok(at(tag[1]).lineText.includes("<Message"));
    const [field] = define(idx, text, "Value =");
    assert.ok(at(field).lineText.includes('Type = "Enum"'));
    const [value] = define(idx, text, "SUCCESS");
    assert.strictEqual(at(value).name, "SUCCESS");
    const [led] = define(idx, text, "LedStatus =");
    assert.strictEqual(at(led).name, "LedStatus");
  });

  it("VORILS: canonical and other unit numbers land on the message", () => {
    const text = "[VORILS2_VORILSDataMsg]\nVORILSFrequency = 1\nVORLOCStatus = FAIL\n[/VORILS2_VORILSDataMsg]";
    const [tag] = define(idx, text, "VORILS2_");
    assert.strictEqual(at(tag).name, "VORILSDataMsg");
    // The field of THIS message, not the same-named one in VORILSCommandMsg.
    const [field] = define(idx, text, "VORILSFrequency");
    assert.ok(field.line > tag.line);
    assert.strictEqual(at(field).name, "VORILSFrequency");
    assert.strictEqual(at(define(idx, text, "FAIL")[0]).name, "FAIL");
    assert.strictEqual(define(idx, "[VORILS1_VORILSDataMsg]", "VORILS1_").length, 1);
  });

  it("a bare component name resolves like the hover does", () => {
    const [conn] = define(idx, "see L100SelectedCourseBNR_input2 here", "L100Selected");
    assert.strictEqual(at(conn).name, "L100SelectedCourseBNR_input2");
  });
});

describe("xmlLocate — format 2 (attributes, shared enums)", () => {
  const idx = parseConfigFolder(V2);

  it("field → the <Field Name=…> attribute", () => {
    const text = "[429_L100SelectedCourseBNR_input1]\nSDI = INSTALLATION_NUMBER_ONE\n[/429_L100SelectedCourseBNR_input1]";
    const [field] = define(idx, text, "SDI");
    assert.strictEqual(at(field).name, "SDI");
    assert.ok(at(field).lineText.includes("<Field Name="));
    const tag = define(idx, text, "429_L100");
    assert.ok(at(tag[1]).lineText.includes('<Message Name="SelectedCourseBNR"'));
  });

  it("enum value of a Ref field → the entry in <Common><CommonEnums>", () => {
    const text = "[429_L100SelectedCourseBNR_input1]\nSDI = INSTALLATION_NUMBER_ONE\n[/429_L100SelectedCourseBNR_input1]";
    const [value] = define(idx, text, "INSTALLATION_NUMBER_ONE");
    assert.strictEqual(at(value).name, "INSTALLATION_NUMBER_ONE");
    assert.ok(at(value).lineText.includes("<Enum Name="));
    assert.strictEqual(value.exact, true);
  });

  it("discrete message with Ref → message for the field, shared entry for the value", () => {
    const text = "[DIS_PowerOnOff]\nvalue = POWER_ON\n[/DIS_PowerOnOff]";
    const [field] = define(idx, text, "value");
    assert.ok(at(field).lineText.includes('<Message Name="PowerOnOff"'));
    const [value] = define(idx, text, "POWER_ON");
    assert.strictEqual(at(value).name, "POWER_ON");
  });

  it("port whose <Message> leaves out its Name → the port", () => {
    const text = "[PART_TEST_MBPBITStatus]\nValue = SUCCESS\n[/PART_TEST_MBPBITStatus]";
    const tag = define(idx, text, "PART_TEST");
    assert.strictEqual(tag.length, 1);
    assert.strictEqual(at(tag[0]).name, "MBPBITStatus");
    // `Value` exists in two ports — the one in the TEST partition is meant.
    const [field] = define(idx, text, "Value =");
    assert.ok(at(field).lineText.includes('Ref="Value"'));
    assert.strictEqual(at(define(idx, text, "SUCCESS")[0]).name, "SUCCESS");
  });

  it("ignores the superseded .v1.xml beside a converted file", () => {
    assert.strictEqual(
      path.basename(idx.connections.get("DIS_PowerOnOff")?.sourceFile ?? ""),
      "DiscreteSignals.xml"
    );
  });
});

describe("xmlLocate — NEOCAS Ref forms", () => {
  const idx = parseConfigFiles({
    cable: path.join(NEOCAS, "MessageConfig_Cable.xml"),
    partition: path.join(NEOCAS, "NeoCASPorts.xml"),
    ed: path.join(NEOCAS, "EDMessageFields.xml"),
  });

  it("<Port Ref>: tag → the partition's port and the shared port's message", () => {
    const text = "[PART_HealthManager_IOHealthState_Alert]\nState = FAULTY\n[/PART_HealthManager_IOHealthState_Alert]";
    const tag = define(idx, text, "PART_Health");
    assert.strictEqual(tag.length, 2);
    assert.strictEqual(at(tag[0]).name, "IOHealthState_Alert");
    assert.ok(at(tag[0]).lineText.includes('Ref="IOHealthState"'));
    assert.ok(at(tag[1]).lineText.includes('<Message Name="IOHealthState"'));
  });

  it("field through a shared port, enum through a shared enum", () => {
    const text = "[PART_HealthManager_IOHealthState_Alert]\nState = FAULTY\n[/PART_HealthManager_IOHealthState_Alert]";
    const [field] = define(idx, text, "State =");
    assert.ok(at(field).lineText.includes('<Field Name="State"'));
    const [value] = define(idx, text, "FAULTY");
    assert.strictEqual(at(value).name, "FAULTY");
    assert.strictEqual(value.exact, true);
  });

  it("ED message, field and shared enum value", () => {
    const text = "[ED_Type1]\ntype_code = AIRCRAFT_CATEGORY_SET_D\n[/ED_Type1]";
    assert.strictEqual(at(define(idx, text, "ED_Type1")[0]).name, "Type1");
    assert.strictEqual(at(define(idx, text, "type_code")[0]).name, "type_code");
    assert.strictEqual(
      at(define(idx, text, "AIRCRAFT_CATEGORY_SET_D")[0]).name,
      "AIRCRAFT_CATEGORY_SET_D"
    );
  });

  it("cable <Connection Ref> → the connection; message file not configured → one result", () => {
    const locs = define(idx, "[429_L164RadioAltitude]", "429_L164");
    assert.strictEqual(locs.length, 1);
    assert.strictEqual(at(locs[0]).name, "L164RadioAltitude");
  });
});

describe("findDefinitionTargets — what it declines", () => {
  const idx = parseConfigFolder(V1);
  const block = (body: string): string =>
    `[429_L100SelectedCourseBNR_input1]\n${body}\n[/429_L100SelectedCourseBNR_input1]`;

  it("returns the word range for the origin", () => {
    const text = block("SDI = INSTALLATION_NUMBER_ONE");
    const q = findDefinitionTargets(idx, text, 1, 8);
    assert.deepStrictEqual(
      [q?.word, q?.line, q?.startCol, q?.endCol],
      ["INSTALLATION_NUMBER_ONE", 1, 6, 29]
    );
  });

  it("ignores %macros%, unknown words, numbers and out-of-range lines", () => {
    assert.strictEqual(findDefinitionTargets(idx, block("SDI = %SDI%"), 1, 8), undefined);
    assert.strictEqual(findDefinitionTargets(idx, block("Nope = 1"), 1, 1), undefined);
    assert.strictEqual(findDefinitionTargets(idx, block("Course = 12"), 1, 10), undefined);
    assert.strictEqual(findDefinitionTargets(idx, block("SDI = NOT_A_STATE"), 1, 8), undefined);
    assert.strictEqual(findDefinitionTargets(idx, "x", 5, 0), undefined);
    assert.strictEqual(findDefinitionTargets(idx, "a   b", 0, 2), undefined);
  });

  it("an enum value is only taken from the field being assigned", () => {
    // INSTALLATION_NUMBER_ONE is a state of SDI, not of Course.
    assert.strictEqual(
      findDefinitionTargets(idx, block("Course = INSTALLATION_NUMBER_ONE"), 1, 12),
      undefined
    );
    // A key that is no field of the message: answered when unambiguous.
    const q = findDefinitionTargets(idx, block("occurrence = INSTALLATION_NUMBER_ONE"), 1, 16);
    assert.strictEqual(q?.targets[0].kind, "enum");
  });

  it("handles CRLF documents", () => {
    const text = block("SDI = INSTALLATION_NUMBER_ONE").replace(/\n/g, "\r\n");
    assert.strictEqual(findDefinitionTargets(idx, text, 1, 8)?.targets[0].kind, "enum");
  });
});

describe("xmlLocate — fallbacks and helpers", () => {
  const idx = parseConfigFolder(V1);
  const message = idx.messagesByBus.get("429:SelectedCourseBNR")!;
  const sdi = message.fields.find((f) => f.name === "SDI")!;

  it("falls back to the enclosing definition, then the top of the file", () => {
    const xml = fs.readFileSync(message.sourceFile as string, "utf-8");
    const ghostField = { ...sdi, name: "Ghost" };
    const f = locateInXml(xml, { kind: "field", message, field: ghostField });
    const m = locateInXml(xml, { kind: "message", message });
    assert.deepStrictEqual({ ...f, exact: true }, m);
    assert.strictEqual(f.exact, false);

    const e = locateInXml(xml, { kind: "enum", message, field: sdi, enumName: "GHOST" });
    // An unknown state lands on the set of states it should have been in.
    assert.strictEqual(e.exact, false);
    assert.strictEqual(xml.split(/\r?\n/)[e.line].trim(), "<Enums>");

    assert.deepStrictEqual(
      locateInXml("<Other/>", { kind: "message", message }),
      { line: 0, character: 0, length: 0, exact: false }
    );
    assert.deepStrictEqual(
      locateInXml("not xml at all", {
        kind: "connection",
        conn: { fullName: "429_X", bus: "429", rawName: "X" },
      }),
      { line: 0, character: 0, length: 0, exact: false }
    );
  });

  it("a dangling enum Ref lands on the field", () => {
    const xml = '<A429Messages Version="2">\n<Message Name="M">\n<Field Name="F" Ref="Missing"/>\n</Message>\n</A429Messages>';
    const msg = { name: "M", bus: "429" as const, fields: [] };
    const field = { name: "F", parentMessage: "M" };
    assert.deepStrictEqual(
      locateInXml(xml, { kind: "enum", message: msg, field, enumName: "X" }),
      { line: 2, character: 13, length: 1, exact: false }
    );
  });

  it("prefers the <Connection> under the device of the connection's bus", () => {
    const xml =
      '<Root><Devices>\n<Device Type="A429"><Connection Name="Same"/></Device>\n<Device Type="1553"><Connection Name="Same"/></Device>\n</Devices></Root>';
    const pos = locateInXml(xml, {
      kind: "connection",
      conn: { fullName: "1553_Same", bus: "1553", rawName: "Same" },
    });
    assert.strictEqual(pos.line, 2);
  });

  it("resolveDefinition: no source file or unreadable file → undefined", () => {
    const target: DefinitionTarget = { kind: "message", message };
    assert.strictEqual(sourceFileOf(target), message.sourceFile);
    assert.strictEqual(
      resolveDefinition({ kind: "message", message: { ...message, sourceFile: undefined } }),
      undefined
    );
    assert.strictEqual(
      resolveDefinition({
        kind: "message",
        message: { ...message, sourceFile: path.join(V1, "does-not-exist.xml") },
      }),
      undefined
    );
    assert.strictEqual(loadXmlTree(path.join(V1, "does-not-exist.xml")), undefined);
    // Cached tree is reused while the file is unchanged.
    assert.strictEqual(
      loadXmlTree(message.sourceFile as string),
      loadXmlTree(message.sourceFile as string)
    );
  });

  it("builds an Open definition link for hover cards", () => {
    const loc = resolveDefinition({ kind: "field", message, field: sdi })!;
    const uri = definitionUri(loc);
    assert.ok(uri.startsWith("file:///"));
    assert.ok(uri.endsWith(`A429MessageFields.xml#L${loc.line + 1},${loc.character + 1}`));
    assert.strictEqual(
      definitionLinkMarkdown({ kind: "field", message, field: sdi }),
      `[Open definition](${uri})`
    );
    assert.strictEqual(
      definitionLinkMarkdown({ kind: "message", message: { ...message, sourceFile: undefined } }),
      undefined
    );
    const odd = definitionUri({ ...loc, file: path.join(V1, "a (b) c.xml") });
    assert.ok(!/[() ]/.test(odd));
  });
});
