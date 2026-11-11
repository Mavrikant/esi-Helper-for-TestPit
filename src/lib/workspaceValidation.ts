// Pure (vscode-free) side of "Validate All .esi Files in Workspace":
// the in-process check pipeline for ONE script text, and the aggregation /
// wording of a whole-workspace run. The command (commands/validateWorkspace.ts)
// only finds files, reads them and publishes.
//
// Nothing here runs TestPit.exe — these are the same in-process checks the
// live "esi-components" diagnostics run (componentDiagnostics.ts).

import {
  ComponentIssue,
  CsvLookup,
  validateComponents,
  validateStructure,
} from "./componentValidator";
import { MacroIssue, MacroResolver, validateMacros } from "./macros";
import { StepIssue, checkSteps } from "./stepChecks";
import type { XmlIndex } from "./xmlIndex";

export type EsiIssue = ComponentIssue | StepIssue | MacroIssue;

export type EsiIssueSeverity = "error" | "warning" | "information" | "hint";

export interface EsiCheckDeps {
  /** Active project index; absent = structural / step / macro checks only. */
  index?: XmlIndex;
  /** CSV cell reader for this script (only used with an index). */
  csvLookup?: CsvLookup;
  /** Reads `[INCLUDE]`d files for the macro checks. */
  macroResolver?: MacroResolver;
}

/**
 * Every in-process check for one script: structure, step numbering, macros,
 * then — only with an index — component validation. The live diagnostics
 * (componentDiagnostics.ts validateAndPublish) call this too, so a check
 * added here reaches both.
 */
export function collectEsiIssues(text: string, deps: EsiCheckDeps = {}): EsiIssue[] {
  const issues: EsiIssue[] = validateStructure(text);
  issues.push(...checkSteps(text));
  issues.push(...validateMacros(text, deps.macroResolver ?? {}));
  if (deps.index) {
    issues.push(...validateComponents(text, deps.index, deps.csvLookup));
  }
  return issues;
}

/** An issue without a severity is a warning (as in componentDiagnostics.ts). */
export function issueSeverity(issue: { severity?: EsiIssueSeverity }): EsiIssueSeverity {
  return issue.severity ?? "warning";
}

/** A UTF-8 file read from disk may start with a BOM; an editor buffer never does. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface SeverityCounts {
  errors: number;
  warnings: number;
  /** Information + hint: shown in the Problems panel, not "problems" as such. */
  notes: number;
}

export function countSeverities(
  issues: ReadonlyArray<{ severity?: EsiIssueSeverity }>
): SeverityCounts {
  const counts: SeverityCounts = { errors: 0, warnings: 0, notes: 0 };
  for (const issue of issues) {
    const severity = issueSeverity(issue);
    if (severity === "error") {
      counts.errors++;
    } else if (severity === "warning") {
      counts.warnings++;
    } else {
      counts.notes++;
    }
  }
  return counts;
}

/** Outcome for one file of a workspace run. */
export type FileOutcome =
  | ({ path: string; status: "checked" } & SeverityCounts)
  | { path: string; status: "unreadable"; reason: string };

export function checkedFile(
  path: string,
  issues: ReadonlyArray<{ severity?: EsiIssueSeverity }>
): FileOutcome {
  return { path, status: "checked", ...countSeverities(issues) };
}

export function unreadableFile(path: string, reason: string): FileOutcome {
  return { path, status: "unreadable", reason };
}

export interface WorkspaceRunInfo {
  /** How many .esi files were found (>= outcomes.length when cancelled). */
  totalFiles: number;
  cancelled: boolean;
  /** False = no active project index: component checks did not run. */
  hasIndex: boolean;
  /** Active profile name, for the report only. */
  profile?: string;
}

export interface WorkspaceSummary extends SeverityCounts, WorkspaceRunInfo {
  /** Files actually checked (read and validated). */
  filesChecked: number;
  /** Checked files with at least one error or warning. */
  filesWithProblems: number;
  /** Files that could not be read — NOT validated, so not "clean". */
  filesUnreadable: number;
  /** Found but not reached (cancelled). */
  filesSkipped: number;
}

