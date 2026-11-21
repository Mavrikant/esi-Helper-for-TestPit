import * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import {
  computeCodeLenses,
  LensAction,
  LensProblem,
  LensSeverity,
} from "../lib/codeLens";

/** Internal commands behind the step lenses (not in the command palette). */
export const CMD_LENS_TOGGLE_FOLD = "extension.esiLens.toggleStepFold";
export const CMD_LENS_SHOW_PROBLEMS = "extension.esiLens.showStepProblems";

const SETTING = "codeLens.enabled";
const REFRESH_DEBOUNCE_MS = 300;

function lensesEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(SETTING, true) !== false
  );
}

function severityOf(s: vscode.DiagnosticSeverity): LensSeverity {
  switch (s) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    default:
      return "hint";
  }
}

function problemsOf(uri: vscode.Uri): LensProblem[] {
  return vscode.languages.getDiagnostics(uri).map((d) => ({
    line: d.range.start.line,
    severity: severityOf(d.severity),
  }));
}

function toCommand(
  action: LensAction,
  title: string,
  tooltip: string,
  uri: vscode.Uri
): vscode.Command {
  switch (action.type) {
    case "validate":
      return { title, tooltip, command: "extension.runValidityCheck" };
    case "openWithTestPit":
      return { title, tooltip, command: "extension.openWithTestPit" };
    case "toggleFold":
      return {
        title,
        tooltip,
        command: CMD_LENS_TOGGLE_FOLD,
        arguments: [uri, action.line],
      };
    case "showProblems":
      return {
        title,
        tooltip,
        command: CMD_LENS_SHOW_PROBLEMS,
        arguments: [uri, action.startLine, action.endLine],
      };
  }
}

function editorFor(uri: vscode.Uri | undefined): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !uri || editor.document.uri.toString() !== uri.toString()) {
    return undefined;
  }
  return editor;
}

function jumpTo(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(
    range,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}

async function toggleStepFold(uri: vscode.Uri, line: number): Promise<void> {
  const editor = editorFor(uri);
  if (!editor || typeof line !== "number" || line >= editor.document.lineCount) {
    return;
  }
  // `editor.toggleFold` acts on the cursor line, so the cursor moves there.
  const at = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(at, at);
  await vscode.commands.executeCommand("editor.toggleFold");
}

interface ProblemItem extends vscode.QuickPickItem {
  range: vscode.Range;
}

async function showStepProblems(
  uri: vscode.Uri,
  startLine: number,
  endLine: number
): Promise<void> {
  const editor = editorFor(uri);
  if (!editor) {
    return;
  }
  // Read the diagnostics again: the lens may be older than the problem list.
  const problems = vscode.languages
    .getDiagnostics(uri)
    .filter(
      (d) =>
        d.range.start.line >= startLine &&
        d.range.start.line <= endLine &&
        (d.severity === vscode.DiagnosticSeverity.Error ||
          d.severity === vscode.DiagnosticSeverity.Warning)
    )
    .sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character
    );
  if (problems.length === 0) {
    return;
  }
  if (problems.length === 1) {
    jumpTo(editor, problems[0].range);
    return;
  }
  const items: ProblemItem[] = problems.map((d) => ({
    label:
      (d.severity === vscode.DiagnosticSeverity.Error
        ? "$(error) "
        : "$(warning) ") + d.message.split(/\r?\n/)[0],
    description: `line ${d.range.start.line + 1}`,
    detail: d.source,
    range: d.range,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: `Problems in this step (${items.length})`,
    placeHolder: "Select a problem to go to it",
    matchOnDescription: true,
  });
  if (picked) {
    jumpTo(editor, picked.range);
  }
}

/**
 * CodeLens for `.esi`: "Validate" / "Open with TestPit" on a root script and a
 * summary above each step. All logic is in lib/codeLens.ts. Lenses refresh
 * (debounced) when diagnostics change; `esihelper.codeLens.enabled` turns
 * them off.
 */
export function registerEsiCodeLensProvider(): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onDiagnostics = vscode.languages.onDidChangeDiagnostics((e) => {
    const touched = new Set(e.uris.map((u) => u.toString()));
    const relevant = vscode.workspace.textDocuments.some(
      (d) => d.languageId === "esi" && touched.has(d.uri.toString())
    );
    if (!relevant || !lensesEnabled()) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      changed.fire();
    }, REFRESH_DEBOUNCE_MS);
  });

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e || e.affectsConfiguration(`${CONFIG_SECTION}.codeLens`)) {
      changed.fire();
    }
  });

  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses(document) {
      if (!lensesEnabled()) {
        return [];
      }
      return computeCodeLenses(
        document.getText(),
        problemsOf(document.uri)
      ).map(
        (l) =>
          new vscode.CodeLens(
            new vscode.Range(l.line, l.startCol, l.line, l.endCol),
            toCommand(l.action, l.title, l.tooltip, document.uri)
          )
      );
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerCodeLensProvider({ language: "esi" }, provider),
    vscode.commands.registerCommand(CMD_LENS_TOGGLE_FOLD, toggleStepFold),
    vscode.commands.registerCommand(CMD_LENS_SHOW_PROBLEMS, showStepProblems),
    onDiagnostics,
    onConfigChange,
    new vscode.Disposable(() => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }),
    changed
  );
}
