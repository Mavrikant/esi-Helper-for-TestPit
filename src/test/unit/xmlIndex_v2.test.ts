import * as assert from "assert";
import * as path from "path";
import { parseConfigFolder } from "../../lib/xmlIndex";
import type { FieldDef, MessageDef, XmlIndex } from "../../lib/xmlIndex";

/**
 * Configuration format 2 (TestPit v1.3.6.19) states one ATTRIBUTE per value where
 * format 1 stated one child element, drops the <Fields> and <Enums> wrappers,
 * shares repeated states through <Common><CommonEnums> + Ref, and says Used
 * outright instead of leaving it to be guessed from a field's name.
 *
 * Both formats are read. The two fixture folders are the same configurations in
 * the two shapes: `config_v2` was produced from `config` by TestPit's own
 * converter, which verifies that the file it writes loads to an identical
 * configuration -
 *
 *     python Source/Utilities/convert_config_v2.py --in-place <copy of config>
 *
 * so an index built from either folder has to agree, and the tests below say
 * exactly where conversion is allowed to lose something.
 */

const fixtures = (name: string) =>
  path.resolve(__dirname, "..", "..", "..", "src", "test", "fixtures", name);

const V1 = parseConfigFolder(fixtures("config"));
const V2 = parseConfigFolder(fixtures("config_v2"));
const V1_NEOCAS = parseConfigFolder(fixtures("config/neocas"));
const V2_NEOCAS = parseConfigFolder(fixtures("config_v2/neocas"));

// parseConfigFolder does not recurse, so the NEOCAS configurations (external
// data + software test ports) are a folder of their own.
const FOLDERS = [
  { name: "config", v1: V1, v2: V2 },
  { name: "config/neocas", v1: V1_NEOCAS, v2: V2_NEOCAS },
];

// The A429 label is the one field difference conversion is allowed to make:
// format 1 carries three placeholder fields covering bits 1..8 and identifies
// them by POSITION, format 2 writes a single Label field marked Used="false".
const COLLAPSED: Record<string, { droppedByV2: string[]; addedByV2: string[] }> = {
  "429:SelectedCourseBNR": {
    droppedByV2: ["Label1", "Label2", "Label3"],
    addedByV2: ["Label"],
  },
};

/** Everything about a field the extension acts on: what it is called, what it
 *  holds, where it sits, and the states it accepts. Conversion must preserve all
 *  of it. Unit, VC and a DefaultValue that only repeats the default are dropped
 *  by format 2 on purpose, and are checked one by one further down. */
function comparable(field: FieldDef) {
  return {
    name: field.name,
    dataType: field.dataType,
    startBit: field.startBit,
    size: field.size,
    enums: (field.enums ?? []).map((e) => `${e.name}=${e.value}`),
  };
}

function messageOf(index: XmlIndex, name: string): MessageDef {
  const message = index.messages.get(name);
  assert.ok(message, `expected message ${name}`);
  return message!;
}

