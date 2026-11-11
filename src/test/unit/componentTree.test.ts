import * as assert from "assert";
import * as path from "path";
import {
  buildComponentTree,
  childrenOf,
  compareNames,
  fieldSummary,
  filterTerms,
  findConnectionNode,
  nodeId,
  treeState,
} from "../../lib/componentTree";
import {
  COMPONENT_TAG_PATTERN,
  FieldDef,
  createEmptyIndex,
  parseConfigFolder,
} from "../../lib/xmlIndex";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "src", "test", "fixtures");
const RNE = parseConfigFolder(path.join(FIXTURES, "config"));
const NEOCAS = parseConfigFolder(path.join(FIXTURES, "config", "neocas"));

const field = (extra: Partial<FieldDef>): FieldDef => ({
  name: "F",
  parentMessage: "M",
  ...extra,
});

describe("componentTree — model", () => {
  it("groups every connection of the index under its bus, in a fixed bus order", () => {
    const tree = buildComponentTree(RNE);
    assert.deepStrictEqual(
      tree.buses.map((b) => b.bus),
      ["429", "1553", "DIS", "Mem", "VORILS"]
    );
    assert.strictEqual(tree.totalConnections, RNE.connections.size);
    assert.strictEqual(tree.connectionCount, RNE.connections.size);
    const listed = tree.buses.flatMap((b) => b.connections);
    assert.strictEqual(listed.length, RNE.connections.size);
    for (const bus of tree.buses) {
      for (const conn of bus.connections) {
        assert.strictEqual(conn.bus, bus.bus);
        assert.strictEqual(RNE.connections.get(conn.name), conn.connection);
        // Every listed name is a component tag name a script can write.
        assert.ok(COMPONENT_TAG_PATTERN.test(conn.name), conn.name);
      }
    }
  });

  it("puts External Data last and labels the buses", () => {
    const tree = buildComponentTree(NEOCAS);
    assert.deepStrictEqual(
      tree.buses.map((b) => [b.bus, b.label]),
      [
        ["429", "ARINC 429"],
        ["Mem", "Memory"],
        ["ED", "External Data"],
      ]
    );
  });

  it("sorts connections by name within a bus", () => {
    const tree = buildComponentTree(RNE);
    for (const bus of tree.buses) {
      const names = bus.connections.map((c) => c.name);
      assert.deepStrictEqual(names, names.slice().sort(compareNames));
    }
    const mem = tree.buses.find((b) => b.bus === "Mem");
    assert.deepStrictEqual(
      mem?.connections.map((c) => c.name).slice(0, 4),
      [
        "Mem_MBPBITStatus",
        "Mem_RNEGeneralWriteLedStatus",
        "Mem_RNEGeneralWritePSAlive",
        "PART_HSI_RNEGeneralWriteLedStatus",
      ]
    );
  });

  it("lists a connection's fields in the order the config declares them", () => {
    const tree = buildComponentTree(RNE);
    const conn = findConnectionNode(tree, "429_L100SelectedCourseBNR_input1");
    assert.ok(conn?.message);
    assert.deepStrictEqual(
      conn.fields.map((f) => f.name),
      conn.message.fields.map((f) => f.name)
    );
    assert.strictEqual(conn.fieldCount, conn.message.fields.length);
    assert.strictEqual(conn.description, "SelectedCourseBNR · 5 fields");
    for (const f of conn.fields) {
      assert.strictEqual(f.connectionName, conn.name);
      assert.strictEqual(f.message, conn.message);
    }
  });

  it("keeps a connection whose message is not in the index, with no fields", () => {
    const conn = findConnectionNode(buildComponentTree(NEOCAS), "429_L164RadioAltitude");
    assert.ok(conn);
    assert.strictEqual(conn.message, undefined);
    assert.deepStrictEqual(conn.fields, []);
    assert.strictEqual(conn.description, "");
  });

  it("resolves a message within the connection's own bus", () => {
    const index = createEmptyIndex();
    index.connections.set("429_X", { fullName: "429_X", bus: "429", rawName: "X", messageName: "X" });
    index.connections.set("Mem_X", { fullName: "Mem_X", bus: "Mem", rawName: "X", messageName: "X" });
    const a429 = { name: "X", bus: "429" as const, fields: [field({ name: "A", parentMessage: "X" })] };
    const mem = { name: "X", bus: "Mem" as const, fields: [field({ name: "B", parentMessage: "X" })] };
    index.messagesByBus.set("429:X", a429);
    index.messagesByBus.set("Mem:X", mem);
    index.messages.set("X", mem);
    const tree = buildComponentTree(index);
    assert.deepStrictEqual(findConnectionNode(tree, "429_X")?.fields.map((f) => f.name), ["A"]);
    assert.deepStrictEqual(findConnectionNode(tree, "Mem_X")?.fields.map((f) => f.name), ["B"]);
  });

  it("walks bus → connection → field with childrenOf, and gives unique ids", () => {
    const tree = buildComponentTree(RNE);
    const ids = new Set<string>();
    let count = 0;
    const walk = (nodes: ReturnType<typeof childrenOf>): void => {
      for (const node of nodes) {
        ids.add(nodeId(node));
        count++;
        walk(childrenOf(node));
      }
    };
    walk(tree.buses);
    assert.strictEqual(ids.size, count);
    const dis = tree.buses.find((b) => b.bus === "DIS");
    assert.ok(dis);
    assert.strictEqual(childrenOf(dis), dis.connections);
    assert.strictEqual(childrenOf(dis.connections[0]), dis.connections[0].fields);
    assert.deepStrictEqual(childrenOf(dis.connections[0].fields[0]), []);
  });
});

