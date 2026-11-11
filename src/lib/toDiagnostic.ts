import type * as vscode from "vscode";
import type { ValidityIssue } from "./parseValidityOutput";

// Source shown in the Problems panel for issues reported by TestPit.exe.
// Deliberately NOT "esi Helper": that source marks the in-process component
// diagnostics, and the code-action provider filters on it — TestPit's own
// findings must not be offered those quick fixes.
export const TESTPIT_DIAGNOSTIC_SOURCE = "TestPit";

export function toDiagnostic(issue: ValidityIssue): vscode.Diagnostic {
  // Late require so tests can mock the 'vscode' module before this runs.
  const vsc: typeof vscode = require("vscode");
  const range = new vsc.Range(
    issue.lineNumber,
    issue.startCol,
    issue.lineNumber,
    issue.endCol
  );
  const severity =
    issue.severity === "warning"
      ? vsc.DiagnosticSeverity.Warning
      : vsc.DiagnosticSeverity.Error;
  const diagnostic = new vsc.Diagnostic(range, issue.message, severity);
  diagnostic.source = TESTPIT_DIAGNOSTIC_SOURCE;
  return diagnostic;
}
