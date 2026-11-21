import * as assert from "assert";
import * as path from "path";
import { computeInlayHints } from "../../lib/inlayHints";
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

const idx = parseConfigFolder(FIXTURE_DIR);
const OPEN = "[429_L100SelectedCourseBNR_input1]";
const CLOSE = "[/429_L100SelectedCourseBNR_input1]";
const ALL = { enumNames: true, units: true, ranges: true };

function block(...body: string[]): string {
  return [OPEN, ...body, CLOSE].join("\n");
}

function brief(text: string, opts = ALL, range?: { startLine: number; endLine: number }) {
  return computeInlayHints(text, idx, range, opts).map(
    (h) => `${h.line}:${h.character} ${h.kind} ${h.label}`
  );
}

describe("inlayHints", () => {
  it("shows the enum name after a numeric literal on an enum field", () => {
    assert.deepStrictEqual(brief(block("    SDI = 1")), [
      "1:11 enumName INSTALLATION_NUMBER_ONE",
    ]);
  });

  it("shows the unit after a numeric value of a field with a unit", () => {
    assert.deepStrictEqual(
      brief(block("    Course = 100.0"), { enumNames: true, units: true, ranges: false }),
      ["1:18 unit deg"]
    );
  });

  it("uses the default options (enum names + units, no range)", () => {
    const hints = computeInlayHints(block("    SDI = 0", "    Course = 10"), idx);
    assert.deepStrictEqual(
      hints.map((h) => h.kind),
      ["enumName", "unit"]
    );
  });

  it("adds the declared range after the unit when ranges are on", () => {
    assert.deepStrictEqual(brief(block("    Course = 100.0")), [
      "1:18 unit deg",
      "1:18 range [0..359.9]",
    ]);
  });

  it("honours each on/off option", () => {
    const text = block("    SDI = 1", "    Course = 100.0");
    assert.deepStrictEqual(
      brief(text, { enumNames: false, units: true, ranges: false }),
      ["2:18 unit deg"]
    );
    assert.deepStrictEqual(
      brief(text, { enumNames: true, units: false, ranges: false }),
      ["1:11 enumName INSTALLATION_NUMBER_ONE"]
    );
    assert.deepStrictEqual(
      brief(text, { enumNames: false, units: false, ranges: false }),
      []
    );
  });

  it("places the hint before a trailing comment and survives CRLF", () => {
    const text = block("    SDI   =   1   # one", "    Course = 5").replace(/\n/g, "\r\n");
    assert.deepStrictEqual(brief(text, { enumNames: true, units: true, ranges: false }), [
      "1:15 enumName INSTALLATION_NUMBER_ONE",
      "2:14 unit deg",
    ]);
  });

  it("is silent for symbolic enum values and numbers the table lacks", () => {
    assert.deepStrictEqual(
      brief(block("    SDI = INSTALLATION_NUMBER_ONE", "    SDI = 99", "    SDI = 1.0")),
      []
    );
  });

  it("is silent for macros, CSV refs, parameters and unknown fields", () => {
    const text = block(
      "    SDI = %SDI%",
      "    Course = %COURSE%",
      "    Course = 1%X%",
      "    Course = data.csv line:2 col:3",
      "    SDI = data.csv line:2 col:3",
      "    time = 5600",
      "    count = 1",
      "    Nope = 1",
      "    Course = 10-20",
      "    Course = 0x10",
      "    # Course = 10"
    );
    assert.deepStrictEqual(brief(text), []);
  });

  it("is silent outside a component block and for unknown components", () => {
    const text = [
      "SDI = 1",
      "[STEP INPUTS]",
      "    Course = 10",
      "    [429_NoSuchConnection]",
      "        SDI = 1",
      "    [/429_NoSuchConnection]",
      "[/STEP INPUTS]",
    ].join("\n");
    assert.deepStrictEqual(brief(text), []);
  });

  it("is silent inside definition blocks", () => {
    for (const def of ["TEST DEFINITION", "STEP DEFINITION"]) {
      const text = [`[${def}]`, OPEN, "    SDI = 1", CLOSE, `[/${def}]`].join("\n");
      assert.deepStrictEqual(brief(text), [], def);
    }
  });

  it("never treats a one-liner [NAME/] as an open block", () => {
    const text = [
      "[429_L100SelectedCourseBNR_input1/]",
      "SDI = 1",
      OPEN,
      "    [429_L100SelectedCourseBNR_input2/]",
      "    SDI = 1",
      CLOSE,
      "SDI = 1",
    ].join("\n");
    assert.deepStrictEqual(brief(text), ["4:11 enumName INSTALLATION_NUMBER_ONE"]);
  });

  it("only returns hints inside the requested line range, with correct scope", () => {
    const text = block("    SDI = 1", "    Course = 2", "    SDI = 0");
    assert.deepStrictEqual(brief(text, ALL, { startLine: 3, endLine: 3 }), [
      "3:11 enumName INSTALLATION_NUMBER_ALL_CALL",
    ]);
    assert.deepStrictEqual(brief(text, ALL, { startLine: 50, endLine: 60 }), []);
  });

  it("returns nothing without an index", () => {
    assert.deepStrictEqual(computeInlayHints(block("    SDI = 1"), undefined), []);
  });

  it("skips placeholder units, reserved fields and untrustworthy ranges", () => {
    const fields = [
      { name: "A", unit: "-", minValue: "0", maxValue: "0", parentMessage: "M" },
      { name: "B", unit: "kt", used: false, parentMessage: "M" },
      { name: "C", unit: "kt", minValue: "-", maxValue: "-", parentMessage: "M" },
      {
        name: "D",
        enums: [
          { name: "X", value: "2" },
          { name: "Y", value: "2" },
          { name: "Z", value: "ff" },
        ],
        unit: "kt",
        parentMessage: "M",
      },
    ];
    const fake = {
      connections: new Map(),
      messages: new Map(),
      messagesByBus: new Map(),
      resolveConnectionMessage: () => ({ name: "M", bus: "429" as const, fields }),
    };
    const text = ["[429_M]", "A = 1", "B = 1", "C = 1", "D = 2", "[/429_M]"].join("\n");
    assert.deepStrictEqual(
      computeInlayHints(text, fake, undefined, ALL).map((h) => `${h.line} ${h.kind} ${h.label}`),
      ["3 unit kt", "4 enumName X | Y"]
    );
  });
});