describe("componentTree — field summary", () => {
  it("joins type, range, resolution, unit and enum count", () => {
    assert.strictEqual(
      fieldSummary(
        field({ dataType: "UInt16", minValue: "0", maxValue: "65535", resolution: "1", unit: "nm" })
      ),
      "UInt16 · 0 … 65535 · step 1 · nm"
    );
    assert.strictEqual(
      fieldSummary(
        field({ dataType: "Enum8", enums: [{ name: "A", value: "0" }, { name: "B", value: "1" }] })
      ),
      "Enum8 · 2 enum values"
    );
    assert.strictEqual(
      fieldSummary(field({ enums: [{ name: "A", value: "0" }] })),
      "1 enum value"
    );
  });

  it("leaves out what the index does not hold, including '-' placeholders", () => {
    assert.strictEqual(fieldSummary(field({})), "");
    assert.strictEqual(
      fieldSummary(field({ dataType: "BNR", minValue: "-", maxValue: "-", unit: "-", resolution: "-" })),
      "BNR"
    );
    assert.strictEqual(fieldSummary(field({ minValue: "1" })), "min 1");
    assert.strictEqual(fieldSummary(field({ maxValue: "9" })), "max 9");
  });

  it("marks a field the config flags as not used", () => {
    assert.strictEqual(fieldSummary(field({ dataType: "UInt32", used: false })), "UInt32 · reserved");
    assert.strictEqual(fieldSummary(field({ dataType: "UInt32", used: true })), "UInt32");
  });

  it("is what a field node of the fixtures shows", () => {
    const conn = findConnectionNode(buildComponentTree(RNE), "1553_TACANDMEOutput1");
    const range = conn?.fields.find((f) => f.name === "Range.RangeValue");
    assert.strictEqual(range?.description, "UInt16 · 0 … 65535 · step 1 · nm");
  });
});

