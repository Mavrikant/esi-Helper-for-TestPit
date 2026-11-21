import * as assert from "assert";
import {
  hasOwnParameterDoc,
  keywordHoverAt,
  parameterDoc,
  renderParameterDoc,
  sectionDoc,
} from "../../lib/keywordDocs";
import { MATCH_VALUES, PARAMETER_FIELDS } from "../../lib/componentValidator";
import {
  RESERVED_STEP_SECTIONS,
  SEC_EXTERNAL_VERIFY,
  SEC_INCLUDE,
  SEC_MANUAL_VERIFY,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
  SEC_VARIABLES,
} from "../../lib/sectionNames";

const SCRIPT_LINES = [
  "[VARIABLES]", // 0
  "    %T% = 10", // 1
  "[/VARIABLES]", // 2
  "[TEST STEPS]", // 3
  "    [STEP 10]", // 4
  "        [STEP DEFINITION]", // 5
  "            time = prose, not a parameter", // 6
  "        [/STEP DEFINITION]", // 7
  "        [STEP INPUTS]", // 8
  "            [429_L100_input1]", // 9
  "                time = 100", // 10
  "                Course = 5", // 11
  "            [/429_L100_input1]", // 12
  "        [/STEP INPUTS]", // 13
  "        [STEP OUTPUTS]", // 14
  "            [DIS_Out1]", // 15
  "                match      = any", // 16
  "                occurrence = %T%", // 17
  "                value      = HIGH", // 18
  "                validity   = 1", // 19
  "            [/DIS_Out1]", // 20
  "            [STEP DUMP/]", // 21
  "            [[MANUAL_VERIFY]]", // 22
  "            [/MANUAL_VERIFY]", // 23
  "        [/STEP OUTPUTS]", // 24
  "    [/STEP 10]", // 25
  "[/TEST STEPS]", // 26
];
const SCRIPT = SCRIPT_LINES.join("\r\n");

/** Hover with the cursor on the first occurrence of `needle` in `line`. */
function at(line: number, needle: string, offset = 0) {
  const col = SCRIPT_LINES[line].indexOf(needle);
  assert.ok(col >= 0, `'${needle}' not on line ${line}`);
  return keywordHoverAt(SCRIPT, line, col + offset);
}

