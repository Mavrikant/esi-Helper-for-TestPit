import * as vscode from "vscode";
import * as path from "path";
import {
  ComponentIssue,
  validateComponents,
  validateStructure,
} from "./lib/componentValidator";
import { createCsvCellLookup } from "./lib/csv";
import { MacroIssue, validateMacros } from "./lib/macros";
import { StepIssue, checkSteps } from "./lib/stepChecks";
import { createMacroResolver } from "./providers/macroResolver";
import { getActiveProjectIndex, onIndexChanged } from "./lib/projectIndexCache";
import { onActiveProfileChanged } from "./lib/profileRegistry";
import { getOutputChannel } from "./lib/outputChannel";

const COLLECTION_NAME = "esi-components";

export function registerComponentDiagnostics(): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  // Per-document log throttling — only log to the output channel when the
  // warning count actually changes, otherwise typing in a 13k-line .esi
  // would flood the panel.
  const lastLoggedCount = new Map<string, number>();

  const validateAndPublish = (document: vscode.TextDocument): void => {
    if (document.languageId !== "esi") {
      return;
    }
    const text = document.getText();
    // Structural checks need no config, so they run even with no active
    // profile — the extension still catches tag/nesting mistakes.
    const issues: AnyIssue[] = validateStructure(text);
    // Step-number hygiene and %MACRO% checks are config-free as well.
    issues.push(...checkSteps(text));
    issues.push(...validateMacros(text, createMacroResolver(document)));
    const index = getActiveProjectIndex();
    if (index) {
      // One lookup per pass: each referenced CSV is read (csv.ts, a real
      // RFC-4180 reader) at most once, relative to the .esi file's folder.
      const csvLookup = createCsvCellLookup(document.uri.fsPath);
      issues.push(...validateComponents(text, index, csvLookup));
    }
    collection.set(document.uri, issues.map(toDiagnostic));
    const key = document.uri.toString();
    if (lastLoggedCount.get(key) !== issues.length) {
      const scope = index ? "" : " (structural only — no active project)";
      getOutputChannel().appendLine(
        `[validate] ${path.basename(document.uri.fsPath)}: ${issues.length} issue(s)${scope}`
      );
      lastLoggedCount.set(key, issues.length);
    }
  };

  // Initial pass for any .esi files already open.
  for (const doc of vscode.workspace.textDocuments) {
    validateAndPublish(doc);
  }

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    validateAndPublish(event.document);
  });
  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    validateAndPublish(doc);
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    collection.delete(doc.uri);
  });

  // When the active profile changes (or the registry is reloaded), the index
  // reloads — re-validate every open .esi document so warnings catch up.
  const revalidateAll = (): void => {
    for (const doc of vscode.workspace.textDocuments) {
      validateAndPublish(doc);
    }
  };

  const onProfileChange = onActiveProfileChanged(() => revalidateAll());
  // A config XML edited on disk rebuilds the index without a profile change.
  const onConfigFileChange = onIndexChanged(() => revalidateAll());

  return vscode.Disposable.from(
    collection,
    onChange,
    onOpen,
    onClose,
    onProfileChange,
    onConfigFileChange
  );
}

type AnyIssue = ComponentIssue | StepIssue | MacroIssue;

const SEVERITY: Record<NonNullable<AnyIssue["severity"]>, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

// The range and `code` are what providers/codeActions.ts uses to re-find the
// issue behind a diagnostic — keep both exactly as the issue reports them.
function toDiagnostic(issue: AnyIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.line,
    issue.startCol,
    issue.line,
    issue.endCol
  );
  const diag = new vscode.Diagnostic(
    range,
    issue.message,
    // A component issue without a severity is a warning.
    SEVERITY[issue.severity ?? "warning"]
  );
  diag.source = "esi Helper";
  diag.code = issue.kind;
  if ("unnecessary" in issue && issue.unnecessary) {
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
  }
  return diag;
}