describe("componentTree — filter", () => {
  it("splits a search string into lower-cased terms", () => {
    assert.deepStrictEqual(filterTerms("  429  Course "), ["429", "course"]);
    assert.deepStrictEqual(filterTerms(""), []);
    assert.deepStrictEqual(filterTerms("   "), []);
    assert.deepStrictEqual(filterTerms(undefined), []);
  });

  it("shows everything for an empty or blank filter", () => {
    const all = buildComponentTree(RNE);
    assert.deepStrictEqual(buildComponentTree(RNE, ""), all);
    assert.deepStrictEqual(buildComponentTree(RNE, "   "), all);
  });

  it("matches connection names case-insensitively and keeps all their fields", () => {
    const tree = buildComponentTree(RNE, "selectedcoursebnr");
    assert.deepStrictEqual(tree.buses.map((b) => b.bus), ["429"]);
    assert.strictEqual(tree.connectionCount, 2);
    assert.strictEqual(tree.totalConnections, RNE.connections.size);
    for (const conn of tree.buses[0].connections) {
      assert.strictEqual(conn.fields.length, conn.fieldCount);
    }
  });

  it("requires every term", () => {
    const tree = buildComponentTree(RNE, "part hsi alive");
    assert.deepStrictEqual(
      tree.buses.flatMap((b) => b.connections.map((c) => c.name)),
      ["PART_HSI_RNEGeneralWritePSAlive"]
    );
  });

  it("matches a field name and then shows only the matching fields", () => {
    const tree = buildComponentTree(RNE, "RangeValid");
    const conns = tree.buses.flatMap((b) => b.connections);
    assert.ok(conns.length > 0);
    for (const conn of conns) {
      assert.deepStrictEqual(conn.fields.map((f) => f.name), ["DataValidity.RangeValid"]);
      assert.strictEqual(conn.fieldCount, 3);
    }
  });

  it("matches the name of an enum value of a field", () => {
    const sdi = findConnectionNode(buildComponentTree(RNE), "429_L100SelectedCourseBNR_input1")
      ?.fields.find((f) => f.name === "SDI");
    const enumName = sdi?.field.enums?.[0].name;
    assert.ok(enumName);
    const tree = buildComponentTree(RNE, enumName);
    const conn = findConnectionNode(tree, "429_L100SelectedCourseBNR_input1");
    assert.ok(conn?.fields.some((f) => f.name === "SDI"));
  });

  it("matches the message name of a connection", () => {
    const index = createEmptyIndex();
    index.connections.set("429_L1_in", { fullName: "429_L1_in", bus: "429", rawName: "L1_in", messageName: "Altitude" });
    index.messagesByBus.set("429:Altitude", { name: "Altitude", bus: "429", fields: [field({})] });
    assert.strictEqual(buildComponentTree(index, "altitude").connectionCount, 1);
  });

  it("drops buses with nothing left and reports no match", () => {
    const tree = buildComponentTree(RNE, "no-such-thing-anywhere");
    assert.deepStrictEqual(tree.buses, []);
    assert.strictEqual(tree.connectionCount, 0);
    assert.strictEqual(treeState(tree), "noMatch");
  });
});

describe("componentTree — state", () => {
  it("tells no config, empty index, no match and ok apart", () => {
    assert.strictEqual(treeState(undefined), "noConfig");
    assert.strictEqual(treeState(buildComponentTree(createEmptyIndex())), "empty");
    assert.strictEqual(treeState(buildComponentTree(createEmptyIndex(), "x")), "empty");
    assert.strictEqual(treeState(buildComponentTree(RNE, "zzzzzz")), "noMatch");
    assert.strictEqual(treeState(buildComponentTree(RNE)), "ok");
  });
});

describe("componentTree — compareNames", () => {
  it("orders digit runs by value and ignores case", () => {
    assert.deepStrictEqual(
      ["429_in10", "429_in2", "429_In1", "1553_a"].sort(compareNames),
      ["429_In1", "429_in2", "429_in10", "1553_a"]
    );
  });

  it("is deterministic for names differing only in case", () => {
    assert.notStrictEqual(compareNames("abc", "ABC"), 0);
    assert.strictEqual(compareNames("abc", "abc"), 0);
    assert.strictEqual(compareNames("ABC", "abc"), -compareNames("abc", "ABC"));
  });
});
