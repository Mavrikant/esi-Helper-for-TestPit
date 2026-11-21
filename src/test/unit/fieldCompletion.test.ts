import * as assert from "assert";
import { PARAMETER_FIELDS, validateStructure } from "../../lib/componentValidator";
import {
  assignedKeysInBlock,
  blockDirectionAt,
  COMMON_PARAMETERS,
  computeFieldNameCompletions,
  OUTPUT_ONLY_PARAMETERS,
  SKELETON_FIELD_LIMIT,
  skeletonKeys,
} from "../../lib/fieldCompletion";
import { FieldDef, MessageDef } from "../../lib/xmlIndex";

function field(name: string, extra: Partial<FieldDef> = {}): FieldDef {
  return { name, parentMessage: "Msg", ...extra };
}

const MESSAGE: MessageDef = {
  name: "Msg",
  bus: "429",
  fields: [
    field("Spare1", { used: false }),
    field("SDI"),
    field("Course", { used: true }),
    field("Pad", { used: false }),
    field("SSM"),
  ],
};

/** Completion at the `|` line of a script (that line is the cursor line). */
function at(lines: string[], message: MessageDef | "none" = MESSAGE): string[] {
  const lineIndex = lines.findIndex((l) => l.trim() === "|");
  assert.notStrictEqual(lineIndex, -1, "test needs a | line");
  const clean = lines.map((l, i) => (i === lineIndex ? l.slice(0, l.indexOf("|")) + l.slice(l.indexOf("|") + 1) : l));
  return computeFieldNameCompletions(clean, lineIndex, message === "none" ? undefined : message)
    .slice()
    .sort((a, b) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0))
    .map((e) => e.name);
}

const inSection = (section: string, ...body: string[]): string[] => [
  "[STEP 10]",
  `    [${section}]`,
  "        [429_A]",
  ...body.map((l) => "            " + l),
  "        [/429_A]",
  `    [/${section}]`,
  "[/STEP 10]",
];

