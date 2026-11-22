import * as assert from "assert";
import * as vscode from "vscode";
import { registerEsiHoverProvider } from "../../providers/hover";
import { registerEsiKeywordHoverProvider } from "../../providers/keywordHover";
import { registerEsiInlayHintsProvider } from "../../providers/inlayHints";
import { registerEsiSemanticTokensProvider } from "../../providers/semanticTokens";

// Glue for the keyword hover, inlay hints and semantic tokens providers,
// driven through the vscode mock (test/setup.js). The logic is tested in the
// pure lib suites; these guard the wiring and the places two hovers meet.
const registered = (vscode as any).__registered as {
  providers: Record<string, any>;
};

const SCRIPT = [
  "[VARIABLES]", // 0
  "    %N% = 10", // 1
  "[/VARIABLES]", // 2
  "[TEST STEPS]", // 3
  "    [STEP %N%]", // 4
  "        [STEP OUTPUTS]", // 5
  "            [429_L100_TX]", // 6
  "                match = any", // 7
  "                SDI   = 1", // 8
  "            [/429_L100_TX]", // 9
  "        [/STEP OUTPUTS]", // 10
  "    [/STEP %N%]", // 11
  "[/TEST STEPS]", // 12
].join("\r\n");

function fakeDocument(text: string): any {
  const lines = text.split(/\r?\n/);
  return {
    languageId: "esi",
    uri: { scheme: "untitled", fsPath: "", toString: () => "untitled:1" },
    getText: (range?: vscode.Range) =>
      range
        ? lines[range.start.line].slice(range.start.character, range.end.character)
        : text,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
    getWordRangeAtPosition: () => undefined,
  };
}

const pos = (line: number, character: number): vscode.Position =>
  new vscode.Position(line, character);