export function summarizeWorkspace(
  outcomes: readonly FileOutcome[],
  run: WorkspaceRunInfo
): WorkspaceSummary {
  const summary: WorkspaceSummary = {
    ...run,
    filesChecked: 0,
    filesWithProblems: 0,
    filesUnreadable: 0,
    filesSkipped: Math.max(0, run.totalFiles - outcomes.length),
    errors: 0,
    warnings: 0,
    notes: 0,
  };
  for (const outcome of outcomes) {
    if (outcome.status === "unreadable") {
      summary.filesUnreadable++;
      continue;
    }
    summary.filesChecked++;
    summary.errors += outcome.errors;
    summary.warnings += outcome.warnings;
    summary.notes += outcome.notes;
    if (outcome.errors > 0 || outcome.warnings > 0) {
      summary.filesWithProblems++;
    }
  }
  return summary;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export type SummaryLevel = "info" | "warning" | "error";

export interface SummaryMessage {
  level: SummaryLevel;
  message: string;
}

/**
 * The end-of-run notification. It never says a workspace is "valid": these
 * are the extension's in-process checks only, and the wording says so. A run
 * that was cancelled, hit unreadable files, or had no project index is at
 * least a warning — "0 errors" there does not mean every file was checked.
 */
export function formatSummary(summary: WorkspaceSummary): SummaryMessage {
  if (summary.totalFiles === 0) {
    return { level: "info", message: "No .esi files found in the workspace." };
  }
  const parts: string[] = [];
  const checked = summary.cancelled
    ? `Cancelled after ${summary.filesChecked + summary.filesUnreadable} of ${plural(summary.totalFiles, ".esi file")}`
    : `Checked ${plural(summary.filesChecked, ".esi file")}`;
  parts.push(
    `${checked}: ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}` +
      (summary.filesWithProblems > 0 ? ` in ${plural(summary.filesWithProblems, "file")}` : "") +
      "."
  );
  if (summary.filesUnreadable > 0) {
    parts.push(`${plural(summary.filesUnreadable, "file")} could not be read (see Output).`);
  }
  if (!summary.hasIndex) {
    parts.push("No active TestPit project: component checks were skipped.");
  }
  parts.push("In-process checks only; TestPit.exe was not run.");

  let level: SummaryLevel = "info";
  if (summary.errors > 0) {
    level = "error";
  } else if (
    summary.warnings > 0 ||
    summary.cancelled ||
    summary.filesUnreadable > 0 ||
    !summary.hasIndex
  ) {
    level = "warning";
  }
  return { level, message: parts.join(" ") };
}

/**
 * Lines for the output channel: a header, one line per file that has
 * anything to report (problem files first, worst first, then by path), and
 * the totals.
 */
export function formatReport(
  outcomes: readonly FileOutcome[],
  summary: WorkspaceSummary
): string[] {
  const lines: string[] = [];
  lines.push(
    `[validate-workspace] profile: ${summary.profile ?? "<none>"}` +
      (summary.hasIndex ? "" : " (structural only — no active project)")
  );
  const rank = (o: FileOutcome): number =>
    o.status === "unreadable" ? 0 : o.errors > 0 ? 1 : 2;
  const reportable = outcomes.filter(
    (o) => o.status === "unreadable" || o.errors + o.warnings + o.notes > 0
  );
  const sorted = reportable.slice().sort((a, b) => {
    if (rank(a) !== rank(b)) {
      return rank(a) - rank(b);
    }
    if (a.status === "checked" && b.status === "checked") {
      if (a.errors !== b.errors) {
        return b.errors - a.errors;
      }
      if (a.warnings !== b.warnings) {
        return b.warnings - a.warnings;
      }
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  for (const o of sorted) {
    if (o.status === "unreadable") {
      lines.push(`[validate-workspace] NOT CHECKED ${o.path}: ${o.reason}`);
    } else {
      const notes = o.notes > 0 ? `, ${plural(o.notes, "note")}` : "";
      lines.push(
        `[validate-workspace] ${o.path}: ${plural(o.errors, "error")}, ${plural(o.warnings, "warning")}${notes}`
      );
    }
  }
  const tail: string[] = [
    `${summary.filesChecked} of ${plural(summary.totalFiles, "file")} checked`,
    plural(summary.errors, "error"),
    plural(summary.warnings, "warning"),
  ];
  if (summary.notes > 0) {
    tail.push(plural(summary.notes, "note"));
  }
  if (summary.filesUnreadable > 0) {
    tail.push(`${summary.filesUnreadable} unreadable`);
  }
  if (summary.cancelled) {
    tail.push(`cancelled, ${summary.filesSkipped} not reached`);
  }
  lines.push(`[validate-workspace] ${tail.join(", ")}`);
  return lines;
}

/** Progress text for the file about to be checked (1-based position). */
export function progressLabel(position: number, total: number, name: string): string {
  return `${position}/${total} ${name}`;
}
