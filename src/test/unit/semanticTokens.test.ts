import * as assert from "assert";
import * as path from "path";
import {
  EsiSemanticToken,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  computeSemanticTokens,
  encodeSemanticTokenModifiers,
  semanticTokenTypeIndex,
} from "../../lib/semanticTokens";
import { parseConfigFiles } from "../../lib/xmlIndex";

const DIR = path.resolve(
  __dirname, "..", "..", "..", "src", "test", "fixtures", "config", "neocas"
);

function loadIndex() {
  return parseConfigFiles({
    cable: path.join(DIR, "MessageConfig_Cable.xml"),
    partition: path.join(DIR, "NeoCASPorts.xml"),
    ed: path.join(DIR, "EDMessageFields.xml"),
  });
}

/** `line:text:type[:modifier,…]` — compact and readable in a failure diff. */
function show(text: string, tokens: EsiSemanticToken[]): string[] {
  const lines = text.split(/\r?\n/);
  return tokens.map((t) => {
    const word = lines[t.line].slice(t.start, t.start + t.length);
    const mods = t.modifiers.length ? `:${t.modifiers.join(",")}` : "";
    return `${t.line}:${word}:${t.type}${mods}`;
  });
}

function run(lines: string[], index = loadIndex(), eol = "\n"): string[] {
  const text = lines.join(eol);
  return show(text, computeSemanticTokens(text, index));
}

describe("computeSemanticTokens", () => {
  it("colours a known component, its fields, a parameter key and an enum value", () => {
    assert.deepStrictEqual(
      run([
        "[STEP 10]",
        "    [STEP INPUTS]",
        "        [ED_Type1]",
        "            time = 5",
        "            type_code = AIRCRAFT_CATEGORY_SET_A",
        "            aircraft_category = 3",
        "        [/ED_Type1]",
        "    [/STEP INPUTS]",
        "[/STEP 10]",
      ]),
      [
        "2:ED_Type1:class:defaultLibrary",
        "3:time:keyword:defaultLibrary",
        "4:type_code:property:defaultLibrary",
        "4:AIRCRAFT_CATEGORY_SET_A:enumMember:defaultLibrary",
        "5:aircraft_category:property:defaultLibrary",
        "6:ED_Type1:class:defaultLibrary",
      ]
    );
  });

  it("leaves the known modifier off what the index positively does not know", () => {
    assert.deepStrictEqual(
      run([
        "[ED_Type1]",
        "    no_such_field = 1",
        "    type_code = NOT_AN_ENUM",
        "[/ED_Type1]",
        "[ED_NoSuchMessage/]",
      ]),
      [
        "0:ED_Type1:class:defaultLibrary",
        "1:no_such_field:property",
        "2:type_code:property:defaultLibrary",
        "2:NOT_AN_ENUM:enumMember",
        "3:ED_Type1:class:defaultLibrary",
        "4:ED_NoSuchMessage:class",
      ]
    );
  });

  it("does not call a field unknown when its component cannot be resolved", () => {
    assert.deepStrictEqual(
      run(["[ED_NoSuchMessage]", "    anything = 1", "[/ED_NoSuchMessage]"]),
      [
        "0:ED_NoSuchMessage:class",
        "1:anything:property:defaultLibrary",
        "2:ED_NoSuchMessage:class",
      ]
    );
  });

  it("marks nothing unknown when no index is loaded", () => {
    const text = ["[429_Anything]", "    Whatever = X", "[/429_Anything]"].join("\n");
    assert.deepStrictEqual(show(text, computeSemanticTokens(text, undefined)), [
      "0:429_Anything:class:defaultLibrary",
      "1:Whatever:property:defaultLibrary",
      "2:429_Anything:class:defaultLibrary",
    ]);
  });

  it("gives a reserved (used === false) field the deprecated modifier", () => {
    const index = loadIndex();
    const message = index.resolveConnectionMessage("ED_Type1");
    const field = message!.fields.find((f) => f.name === "aircraft_category");
    field!.used = false;
    assert.deepStrictEqual(
      run(["[ED_Type1]", "    aircraft_category = 0", "    type_code = 1", "[/ED_Type1]"], index)
        .slice(1, 3),
      [
        "1:aircraft_category:property:defaultLibrary,deprecated",
        "2:type_code:property:defaultLibrary",
      ]
    );
  });

  it("treats a one-liner [NAME/] as coloured but never as an open scope", () => {
    assert.deepStrictEqual(
      run(["[ED_Type1/]", "type_code = AIRCRAFT_CATEGORY_SET_A"]),
      ["0:ED_Type1:class:defaultLibrary"]
    );
  });

  it("stops attributing fields once the component is closed, whatever was left open inside", () => {
    assert.deepStrictEqual(
      run([
        "[ED_Type1]",
        "    [NESTED]",
        "    type_code = 1",
        "[/ED_Type1]",
        "type_code = 1",
      ]),
      [
        "0:ED_Type1:class:defaultLibrary",
        "2:type_code:property:defaultLibrary",
        "3:ED_Type1:class:defaultLibrary",
      ]
    );
  });

  it("emits nothing inside comments, and no enum token for macro or CSV values", () => {
    assert.deepStrictEqual(
      run([
        "# [ED_Type1]",
        "[ED_Type1] # opener",
        "    # type_code = X",
        "    type_code = %CODE%",
        "    type_code = data.csv line:2 col:3",
        "    type_code = 1 # NOT_AN_ENUM",
        "[/ED_Type1]",
      ]),
      [
        "1:ED_Type1:class:defaultLibrary",
        "3:type_code:property:defaultLibrary",
        "4:type_code:property:defaultLibrary",
        "5:type_code:property:defaultLibrary",
        "6:ED_Type1:class:defaultLibrary",
      ]
    );
  });

  it("handles CRLF and the sloppy tag forms TestPit repairs", () => {
    assert.deepStrictEqual(
      run(["[[ED_Type1]]", "type_code = AIRCRAFT_CATEGORY_SET_D", "[//ED_Type1]"], loadIndex(), "\r\n"),
      [
        "0:ED_Type1:class:defaultLibrary",
        "1:type_code:property:defaultLibrary",
        "1:AIRCRAFT_CATEGORY_SET_D:enumMember:defaultLibrary",
        "2:ED_Type1:class:defaultLibrary",
      ]
    );
  });

  it("returns tokens in document order", () => {
    const text = ["[ED_Type1]", "  type_code = AIRCRAFT_CATEGORY_SET_A", "[/ED_Type1]"].join("\n");
    const tokens = computeSemanticTokens(text, loadIndex());
    for (let i = 1; i < tokens.length; i++) {
      const a = tokens[i - 1];
      const b = tokens[i];
      assert.ok(a.line < b.line || (a.line === b.line && a.start + a.length <= b.start));
    }
  });

  it("encodes types and modifiers against the legend order", () => {
    assert.deepStrictEqual([...SEMANTIC_TOKEN_TYPES], ["class", "property", "enumMember", "keyword"]);
    assert.deepStrictEqual([...SEMANTIC_TOKEN_MODIFIERS], ["defaultLibrary", "deprecated"]);
    assert.strictEqual(semanticTokenTypeIndex("enumMember"), 2);
    assert.strictEqual(encodeSemanticTokenModifiers([]), 0);
    assert.strictEqual(encodeSemanticTokenModifiers(["defaultLibrary"]), 1);
    assert.strictEqual(encodeSemanticTokenModifiers(["deprecated", "defaultLibrary"]), 3);
  });
});
