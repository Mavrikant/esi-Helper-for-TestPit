import * as assert from "assert";
import * as vscode from "vscode";
import { registerEsiDocumentSymbolProvider } from "../../providers/documentSymbols";
import { registerEsiFoldingRangeProvider } from "../../providers/folding";
import { registerGotoStep } from "../../commands/gotoStep";

// The vscode mock (test/setup.js) records what was registered, so these call
// the providers / command the way VS Code would. They guard the thin glue:
// the logic itself is tested through the pure lib functions.
const registered = (vscode as any).__registered as {
  providers: Record<string, any>;
  commands: Record<string, (...args: unknown[]) => unknown>;
};

const SCRIPT = [
  "# header", // 0
  "# more", // 1
  "[TEST STEPS]", // 2
  "    [STEP 10]", // 3
  "        [STEP DEFINITION]", // 4
  "            Step Description = First step", // 5
  "        [/STEP DEFINITION]", // 6
  "        [STEP OUTPUTS]", // 7
  "            [STEP DUMP/]", // 8
  "        [/STEP OUTPUTS]", // 9
  "    [/STEP 10]", // 10
  "    [STEP 100]", // 11
  "    [/STEP 100]", // 12
  "[/TEST STEPS]", // 13
].join("\r\n");

function fakeDocument(text: string): any {
  const lines = text.split(/\r?\n/);
  return {
    getText: () => text,
    lineCount: lines.length,
    lineAt: (line: number) => ({
      range: new vscode.Range(line, 0, line, lines[line].length),
    }),
  };
}

describe("provider / command glue", () => {
  it("document symbols: nested tree with the mapped SymbolKinds", () => {
    registerEsiDocumentSymbolProvider();
    const symbols = registered.providers.documentSymbol.provideDocumentSymbols(
      fakeDocument(SCRIPT)
    );
    assert.strictEqual(symbols.length, 1);
    const [testSteps] = symbols;
    assert.strictEqual(testSteps.name, "TEST STEPS");
    assert.strictEqual(testSteps.kind, vscode.SymbolKind.Module);
    assert.deepStrictEqual(
      testSteps.children.map((c: any) => [c.name, c.kind, c.detail]),
      [
        ["STEP 10", vscode.SymbolKind.Function, "First step"],
        ["STEP 100", vscode.SymbolKind.Function, ""],
      ]
    );
    // The one-liner [STEP DUMP/] is a leaf under STEP OUTPUTS, not a step.
    const outputs = testSteps.children[0].children[1];
    assert.strictEqual(outputs.kind, vscode.SymbolKind.Interface);
    assert.deepStrictEqual(
      outputs.children.map((c: any) => c.name),
      ["STEP DUMP"]
    );
  });

  it("folding: sections fold on their tags, comment runs as comments", () => {
    registerEsiFoldingRangeProvider();
    const ranges = registered.providers.foldingRange.provideFoldingRanges(
      fakeDocument(SCRIPT)
    );
    const comment = ranges.find(
      (r: any) => r.kind === vscode.FoldingRangeKind.Comment
    );
    assert.deepStrictEqual([comment.start, comment.end], [0, 1]);
    assert.ok(ranges.some((r: any) => r.start === 2 && r.kind === undefined));
    assert.ok(ranges.some((r: any) => r.start === 3 && r.kind === undefined));
  });

  describe("goto step picker", () => {
    function open(cursorLine: number): { editor: any; picker: any } {
      const editor: any = {
        document: fakeDocument(SCRIPT),
        selection: { active: { line: cursorLine, character: 0 } },
        selections: ["original"],
        visibleRanges: [new vscode.Range(0, 0, 5, 0)],
        decorations: [] as unknown[],
        revealed: [] as unknown[],
        setDecorations(_type: unknown, ranges: unknown[]) {
          this.decorations = ranges;
        },
        revealRange(range: unknown, type: unknown) {
          this.revealed.push([range, type]);
        },
      };
      let picker: any;
      const window = vscode.window as any;
      const realCreate = window.createQuickPick;
      window.createQuickPick = () => (picker = realCreate());
      window.activeTextEditor = editor;
      try {
        registerGotoStep();
        registered.commands["extension.gotoStep"]();
      } finally {
        window.createQuickPick = realCreate;
        window.activeTextEditor = undefined;
      }
      return { editor, picker };
    }

    it("lists the steps (STEP DUMP is not one) and opens on the cursor's step", () => {
      const { picker } = open(5);
      assert.deepStrictEqual(
        picker.items.map((i: any) => [i.label, i.description]),
        [
          ["STEP 10", "First step"],
          ["STEP 100", undefined],
        ]
      );
      assert.strictEqual(picker.activeItems[0].label, "STEP 10");
    });

    it("an exact number wins on accept: '10' never lands on STEP 100", () => {
      const { editor, picker } = open(0);
      picker._fireValue("10");
      picker.selectedItems = [picker.items[1]]; // the filter ranked STEP 100 first
      picker._fireAccept();
      assert.strictEqual(editor.selection.anchor.line, 3);
      const [, type] = editor.revealed[editor.revealed.length - 1];
      assert.strictEqual(type, vscode.TextEditorRevealType.AtTop);
      assert.deepStrictEqual(editor.selections, ["original"]);
    });

    it("a step the user highlighted beats the exact number on accept", () => {
      const { editor, picker } = open(0);
      picker._fireValue("10");
      picker._fireActive([picker.items[1]]); // arrowed down to STEP 100
      picker.selectedItems = [picker.items[1]];
      picker._fireAccept();
      assert.strictEqual(editor.selection.anchor.line, 11);
    });

    it("previews the highlighted step and restores the view on Escape", () => {
      const { editor, picker } = open(0);
      picker._fireActive([picker.items[1]]);
      assert.strictEqual(editor.decorations[0].start.line, 11);
      editor.selections = ["moved"];
      picker.hide();
      assert.deepStrictEqual(editor.selections, ["original"]);
      const [range, type] = editor.revealed[editor.revealed.length - 1];
      assert.strictEqual(range, editor.visibleRanges[0]);
      assert.strictEqual(type, vscode.TextEditorRevealType.AtTop);
    });
  });
});
