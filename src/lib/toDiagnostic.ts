import type * as vscode from "vscode";
import type { ValidityIssue } from "./parseValidityOutput";

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
  return new vsc.Diagnostic(range, issue.message, severity);
}