describe("fieldCompletion", () => {
  describe("parameter lists", () => {
    it("only names parameters the validator knows", () => {
      for (const name of [...COMMON_PARAMETERS, ...OUTPUT_ONLY_PARAMETERS]) {
        assert.ok(PARAMETER_FIELDS.has(name), name);
      }
    });

    it("has exactly the validator's output-only parameters", () => {
      // Ask the validator itself which parameters it flags under [STEP INPUTS].
      const flagged = Array.from(PARAMETER_FIELDS).filter((name) =>
        // ([TEST STEPS] around it: the structural checks skip a fragment.)
        validateStructure(
          ["[TEST STEPS]", ...inSection("STEP INPUTS", `${name} = %X%`), "[/TEST STEPS]"].join("\n")
        ).some(
          (issue) => issue.kind === "outputFieldInInput"
        )
      );
      assert.deepStrictEqual(flagged.sort(), [...OUTPUT_ONLY_PARAMETERS].sort());
      for (const name of COMMON_PARAMETERS) {
        assert.ok(!flagged.includes(name), name);
      }
    });
  });

  describe("computeFieldNameCompletions", () => {
    it("offers parameters, then fields in config order, reserved ones last", () => {
      assert.deepStrictEqual(at(inSection("STEP OUTPUTS", "|")), [
        "time",
        "period",
        "interval",
        "count",
        "occurrence",
        "match",
        "synchronize",
        "SDI",
        "Course",
        "SSM",
        "Spare1",
        "Pad",
      ]);
    });

    it("keeps the output-only parameters out of [STEP INPUTS]", () => {
      const names = at(inSection("STEP INPUTS", "|"));
      for (const name of OUTPUT_ONLY_PARAMETERS) {
        assert.ok(!names.includes(name), name);
      }
      assert.deepStrictEqual(names.slice(0, 5), ["time", "period", "interval", "count", "SDI"]);
    });

    it("offers every parameter where the section is not known", () => {
      const names = at(["[429_A]", "|", "[/429_A]"]);
      assert.ok(names.includes("match"));
      assert.ok(names.includes("time"));
    });

    it("hides keys already assigned in the block, whatever their case", () => {
      const names = at(inSection("STEP OUTPUTS", "time = 1", "sdi = 2", "|", "SSM   = 3  # c", "Match = any"));
      for (const gone of ["time", "SDI", "SSM", "match"]) {
        assert.ok(!names.includes(gone), gone);
      }
      assert.ok(names.includes("Course"));
      assert.ok(names.includes("period"));
    });

    it("still offers the key on the cursor line and keys of other blocks", () => {
      const lines = [
        "[STEP INPUTS]",
        "[429_A]",
        "    SDI = 1",
        "[/429_A]",
        "[429_A]",
        "    Course",
        "    # SSM = 1",
        "[/429_A]",
        "[/STEP INPUTS]",
      ];
      const names = computeFieldNameCompletions(lines, 5, MESSAGE).map((e) => e.name);
      assert.ok(names.includes("Course"));
      assert.ok(names.includes("SDI"));
      assert.ok(names.includes("SSM"));
    });

    it("marks fields, and prefers a field over a parameter of the same name", () => {
      const message: MessageDef = { name: "D", bus: "DIS", fields: [field("count"), field("value")] };
      const entries = computeFieldNameCompletions(["[DIS_X]", "", "[/DIS_X]"], 1, message);
      const count = entries.filter((e) => e.name === "count");
      assert.strictEqual(count.length, 1);
      assert.strictEqual(count[0].kind, "field");
      assert.strictEqual(entries.find((e) => e.name === "time")?.kind, "parameter");
      assert.strictEqual(entries.find((e) => e.name === "value")?.field?.name, "value");
    });

    it("offers the parameters alone when the message is unknown", () => {
      assert.deepStrictEqual(at(inSection("STEP INPUTS", "|"), "none"), [...COMMON_PARAMETERS]);
    });

    it("works on CRLF text split the repo's way", () => {
      const lines = inSection("STEP INPUTS", "time = 1", "").join("\r\n").split(/\r?\n/);
      const names = computeFieldNameCompletions(lines, 4, MESSAGE).map((e) => e.name);
      assert.ok(!names.includes("time"));
      assert.ok(names.includes("SDI"));
    });
  });

  describe("assignedKeysInBlock", () => {
    it("stops at the block's close and skips nested sections and one-liners", () => {
      const lines = [
        "[429_A]",
        "    a = 1",
        "    [STEP DUMP/]",
        "    [INNER]",
        "        nested = 1",
        "    [/INNER]",
        "    B.c = 2",
        "[/429_A]",
        "after = 3",
      ];
      assert.deepStrictEqual(Array.from(assignedKeysInBlock(lines, 0, -1)).sort(), ["a", "b.c"]);
      assert.deepStrictEqual(Array.from(assignedKeysInBlock(lines, 0, 1)), ["b.c"]);
    });
  });

  describe("blockDirectionAt", () => {
    it("reads the enclosing message section", () => {
      assert.strictEqual(blockDirectionAt(inSection("STEP INPUTS"), 2), "input");
      assert.strictEqual(blockDirectionAt(inSection("STEP OUTPUTS"), 2), "output");
      assert.strictEqual(blockDirectionAt(["[429_A]", "[/429_A]"], 0), "unknown");
      // A closed [STEP INPUTS] above does not count.
      assert.strictEqual(
        blockDirectionAt(["[STEP INPUTS]", "[/STEP INPUTS]", "[STEP OUTPUTS]", "[429_A]"], 3),
        "output"
      );
    });
  });

  describe("skeletonKeys", () => {
    it("is time plus the non-reserved fields, in config order", () => {
      assert.deepStrictEqual(skeletonKeys(MESSAGE), ["time", "SDI", "Course", "SSM"]);
    });

    it("caps the field count", () => {
      const many: MessageDef = {
        name: "Big",
        bus: "Mem",
        fields: Array.from({ length: 30 }, (_v, i) => field(`F${i}`)),
      };
      const keys = skeletonKeys(many);
      assert.strictEqual(keys?.length, SKELETON_FIELD_LIMIT + 1);
      assert.deepStrictEqual(keys?.slice(0, 3), ["time", "F0", "F1"]);
      assert.deepStrictEqual(skeletonKeys(many, 2), ["time", "F0", "F1"]);
    });

    it("has nothing to add for an unknown or all-reserved message", () => {
      assert.strictEqual(skeletonKeys(undefined), undefined);
      assert.strictEqual(
        skeletonKeys({ name: "R", bus: "429", fields: [field("Spare", { used: false })] }),
        undefined
      );
    });

    it("does not list time twice", () => {
      const m: MessageDef = { name: "T", bus: "Mem", fields: [field("Time"), field("X")] };
      assert.deepStrictEqual(skeletonKeys(m), ["time", "X"]);
    });
  });
});