describe("keywordDocs", () => {
  describe("parameterDoc", () => {
    it("has an entry of its own for every PARAMETER_FIELDS key", () => {
      for (const name of PARAMETER_FIELDS) {
        assert.ok(hasOwnParameterDoc(name), `no doc for '${name}'`);
        assert.ok(parameterDoc(name));
      }
    });

    it("knows nothing about a non-parameter — including 'value'", () => {
      assert.strictEqual(parameterDoc("value"), undefined);
      assert.strictEqual(parameterDoc("Course"), undefined);
      assert.strictEqual(parameterDoc("toString"), undefined);
    });

    it("match lists exactly the accepted values and the refusal rule", () => {
      const md = renderParameterDoc("match", parameterDoc("match")!);
      for (const v of MATCH_VALUES) {
        assert.ok(md.includes(`\`${v}\` — `), v);
      }
      assert.ok(!md.includes("accepted value"), "a match value lacks its description");
      assert.match(md, /output blocks only/);
      assert.match(md, /v1\.3\.6\.15/);
      assert.match(md, /refuses any other value/);
      assert.match(md, /%macro%/);
    });

    it("occurrence states its grammar, not a meaning", () => {
      const md = renderParameterDoc("occurrence", parameterDoc("occurrence")!);
      assert.match(md, /`ALL`/);
      assert.match(md, /optional `<` or `>`/);
      assert.match(md, /output blocks only/);
    });

    it("a parameter known only by name gets only its class", () => {
      const doc = parameterDoc("parity")!;
      assert.strictEqual(doc.summary, "TestPit parameter — bus-specific");
      assert.strictEqual(doc.notes.length, 1);
      assert.match(doc.notes[0], /does not check its value/);
      assert.match(parameterDoc("synchronize")!.summary, /output blocks only/);
    });
  });

  describe("sectionDoc", () => {
    it("covers every structural section name", () => {
      const names = [
        SEC_VARIABLES,
        SEC_INCLUDE,
        SEC_TEST_DEFINITION,
        SEC_TEST_STEPS,
        SEC_MANUAL_VERIFY,
        SEC_EXTERNAL_VERIFY,
        ...RESERVED_STEP_SECTIONS,
      ];
      for (const name of names) {
        assert.ok(sectionDoc(name), `no doc for [${name}]`);
      }
    });

    it("describes any [STEP <id>] as a step, GET_DUMP by its own entry", () => {
      assert.strictEqual(sectionDoc("STEP 10")!.title, "[STEP 10]");
      assert.match(sectionDoc("STEP 10")!.summary, /test step/);
      assert.match(sectionDoc("STEP GET_DUMP")!.summary, /memory dump/);
      assert.strictEqual(sectionDoc("STEP"), undefined);
    });

    it("writes the one-liner with its slash", () => {
      assert.strictEqual(sectionDoc("STEP DUMP")!.title, "[STEP DUMP/]");
    });

    it("says where a section belongs and what is not valid in it", () => {
      const inputs = sectionDoc("STEP INPUTS")!.notes.join("\n");
      assert.match(inputs, /Belongs in: a `\[STEP <id>\]`/);
      assert.match(inputs, /A708/);
      assert.match(inputs, /`occurrence`, `synchronize`, `match`/);
      assert.match(sectionDoc("MANUAL_VERIFY")!.notes.join("\n"), /STEP OUTPUTS/);
    });

    it("has nothing for a component tag or an unknown name", () => {
      assert.strictEqual(sectionDoc("429_L100_input1"), undefined);
      assert.strictEqual(sectionDoc("WHATEVER"), undefined);
    });
  });

  describe("keywordHoverAt", () => {
    it("section tag: the whole tag is the range, open and close alike", () => {
      const open = at(8, "STEP INPUTS", 6)!;
      assert.strictEqual(open.kind, "section");
      assert.strictEqual(open.name, "STEP INPUTS");
      assert.strictEqual(
        SCRIPT_LINES[8].slice(open.startCol, open.endCol),
        "[STEP INPUTS]"
      );
      const close = at(13, "/STEP INPUTS")!;
      assert.strictEqual(close.markdown, open.markdown);
      assert.strictEqual(at(4, "STEP 10")!.name, "STEP 10");
    });

    it("section tag: one-liner and a repaired shape are read by parseSectionTag", () => {
      assert.match(at(21, "STEP DUMP")!.markdown, /\[STEP DUMP\/\]/);
      assert.strictEqual(at(22, "MANUAL_VERIFY")!.name, "MANUAL_VERIFY");
    });

    it("section tag: silent on a component tag and outside the brackets", () => {
      assert.strictEqual(at(9, "429_"), undefined);
      assert.strictEqual(keywordHoverAt(SCRIPT, 8, 2), undefined);
    });

    it("parameter key inside a component block", () => {
      const h = at(16, "match", 2)!;
      assert.strictEqual(h.kind, "parameter");
      assert.strictEqual(SCRIPT_LINES[16].slice(h.startCol, h.endCol), "match");
      assert.match(h.markdown, /\*\*`match`\*\*/);
      assert.strictEqual(at(10, "time")!.name, "time");
      assert.strictEqual(at(19, "validity")!.name, "validity");
      // A %macro% value changes nothing: the card is about the key.
      assert.strictEqual(at(17, "occurrence")!.name, "occurrence");
    });

    it("parameter: only on the key, not the value or the '='", () => {
      assert.strictEqual(at(16, "any"), undefined);
      assert.strictEqual(at(16, "="), undefined);
      assert.strictEqual(at(16, "match", 5), undefined);
    });

    it("parameter: silent outside a component block", () => {
      assert.strictEqual(at(6, "time"), undefined);
    });

    it("silent on a data field and on 'value'", () => {
      assert.strictEqual(at(11, "Course"), undefined);
      assert.strictEqual(at(18, "value"), undefined);
    });

    it("silent when the message really has a field of that name", () => {
      const col = SCRIPT_LINES[10].indexOf("time");
      const seen: string[] = [];
      const h = keywordHoverAt(SCRIPT, 10, col, {
        isRealField: (block, key) => {
          seen.push(`${block}.${key}`);
          return true;
        },
      });
      assert.strictEqual(h, undefined);
      assert.deepStrictEqual(seen, ["429_L100_input1.time"]);
      assert.ok(keywordHoverAt(SCRIPT, 10, col, { isRealField: () => false }));
    });

    it("tolerates an out-of-range line", () => {
      assert.strictEqual(keywordHoverAt(SCRIPT, 99, 0), undefined);
      assert.strictEqual(keywordHoverAt(SCRIPT, -1, 0), undefined);
    });
  });
});