describe("editing glue (keyword hover, inlay hints, semantic tokens)", () => {
  const doc = fakeDocument(SCRIPT);

  it("keyword hover: a parameter key and a section tag, with no profile", () => {
    registerEsiKeywordHoverProvider();
    const keyword = registered.providers.hover;
    const match = keyword.provideHover(doc, pos(7, 17));
    assert.ok(match.contents.value.includes("any"));
    assert.strictEqual(match.range.start.line, 7);
    const section = keyword.provideHover(doc, pos(5, 12));
    assert.ok(section.contents.value.length > 0);
    // Value side of `=` and a component tag are not this provider's.
    assert.strictEqual(keyword.provideHover(doc, pos(7, 25)), undefined);
    assert.strictEqual(keyword.provideHover(doc, pos(6, 16)), undefined);
  });

  it("a %MACRO% in a tag name gets the macro card only, not a section card too", () => {
    registerEsiHoverProvider();
    const component = registered.providers.hover;
    registerEsiKeywordHoverProvider();
    const keyword = registered.providers.hover;
    const onMacro = pos(4, 11); // inside %N% of [STEP %N%]
    assert.ok(component.provideHover(doc, onMacro));
    assert.strictEqual(keyword.provideHover(doc, onMacro), undefined);
    // ... while the plain part of the tag still gets the section card, and
    // there the component hover has nothing to say.
    const onStep = pos(4, 6);
    assert.ok(keyword.provideHover(doc, onStep));
    assert.strictEqual(component.provideHover(doc, onStep), undefined);
    // A parameter key: keyword card only.
    assert.strictEqual(component.provideHover(doc, pos(7, 17)), undefined);
  });

  it("component hover: a field of the enclosing block beats a same-named bare connection", () => {
    // The index holds a port whose bare name (`SDI`) equals a field of the
    // block the cursor is in. The field card must win, as in Go to Definition.
    const { createEmptyIndex, messageKey } = require("../../lib/xmlIndex");
    const index = createEmptyIndex();
    const message = {
      name: "L100",
      bus: "429",
      fields: [{ name: "SDI", dataType: "UINT" }],
    };
    index.messages.set("L100", message);
    index.messagesByBus.set(messageKey("429", "L100"), message);
    index.connections.set("429_L100_TX", {
      fullName: "429_L100_TX",
      bus: "429",
      rawName: "L100_TX",
      messageName: "L100",
    });
    index.connections.set("PART_TEST_SDI", {
      fullName: "PART_TEST_SDI",
      bus: "Mem",
      rawName: "SDI",
    });
    const cache = require("../../lib/projectIndexCache");
    const original = cache.getActiveProjectIndex;
    cache.getActiveProjectIndex = () => index;
    try {
      registerEsiHoverProvider();
      const component = registered.providers.hover;
      const onField = { ...doc, getWordRangeAtPosition: () => new vscode.Range(8, 16, 8, 19) };
      const hover = component.provideHover(onField, pos(8, 17));
      assert.ok(hover, "a hover card");
      const text = hover.contents.value as string;
      assert.ok(text.includes("SDI"), text);
      assert.ok(!text.includes("PART_TEST_SDI"), `field card expected, got: ${text}`);
      // Outside any block, the bare name still finds the connection.
      const bare = fakeDocument("SDI");
      const onBare = { ...bare, getWordRangeAtPosition: () => new vscode.Range(0, 0, 0, 3) };
      const card = component.provideHover(onBare, pos(0, 1));
      assert.ok((card.contents.value as string).includes("PART_TEST_SDI"));
    } finally {
      cache.getActiveProjectIndex = original;
    }
  });

  it("component hover: an enum value is the state of the field being assigned", () => {
    // Two fields of one message share state names with other numbers.
    const { createEmptyIndex, messageKey } = require("../../lib/xmlIndex");
    const index = createEmptyIndex();
    const message = {
      name: "L270",
      bus: "429",
      fields: [
        { name: "Bit11", dataType: "Enum", enums: [{ name: "OFF", value: "0" }, { name: "ON", value: "1" }] },
        { name: "Bit12", dataType: "Enum", enums: [{ name: "ON", value: "0" }, { name: "OFF", value: "1" }] },
        { name: "Mode", dataType: "Enum", enums: [{ name: "STANDBY", value: "0" }, { name: "ACTIVE", value: "1" }] },
      ],
    };
    index.messages.set("L270", message);
    index.messagesByBus.set(messageKey("429", "L270"), message);
    index.connections.set("429_L270_TX", {
      fullName: "429_L270_TX",
      bus: "429",
      rawName: "L270_TX",
      messageName: "L270",
    });
    const text = [
      "[TEST STEPS]",
      "    [429_L270_TX]",
      "        Bit12 = ON",
      "        Mode  = ON",
      "        occurrence = ACTIVE",
      "    [/429_L270_TX]",
      "[/TEST STEPS]",
    ].join("\r\n");
    const document = fakeDocument(text);
    const at = (line: number, word: string): any => {
      const start = document.lineAt(line).text.indexOf(word, 10);
      return {
        document: {
          ...document,
          getWordRangeAtPosition: () => new vscode.Range(line, start, line, start + word.length),
        },
        position: pos(line, start + 1),
      };
    };
    const cache = require("../../lib/projectIndexCache");
    const original = cache.getActiveProjectIndex;
    cache.getActiveProjectIndex = () => index;
    try {
      registerEsiHoverProvider();
      const component = registered.providers.hover;
      const bit12 = at(2, "ON");
      const card = component.provideHover(bit12.document, bit12.position);
      assert.ok(card, "a card for Bit12's ON");
      const value = card.contents.value as string;
      assert.ok(value.includes("**ON** = `0`") && value.includes("Enum value of `Bit12`"), value);
      // Mode has no state ON: no card from another field's table.
      const mode = at(3, "ON");
      assert.strictEqual(component.provideHover(mode.document, mode.position), undefined);
      // A parameter key: the one field holding the state answers.
      const param = at(4, "ACTIVE");
      const paramCard = component.provideHover(param.document, param.position);
      assert.ok((paramCard.contents.value as string).includes("Enum value of `Mode`"));
    } finally {
      cache.getActiveProjectIndex = original;
    }
  });

  it("inlay hints: registered, and silent with no profile loaded", () => {
    const disposable = registerEsiInlayHintsProvider();
    const provider = registered.providers.inlayHints;
    assert.strictEqual(typeof provider.onDidChangeInlayHints, "function");
    assert.deepStrictEqual(
      provider.provideInlayHints(doc, new vscode.Range(0, 0, 12, 0)),
      []
    );
    disposable.dispose();
  });

  it("semantic tokens: the provider can ask the editor to re-request", () => {
    const disposable = registerEsiSemanticTokensProvider();
    const provider = registered.providers.semanticTokens;
    assert.strictEqual(typeof provider.onDidChangeSemanticTokens, "function");
    assert.ok(provider.provideDocumentSemanticTokens(doc).data.length > 0);
    disposable.dispose();
  });
});