describe("xmlIndex config format 2", () => {
  for (const folder of FOLDERS) {
    describe(`${folder.name} builds the same index in either format`, () => {
      it("registers exactly the same connections", () => {
        assert.deepStrictEqual(
          [...folder.v2.connections.keys()].sort(),
          [...folder.v1.connections.keys()].sort()
        );
      });

      it("registers exactly the same messages, on the same buses", () => {
        assert.deepStrictEqual(
          [...folder.v2.messagesByBus.keys()].sort(),
          [...folder.v1.messagesByBus.keys()].sort()
        );
        assert.ok(folder.v1.messagesByBus.size > 0, "fixture folder is empty");
      });

      it("keeps every field, with its type, position and states", () => {
        for (const [key, v1Message] of folder.v1.messagesByBus) {
          const v2Message = folder.v2.messagesByBus.get(key)!;
          const v1Fields = new Map(v1Message.fields.map((f) => [f.name, f]));
          const v2Fields = new Map(v2Message.fields.map((f) => [f.name, f]));
          for (const [name, v2Field] of v2Fields) {
            const v1Field = v1Fields.get(name);
            if (!v1Field) {
              continue; // accounted for by COLLAPSED below
            }
            assert.deepStrictEqual(
              comparable(v2Field),
              comparable(v1Field),
              `${key}.${name} differs between the two formats`
            );
          }
          const expected = COLLAPSED[key] ?? { droppedByV2: [], addedByV2: [] };
          assert.deepStrictEqual(
            [...v1Fields.keys()].filter((n) => !v2Fields.has(n)).sort(),
            expected.droppedByV2.slice().sort(),
            `${key}: fields format 2 dropped`
          );
          assert.deepStrictEqual(
            [...v2Fields.keys()].filter((n) => !v1Fields.has(n)).sort(),
            expected.addedByV2.slice().sort(),
            `${key}: fields format 2 added`
          );
        }
      });

      it("resolves every connection to the same message", () => {
        for (const name of folder.v1.connections.keys()) {
          assert.strictEqual(
            folder.v2.resolveConnectionMessage(name)?.name,
            folder.v1.resolveConnectionMessage(name)?.name,
            `${name} resolves differently`
          );
        }
      });
    });
  }

  describe("what format 2 states differently", () => {
    it("A429: reads the message encoding from Encoding, not Type", () => {
      assert.strictEqual(messageOf(V2, "SelectedCourseBNR").type, "BNR");
      assert.strictEqual(messageOf(V1, "SelectedCourseBNR").type, "BNR");
    });

    it("A429: the label placeholders become one field marked Used=false", () => {
      const label = messageOf(V2, "SelectedCourseBNR").fields.find(
        (f) => f.name === "Label"
      );
      assert.ok(label, "expected a single Label field");
      assert.strictEqual(label!.used, false);
      assert.strictEqual(label!.startBit, "1");
      assert.strictEqual(label!.size, "8");
    });

    it("A429: a field takes its states from the shared table by Ref", () => {
      const sdi = messageOf(V2, "SelectedCourseBNR").fields.find(
        (f) => f.name === "SDI"
      );
      assert.deepStrictEqual(
        sdi!.enums?.map((e) => e.name),
        ["INSTALLATION_NUMBER_ALL_CALL", "INSTALLATION_NUMBER_ONE"]
      );
    });

    it("A429: Direction, MinPeriod and MaxPeriod are gone - nothing read them", () => {
      const v2Message = messageOf(V2, "SelectedCourseBNR");
      assert.strictEqual(v2Message.direction, undefined);
      assert.strictEqual(v2Message.minPeriod, undefined);
      assert.strictEqual(v2Message.maxPeriod, undefined);
      // …and the format 1 original still reports them.
      assert.strictEqual(messageOf(V1, "SelectedCourseBNR").direction, "Output");
      assert.strictEqual(messageOf(V1, "SelectedCourseBNR").minPeriod, 45);
    });

    it("A429: a DefaultValue that only repeats the default is left out", () => {
      const v1Course = messageOf(V1, "SelectedCourseBNR").fields.find(
        (f) => f.name === "Course"
      );
      const v2Course = messageOf(V2, "SelectedCourseBNR").fields.find(
        (f) => f.name === "Course"
      );
      assert.strictEqual(v1Course!.defaultValue, "0");
      assert.strictEqual(v2Course!.defaultValue, undefined);
      // The bounds a range check runs on are still stated on both sides.
      assert.strictEqual(v2Course!.minValue, "0");
      assert.strictEqual(v2Course!.maxValue, "359.9");
      assert.strictEqual(v2Course!.resolution, "0.0055");
    });

    it("discrete: states sit on the message by Ref, and a missing width is one bit", () => {
      const signal = messageOf(V2, "PowerOnOff");
      assert.strictEqual(signal.direction, "Input");
      const value = signal.fields[0];
      assert.strictEqual(value.name, "value");
      assert.strictEqual(value.dataType, "Enum");
      // BitSize is left out of a format 2 file at 1; a format 1 file that omits
      // it means nothing of the kind, so the default is version-gated.
      assert.strictEqual(value.size, "1");
      assert.deepStrictEqual(
        value.enums?.map((e) => e.name),
        ["POWER_OFF", "POWER_ON"]
      );
    });

    it("1553: Default becomes DefaultValue, Size becomes BitSize, states come by Ref", () => {
      const field = messageOf(V2, "TACANDMEOutput1").fields.find(
        (f) => f.name === "DataValidity.TransmitReceive"
      );
      assert.ok(field, "expected DataValidity.TransmitReceive");
      assert.strictEqual(field!.defaultValue, "RECEIVE");
      assert.strictEqual(field!.size, "1");
      assert.deepStrictEqual(
        field!.enums?.map((e) => e.name),
        ["RECEIVE", "TRANSMITRECEIVE"]
      );
      // Unit was a placeholder on this bus and is dropped; the format 1 file
      // still carries it.
      const v1Range = messageOf(V1, "TACANDMEOutput1").fields.find(
        (f) => f.name === "Range.RangeValue"
      );
      const v2Range = messageOf(V2, "TACANDMEOutput1").fields.find(
        (f) => f.name === "Range.RangeValue"
      );
      assert.strictEqual(v1Range!.unit, "nm");
      assert.strictEqual(v2Range!.unit, undefined);
      // The bounds an out-of-range check runs on survive.
      assert.strictEqual(v2Range!.minValue, "0");
      assert.strictEqual(v2Range!.maxValue, "65535");
    });

    it("VOR/ILS: a field says DataType, and its states keep the <EnumDef> wrapper", () => {
      const message = messageOf(V2, "VORILSDataMsg");
      const validity = message.fields.find(
        (f) => f.name === "VOROmnibearingValidity"
      );
      assert.strictEqual(validity!.dataType, "Enum");
      assert.deepStrictEqual(
        validity!.enums?.map((e) => e.name),
        ["INVALID", "VALID"]
      );
      // A numeric field still carries its coding in a nested <Encoding>.
      const bearing = message.fields.find((f) => f.name === "VOROmnibearing");
      assert.strictEqual(bearing!.dataType, "DoubleDegree");
      assert.strictEqual(bearing!.minValue, "0.0");
      assert.strictEqual(bearing!.resolution, "0.005");
    });

    it("external data: the root is <EDRoot>, and Ref still reaches CommonEnums", () => {
      const message = messageOf(V2_NEOCAS, "Type1");
      assert.strictEqual(message.bus, "ED");
      assert.ok(V2_NEOCAS.connections.has("ED_Type1"));
      const typeCode = message.fields.find((f) => f.name === "type_code");
      assert.deepStrictEqual(
        typeCode!.enums?.map((e) => e.name),
        ["AIRCRAFT_CATEGORY_SET_A", "AIRCRAFT_CATEGORY_SET_D"]
      );
    });

    it("software test ports: a message that only repeated its port's name loses it", () => {
      // NeoCASPorts drops <Message Name> where it repeated the port's, so the
      // port's own name has to carry it - PART_<partition>_<port> must resolve
      // to the same message either way.
      const partitionPorts = [...V1_NEOCAS.connections.keys()].filter((n) =>
        n.startsWith("PART_")
      );
      assert.ok(partitionPorts.length > 0, "expected PART_ connections");
      for (const name of partitionPorts) {
        assert.strictEqual(
          V2_NEOCAS.resolveConnectionMessage(name)?.name,
          V1_NEOCAS.resolveConnectionMessage(name)?.name,
          `${name} resolves differently`
        );
      }
    });
  });

  describe("a superseded original beside a converted file", () => {
    it("is ignored: <name>.v1.xml never reaches the index", () => {
      assert.strictEqual(
        V2.connections.has("DIS_SupersededSignal"),
        false,
        "a .v1.xml twin must not be ingested"
      );
      assert.strictEqual(V2.messages.has("SupersededSignal"), false);
      // …while the file that replaced it is read as usual.
      assert.ok(V2.connections.has("DIS_PowerOnOff"));
    });
  });
});
