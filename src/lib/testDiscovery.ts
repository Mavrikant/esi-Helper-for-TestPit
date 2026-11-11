// Pure (vscode-free) side of the Test Explorer integration
// (src/testing/esiTestController.ts): which steps a script shows as children,
// and how the issues of ONE TestPit validity run are spread over them.
//
// What a result here means — and all it means: the extension can only run
// TestPit's VALIDITY check (`--validateScriptOnly=true`, see profiles.ts). It
// cannot execute a test. So "passed" is "TestPit reported no error for this
// text", never "the test passed on the unit under test". The wording constants
// below are the single place that says so to the user; keep them honest.

import { listSteps } from "./listSteps";
import type { ValidityIssue } from "./parseValidityOutput";
import type { ValidityOutcome } from "./validityResults";

/** The one run profile. Named after what it does, not "Run". */
export const VALIDATE_PROFILE_LABEL = "Validate (TestPit validity check)";

/** Test Explorer heading for the controller. */
export const CONTROLLER_LABEL = "esi scripts (TestPit validity check)";

/** Name of a run in the test-results history. */
export const RUN_NAME = "TestPit validity check";

/** First lines of every run's output. */
export const RUN_DISCLAIMER: readonly string[] = [
  "TestPit validity check only (--validateScriptOnly): the script text is checked, the test is NOT executed.",
  "A passed item means TestPit reported no error for it in this check - it says nothing about the result of the test on hardware.",
];

/** Shown (as run output) when no TestPit.exe is configured. */
export const NO_EXE_MESSAGE =
  'Skipped - nothing was validated: no TestPit executable is configured. Run the command "ESI Helper: Pick TestPit Executable" and validate again.';

/** One `[STEP <id>]` block as a Test Explorer child of its script. */
export interface DiscoveredStep {
  /** Unique within the script, stable while the step keeps its number. */
  id: string;
  /** The normalized tag name, e.g. `STEP 10`. */
  label: string;
  /** `Step Description` of the step, or "". */
  description: string;
  /** 0-indexed lines of the opening and the closing tag. */
  line: number;
  endLine: number;
}

/**
 * The steps of a script, in document order (via `listSteps`, so tag shapes
 * come from parseSectionTag). Ids are the step label; a label used more than
 * once gets `#2`, `#3`, … on the later ones so every child stays addressable.
 */
export function discoverSteps(text: string): DiscoveredStep[] {
  const seen = new Map<string, number>();
  return listSteps(text).map((step) => {
    const n = (seen.get(step.label) ?? 0) + 1;
    seen.set(step.label, n);
    return {
      id: n === 1 ? step.label : `${step.label}#${n}`,
      label: step.label,
      description: step.description,
      line: step.line,
      endLine: step.endLine,
    };
  });
}

/**
 * - `passed`: validated, no error reported (warnings do not fail an item);
 * - `failed`: validated, at least one error;
 * - `notChecked`: TestPit produced no validation log — nothing is known.
 */
export type ValidationStatus = "passed" | "failed" | "notChecked";

export interface StepValidation {
  id: string;
  status: ValidationStatus;
  /** Issues on a line inside this step. */
  errors: ValidityIssue[];
  warnings: ValidityIssue[];
}

export interface ScriptValidation {
  status: ValidationStatus;
  /** One sentence for the script item (the validity summary's message). */
  message: string;
  /** Issues on a line outside every step: they belong to the script itself. */
  errors: ValidityIssue[];
  warnings: ValidityIssue[];
  /** One entry per discovered step, in the order given. */
  steps: StepValidation[];
}

/** The part of `summarizeValidity`'s result the mapping needs. */
export interface ValidityVerdict {
  outcome: ValidityOutcome;
  message: string;
}

/**
 * The step whose block holds `line` (0-indexed). Blocks are not expected to
 * overlap; if they do (an unclosed step), the one that starts last wins.
 */
export function stepContainingLine<T extends { line: number; endLine: number }>(
  steps: readonly T[],
  line: number
): T | undefined {
  let found: T | undefined;
  for (const step of steps) {
    if (line >= step.line && line <= step.endLine && (!found || step.line >= found.line)) {
      found = step;
    }
  }
  return found;
}

/**
 * Spread the issues of one validity run over the script and its steps.
 *
 * `steps` and `issues` must come from the SAME text (issue lines are 0-indexed
 * lines of the validated text). `verdict` is `summarizeValidity`'s result for
 * the run; it decides the script's status, because TestPit also reports
 * errors without a line number, which no issue carries:
 *   - `no-log`  → the script and every step are `notChecked`;
 *   - `errors`  → the script failed, even if no located issue is an error;
 *   - otherwise → the script passed.
 * A step fails only for an ERROR on one of its lines; a step with no issue,
 * or with warnings only, passes.
 */
export function mapValidityToSteps(
  steps: readonly DiscoveredStep[],
  issues: readonly ValidityIssue[],
  verdict: ValidityVerdict
): ScriptValidation {
  const checked = verdict.outcome !== "no-log";
  const byId = new Map<string, StepValidation>();
  const stepResults = steps.map((step) => {
    const result: StepValidation = {
      id: step.id,
      status: checked ? "passed" : "notChecked",
      errors: [],
      warnings: [],
    };
    byId.set(step.id, result);
    return result;
  });
  const script: ScriptValidation = {
    status: !checked ? "notChecked" : verdict.outcome === "errors" ? "failed" : "passed",
    message: verdict.message,
    errors: [],
    warnings: [],
    steps: stepResults,
  };

  for (const issue of issues) {
    const step = stepContainingLine(steps, issue.lineNumber);
    const target = (step && byId.get(step.id)) ?? script;
    if (issue.severity === "error") {
      target.errors.push(issue);
      if (checked) {
        target.status = "failed";
      }
    } else {
      target.warnings.push(issue);
    }
  }
  return script;
}

/** Text of an issue for a test message / an output line (1-based line). */
export function formatIssue(issue: ValidityIssue): string {
  return `${issue.severity === "warning" ? "Warning" : "Error"} (line ${issue.lineNumber + 1}): ${issue.message}`;
}
