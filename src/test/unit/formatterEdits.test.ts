import * as assert from "assert";
import * as vscode from "vscode";
import { formatEsi } from "../../lib/formatEsi";
import { applyLineEdits } from "../../lib/lineEdits";
import { registerEsiFormatter, registerEsiRangeFormatter } from "../../formatter";

type Edit = { range: vscode.Range; newText: string };
type AnyProvider = Record<string, (...args: unknown[]) => Edit[]>;

function fakeDocument(text: string): unknown {
  return {
    languageId: "esi",
    lineCount: text.split(/\r?\n/).length,
    getText: () => text,
    positionAt: () => {
      throw new Error("whole-text replacement was not expected");
    },
  };
}

function apply(text: string, edits: Edit[]): string {
  return applyLineEdits(
    text,
    edits.map((e) => {
      assert.strictEqual(e.range.start.line, e.range.end.line);
      return {
        line: e.range.start.line,
        startCol: e.range.start.character,
        endCol: e.range.end.character,
        newText: e.newText,
      };
    })
  );
}

describe("formatter providers (glue)", () => {
  const languages = vscode.languages as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  let full: AnyProvider;
  let ranged: AnyProvider;

  before(() => {
    for (const name of [
      "registerDocumentFormattingEditProvider",
      "registerDocumentRangeFormattingEditProvider",
    ]) {
      saved[name] = languages[name];
    }
    languages.registerDocumentFormattingEditProvider = (
      _sel: unknown,
      p: AnyProvider
    ) => {
      full = p;
      return { dispose() {} };
    };
    languages.registerDocumentRangeFormattingEditProvider = (
      _sel: unknown,
      p: AnyProvider
    ) => {
      ranged = p;
      return { dispose() {} };
    };
    registerEsiFormatter();
    registerEsiRangeFormatter();
  });

  after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete languages[name];
      } else {
        languages[name] = value;
      }
    }
  });

  const text = [
    "[STEP 10]",
    "[STEP INPUTS]",
    "[429_FOO_input1]",
    "a = 1",
    "LongName=2",
    "[/429_FOO_input1]",
    "[/STEP INPUTS]",
    "[/STEP 10]",
  ].join("\r\n");

  it("Format Document returns single-line edits that equal formatEsi", () => {
    const edits = full.provideDocumentFormattingEdits(fakeDocument(text));
    assert.ok(edits.length > 0);
    assert.strictEqual(
      apply(text, edits),
      formatEsi(text).split("\n").join("\r\n")
    );
  });

  it("Format Document returns nothing for an already formatted document", () => {
    const clean = formatEsi(text);
    assert.deepStrictEqual(
      full.provideDocumentFormattingEdits(fakeDocument(clean)),
      []
    );
  });

  it("Format Selection edits only the selected lines", () => {
    const edits = ranged.provideDocumentRangeFormattingEdits(
      fakeDocument(text),
      new vscode.Range(3, 2, 4, 1)
    );
    assert.deepStrictEqual(
      edits.map((e) => e.range.start.line),
      [3, 4]
    );
    const result = apply(text, edits).split("\r\n");
    const original = text.split("\r\n");
    assert.strictEqual(result[3], "            a        = 1");
    assert.strictEqual(result[4], "            LongName = 2");
    for (const i of [0, 1, 2, 5, 6, 7]) {
      assert.strictEqual(result[i], original[i]);
    }
  });

  it("Format Selection over the whole document equals Format Document", () => {
    const last = text.split("\r\n").length - 1;
    assert.deepStrictEqual(
      ranged.provideDocumentRangeFormattingEdits(
        fakeDocument(text),
        new vscode.Range(0, 0, last, 999)
      ),
      full.provideDocumentFormattingEdits(fakeDocument(text))
    );
  });

  it("Format Selection skips a last line touched only at column 0", () => {
    const edits = ranged.provideDocumentRangeFormattingEdits(
      fakeDocument(text),
      new vscode.Range(3, 0, 4, 0)
    );
    assert.deepStrictEqual(
      edits.map((e) => e.range.start.line),
      [3]
    );
  });

  it("Format Selection does nothing when lines cannot be mapped", () => {
    const doc = fakeDocument(text) as { lineCount: number };
    doc.lineCount += 1; // editor disagrees with our line split (lone \r)
    assert.deepStrictEqual(
      ranged.provideDocumentRangeFormattingEdits(doc, new vscode.Range(3, 0, 4, 5)),
      []
    );
  });
});
