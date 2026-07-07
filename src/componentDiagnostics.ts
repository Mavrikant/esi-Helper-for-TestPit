import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ComponentIssue,
  CsvLookup,
  validateComponents,
  validateStructure,
} from "./lib/componentValidator";
import { getActiveProjectIndex } from "./lib/projectIndexCache";
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
    const issues = validateStructure(text);
    const index = getActiveProjectIndex();
    if (index) {
      const csvLookup = makeCsvLookup(document.uri.fsPath);
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

  return vscode.Disposable.from(
    collection,
    onChange,
    onOpen,
    onClose,
    onProfileChange
  );
}

/**
 * Build a per-validation-pass CSV cell lookup. CSV files are read at
 * most once per pass (cached by absolute path). Resolution: filename
 * is treated as relative to the .esi file's directory.
 *
 * Cell parsing is intentionally simple: lines split on \r?\n, cells
 * split on `,`, both 1-indexed, surrounding whitespace + double-quote
 * pair stripped. No support for embedded commas inside quoted cells —
 * if your fixtures need that we can swap in a real CSV parser later.
 */
function makeCsvLookup(esiFilePath: string): CsvLookup {
  const baseDir = path.dirname(esiFilePath);
  const rowsCache = new Map<string, string[][] | undefined>();
  return (filename, line, col) => {
    const fullPath = path.resolve(baseDir, filename);
    let rows = rowsCache.get(fullPath);
    if (rows === undefined && !rowsCache.has(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        rows = content.split(/\r?\n/).map((row) =>
          row.split(",").map(cleanCsvCell)
        );
      } catch {
        rows = undefined;
      }
      rowsCache.set(fullPath, rows);
    }
    if (!rows) {
      return undefined;
    }
    return rows[line - 1]?.[col - 1];
  };
}

function cleanCsvCell(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

function toDiagnostic(issue: ComponentIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.line,
    issue.startCol,
    issue.line,
    issue.endCol
  );
  const diag = new vscode.Diagnostic(
    range,
    issue.message,
    issue.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning
  );
  diag.source = "esi Helper";
  diag.code = issue.kind;
  return diag;
}
