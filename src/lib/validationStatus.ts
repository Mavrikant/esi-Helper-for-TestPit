// What the validation status-bar item shows for the active .esi editor.
// vscode-free; statusBar.ts supplies the facts and applies the result.

/** Numeric values of vscode.DiagnosticSeverity. */
const SEVERITY_ERROR = 0;
const SEVERITY_WARNING = 1;

/** Why the live TestPit.exe check is, or is not, feeding the counts. */
export type LiveCheckState =
  /** Live check on and an executable is configured. */
  | "live"
  /** `esihelper.liveValidation` is false. */
  | "disabled"
  /** No TestPit executable picked yet: the live check skips silently. */
  | "no-exe";

export interface ValidationStatusInput {
  /** TestPit.exe is running for this document right now. */
  running: boolean;
  errors: number;
  warnings: number;
  liveCheck: LiveCheckState;
}

export interface ValidationStatus {
  text: string;
  tooltip: string;
}

/** Errors and warnings among diagnostic severities (info/hint are ignored). */
export function countSeverities(severities: Iterable<number>): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const severity of severities) {
    if (severity === SEVERITY_ERROR) {
      errors++;
    } else if (severity === SEVERITY_WARNING) {
      warnings++;
    }
  }
  return { errors, warnings };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Counts are always shown as numbers, never as a "passed" mark: zero problems
 * only means nothing was reported, and without a TestPit run (no executable,
 * live check off) the TestPit part may be missing or out of date — the tooltip
 * says so.
 */
export function renderValidationStatus(
  input: ValidationStatusInput
): ValidationStatus {
  if (input.running) {
    return {
      text: "$(sync~spin) validating…",
      tooltip:
        "TestPit.exe is checking this file. Click to open the Problems panel.",
    };
  }
  const lines = [
    `${plural(input.errors, "error")}, ${plural(input.warnings, "warning")} reported for this file. Click to open the Problems panel.`,
  ];
  if (input.liveCheck === "disabled") {
    lines.push(
      "The live TestPit check is off (esihelper.liveValidation): TestPit results are only those of the last “Run Validity Check” and may not match the current text."
    );
  } else if (input.liveCheck === "no-exe") {
    lines.push(
      "No TestPit executable is set, so the TestPit validity check has not run: the counts hold the extension's own checks only."
    );
  }
  return {
    text: `$(error) ${input.errors} $(warning) ${input.warnings}`,
    tooltip: lines.join("\n"),
  };
}
