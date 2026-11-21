/**
 * Integration cases: open fixture `.esi` documents in a real extension host
 * and ask VS Code — through its public command API only — for what the
 * extension's providers contribute. Nothing here imports the extension's own
 * modules, so a provider that is not registered (or not reachable through
 * package.json) fails the case.
 *
 * No TestPit.exe, no registry: there is no active profile, hence no XML
 * index. Every expectation below is something the extension answers without
 * one (structure, step numbering, formatting, structural tag completion).
 */
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

export interface IntegrationCase {
  name: string;
  run: () => Promise<void>;
}

const EXTENSION_ID = "karamandev.esi-helper-for-testpit";
const DIAGNOSTIC_SOURCE = "esi Helper";

function fixtureUri(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the fixture folder must be open as the workspace");
  return vscode.Uri.file(path.join(folder.uri.fsPath, name));
}

async function openFixture(name: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(fixtureUri(name));
  await vscode.window.showTextDocument(document);
  assert.strictEqual(document.languageId, "esi", `${name} must open as esi`);
  return document;
}

/** Poll until `probe` returns a value (providers and diagnostics are async). */
async function waitFor<T>(
  what: string,
  probe: () => T | undefined | Thenable<T | undefined>,
  timeoutMs = 15000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function nonEmpty<T>(items: T[] | undefined | null): T[] | undefined {
  return items && items.length > 0 ? items : undefined;
}

function labelOf(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

async function completionLabels(
  document: vscode.TextDocument,
  line: number,
  character: number
): Promise<string[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(line, character)
  );
  return (list?.items ?? []).map(labelOf);
}

/** Apply TextEdits to a string, without touching (dirtying) the document. */
function applyEdits(document: vscode.TextDocument, edits: vscode.TextEdit[]): string {
  let text = document.getText();
  const sorted = [...edits].sort(
    (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start)
  );
  for (const edit of sorted) {
    text =
      text.slice(0, document.offsetAt(edit.range.start)) +
      edit.newText +
      text.slice(document.offsetAt(edit.range.end));
  }
  return text;
}

export const cases: IntegrationCase[] = [
  {
    name: "the extension is installed and activates",
    run: async () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension, `${EXTENSION_ID} must be present in the host`);
      await extension.activate();
      assert.strictEqual(extension.isActive, true);
    },
  },
  {
    name: "document symbols: sections and steps form the outline",
    run: async () => {
      const document = await openFixture("outline.esi");
      const symbols = await waitFor("document symbols", async () =>
        nonEmpty(
          await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            document.uri
          )
        )
      );
      assert.deepStrictEqual(
        symbols.map((s) => s.name),
        ["TEST DEFINITION", "TEST STEPS"]
      );
      const steps = symbols[1].children;
      assert.deepStrictEqual(
        steps.map((s) => s.name),
        ["STEP 1", "STEP 2"]
      );
      assert.deepStrictEqual(
        steps[0].children.map((s) => s.name),
        ["STEP DEFINITION", "STEP INPUTS", "STEP OUTPUTS"]
      );
      // [STEP 1] … [/STEP 1] spans 0-based lines 8..16 of the fixture.
      assert.strictEqual(steps[0].range.start.line, 8);
      assert.strictEqual(steps[0].range.end.line, 16);
    },
  },
  {
    name: "folding ranges: sections and the leading comment run fold",
    run: async () => {
      const document = await openFixture("outline.esi");
      const ranges = await waitFor("folding ranges", async () =>
        nonEmpty(
          await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            "vscode.executeFoldingRangeProvider",
            document.uri
          )
        )
      );
      const has = (start: number, end: number, kind?: vscode.FoldingRangeKind) =>
        ranges.some(
          (r) =>
            r.start === start &&
            r.end === end &&
            (kind === undefined || r.kind === kind)
        );
      assert.ok(
        has(0, 2, vscode.FoldingRangeKind.Comment),
        `comment run 0..2 missing from ${JSON.stringify(ranges)}`
      );
      assert.ok(has(7, 25), `[TEST STEPS] 7..25 missing from ${JSON.stringify(ranges)}`);
      assert.ok(has(8, 15), `[STEP 1] 8..15 missing from ${JSON.stringify(ranges)}`);
    },
  },
  {
    name: "completion: structural section names after '['",
    run: async () => {
      const document = await openFixture("completion.esi");
      // 0-based line 5 is `            [` — cursor right after the bracket.
      const labels = await waitFor("tag completions", async () => {
        const found = await completionLabels(document, 5, 13);
        return found.includes("STEP OUTPUTS") ? found : undefined;
      });
      assert.ok(labels.includes("TIMELIMIT"), `got ${JSON.stringify(labels)}`);
    },
  },
  {
    name: "completion: the open section's closing tag after '[/'",
    run: async () => {
      const document = await openFixture("completion.esi");
      // 0-based line 11 is `        [/`, inside [STEP 2] only.
      const labels = await waitFor("closing-tag completions", async () => {
        const found = await completionLabels(document, 11, 10);
        return found.includes("STEP 2") ? found : undefined;
      });
      assert.ok(labels.includes("TEST STEPS"), `got ${JSON.stringify(labels)}`);
      assert.ok(
        !labels.includes("STEP 1"),
        `[STEP 1] is already closed; got ${JSON.stringify(labels)}`
      );
    },
  },
  {
    name: "diagnostics + code actions: duplicate step number, 'Renumber steps'",
    run: async () => {
      const document = await openFixture("problems.esi");
      const diagnostic = await waitFor("the duplicate-step diagnostic", () =>
        vscode.languages
          .getDiagnostics(document.uri)
          .find(
            (d) =>
              d.source === DIAGNOSTIC_SOURCE && d.code === "duplicateStepNumber"
          )
      );
      // The second `[STEP 1]` is on 0-based line 6.
      assert.strictEqual(diagnostic.range.start.line, 6);

      const actions = await waitFor("code actions", async () =>
        nonEmpty(
          await vscode.commands.executeCommand<
            (vscode.CodeAction | vscode.Command)[]
          >("vscode.executeCodeActionProvider", document.uri, diagnostic.range)
        )
      );
      const titles = actions.map((a) => a.title);
      assert.ok(
        titles.includes("Renumber steps"),
        `got ${JSON.stringify(titles)}`
      );
    },
  },
  {
    name: "diagnostics: a structurally clean script reports nothing",
    run: async () => {
      const problems = await openFixture("problems.esi");
      // Wait until the in-process validator has demonstrably run …
      await waitFor("validator output", () =>
        nonEmpty(
          vscode.languages
            .getDiagnostics(problems.uri)
            .filter((d) => d.source === DIAGNOSTIC_SOURCE)
        )
      );
      // … then a clean document must stay clean.
      const clean = await openFixture("outline.esi");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const own = vscode.languages
        .getDiagnostics(clean.uri)
        .filter((d) => d.source === DIAGNOSTIC_SOURCE);
      assert.deepStrictEqual(
        own.map((d) => d.message),
        []
      );
    },
  },
  {
    name: "formatting: Format Document indents by section depth",
    run: async () => {
      const document = await openFixture("outline.esi");
      const edits = await waitFor("format edits", async () =>
        nonEmpty(
          await vscode.commands.executeCommand<vscode.TextEdit[]>(
            "vscode.executeFormatDocumentProvider",
            document.uri,
            { tabSize: 4, insertSpaces: true }
          )
        )
      );
      const lines = applyEdits(document, edits).split(/\r?\n/);
      assert.strictEqual(lines[3], "[TEST DEFINITION]");
      assert.strictEqual(lines[4], "    name = Outline fixture");
      assert.strictEqual(lines[8], "    [STEP 1]");
      assert.strictEqual(lines[9], "        [STEP DEFINITION]");
      assert.strictEqual(lines[10], "            description = First step");
      assert.strictEqual(lines[26], "[/TEST STEPS]");
    },
  },
];
