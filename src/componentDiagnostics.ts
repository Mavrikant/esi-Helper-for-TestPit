import * as vscode from "vscode";
import * as path from "path";
import { createCsvCellLookup } from "./lib/csv";
import { EsiIssue, collectEsiIssues, issueSeverity } from "./lib/workspaceValidation";
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
    // ONE pipeline, shared with the workspace-wide command
    // (lib/workspaceValidation.ts collectEsiIssues): structure, step and
    // %MACRO% checks need no config, so they run even with no active profile;
    // component validation only with an index.
    const index = getActiveProjectIndex();
    const issues = collectEsiIssues(text, {
      index,
      // One lookup per pass: each referenced CSV is read (csv.ts, a real
      // RFC-4180 reader) at most once, relative to the .esi file's folder.
      csvLookup: index ? createCsvCellLookup(document.uri.fsPath) : undefined,
      macroResolver: createMacroResolver(document),
    });
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

const SEVERITY: Record<ReturnType<typeof issueSeverity>, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

// The range and `code` are what providers/codeActions.ts uses to re-find the
// issue behind a diagnostic — keep both exactly as the issue reports them.
// Also used by commands/validateWorkspace.ts, so both collections agree.
export function toDiagnostic(issue: EsiIssue): vscode.Diagnostic {
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
    SEVERITY[issueSeverity(issue)]
  );
  diag.source = "esi Helper";
  diag.code = issue.kind;
  if ("unnecessary" in issue && issue.unnecessary) {
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
  }
  return diag;
}
