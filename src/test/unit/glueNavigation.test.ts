import * as assert from "assert";
import * as vscode from "vscode";
import { registerEsiTagPairProviders } from "../../providers/tagPairs";
import { registerEsiMacroProviders } from "../../providers/macroNavigation";
import { registerEsiCodeActionsProvider } from "../../providers/codeActions";
import { registerEsiHoverProvider } from "../../providers/hover";
import { registerGotoMatchingTag } from "../../commands/gotoMatchingTag";
import { checkSteps } from "../../lib/stepChecks";
import { validateMacros } from "../../lib/macros";

// Glue for macro navigation, tag pairing and the merged code-action provider,
// driven through the vscode mock (test/setup.js). The logic is tested in the
// pure lib suites; these guard the wiring and the places two features meet.
const registered = (vscode as any).__registered as {
  providers: Record<string, any>;
  commands: Record<string, (...args: unknown[]) => unknown>;
};

const SCRIPT = [
  "[VARIABLES]", // 0
  "    %COURSE% = 10", // 1
  "    %SPARE% = 1", // 2
  "[/VARIABLES]", // 3
  "[TEST STEPS]", // 4
  "    [STEP 10]", // 5
  "        Step Description = %COURSE% and %CORSE%", // 6
  "    [/STEP 10]", // 7
  "    [STEP 10]", // 8
  "    [/STEP 10]", // 9
  "    [BLOCK %COURSE%]", // 10
  "    [/BLOCK %COURSE%]", // 11
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

function diagnosticsFor(text: string): vscode.Diagnostic[] {
  return [...checkSteps(text), ...validateMacros(text, {})].map((issue) => {
    const d = new vscode.Diagnostic(
      new vscode.Range(issue.line, issue.startCol, issue.line, issue.endCol),
      issue.message,
      vscode.DiagnosticSeverity.Warning
    );
    d.source = "esi Helper";
    d.code = issue.kind;
    return d;
  });
}

describe("navigation glue (macros, tag pairs, code actions)", () => {
  const doc = fakeDocument(SCRIPT);

  it("tag pair: highlights both tags and links the two names", () => {
    registerEsiTagPairProviders();
    const highlights = registered.providers.documentHighlight.provideDocumentHighlights(
      doc,
      pos(4, 3)
    );
    assert.deepStrictEqual(
      highlights.map((h: any) => h.range.start.line),
      [4, 12]
    );
    const linked = registered.providers.linkedEditingRange.provideLinkedEditingRanges(
      doc,
      pos(4, 3)
    );
    assert.deepStrictEqual(
      linked.ranges.map((r: any) => [r.start.line, r.start.character, r.end.character]),
      [
        [4, 1, 11],
        [12, 2, 12],
      ]
    );
  });

  it("a %MACRO% inside a tag name is highlighted as a macro, not as a tag pair", () => {
    registerEsiTagPairProviders();
    const tags = registered.providers.documentHighlight;
    registerEsiMacroProviders();
    const macros = registered.providers.documentHighlight;
    const at = pos(10, 14); // inside %COURSE% of [BLOCK %COURSE%]
    assert.strictEqual(tags.provideDocumentHighlights(doc, at), undefined);
    const lines = macros
      .provideDocumentHighlights(doc, at)
      .map((h: any) => [h.range.start.line, h.kind]);
    assert.deepStrictEqual(lines, [
      [1, vscode.DocumentHighlightKind.Write],
      [6, vscode.DocumentHighlightKind.Read],
      [10, vscode.DocumentHighlightKind.Read],
      [11, vscode.DocumentHighlightKind.Read],
    ]);
    // ... while the tag provider still answers on the plain part of the name.
    assert.strictEqual(tags.provideDocumentHighlights(doc, pos(10, 6)).length, 2);
  });

  it("macro definition and references", () => {
    registerEsiMacroProviders();
    const defs = registered.providers.definition.provideDefinition(doc, pos(6, 30));
    assert.deepStrictEqual(
      defs.map((d: any) => d.range.start.line),
      [1]
    );
    const refs = registered.providers.reference.provideReferences(doc, pos(6, 30), {
      includeDeclaration: false,
    });
    assert.deepStrictEqual(
      refs.map((r: any) => r.range.start.line),
      [6, 10, 11]
    );
  });

  it("macro hover needs no profile", () => {
    registerEsiHoverProvider();
    const hover = registered.providers.hover.provideHover(doc, pos(6, 30));
    assert.ok(hover.contents.value.includes("10"));
    assert.strictEqual(hover.range.start.line, 6);
  });

  it("one code-action provider: each step / macro fix is offered exactly once", () => {
    registerEsiCodeActionsProvider();
    const diagnostics = diagnosticsFor(SCRIPT);
    const codes = diagnostics.map((d) => d.code).sort();
    assert.deepStrictEqual(codes, [
      "duplicateStepNumber",
      "undefinedMacro",
      "unusedMacro",
    ]);
    const actions = registered.providers.codeActions.provideCodeActions(
      doc,
      new vscode.Range(0, 0, 0, 0),
      { diagnostics }
    );
    assert.deepStrictEqual(actions.map((a: any) => a.title).sort(), [
      "Change to '%COURSE%'",
      "Remove unused variable '%SPARE%'",
      "Renumber steps",
    ]);
    const renumber = actions.find((a: any) => a.title === "Renumber steps");
    // Digits only: the second [STEP 10] pair becomes 20.
    assert.deepStrictEqual(
      renumber.edit._edits.map((e: any) => [e.range.start.line, e.text]),
      [
        [8, "20"],
        [9, "20"],
      ]
    );
  });

  it("go to matching tag: opener <-> closer, and no-op with a message otherwise", () => {
    const editor: any = {
      document: doc,
      selection: { active: pos(4, 0) },
      revealed: 0,
      revealRange() {
        this.revealed += 1;
      },
    };
    const window = vscode.window as any;
    window.activeTextEditor = editor;
    try {
      registerGotoMatchingTag();
      registered.commands["extension.gotoMatchingTag"]();
      assert.strictEqual(editor.selection.active.line, 12);
      registered.commands["extension.gotoMatchingTag"]();
      assert.strictEqual(editor.selection.active.line, 4);
      assert.strictEqual(editor.revealed, 2);
    } finally {
      window.activeTextEditor = undefined;
    }
  });
});
