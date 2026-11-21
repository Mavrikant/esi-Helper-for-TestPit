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
