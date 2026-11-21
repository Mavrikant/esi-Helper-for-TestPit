import {
  parseNumberedStepTag,
  planStepRenumber,
  StepNumberEdit,
} from "./renumberSteps";

/**
 * Step-number hygiene checks. Pure: text in, issues out (ComponentIssue-shaped,
 * see componentValidator.ts), so the diagnostics glue can publish them next to
 * the structural ones.
 *
 * Neither finding is something TestPit is known to reject — its source is not
 * in this repo — so neither is an error:
 *  - a step number used twice is a WARNING, because the extension itself
 *    cannot tell the two steps apart (Go to Step lands on the first one);
 *  - a step number lower than the one before it is INFORMATION only.
 * Only numbered steps are looked at; `[STEP GET_DUMP]`, `[STEP %N%]` and the
 * `STEP DEFINITION` / `INPUTS` / `OUTPUTS` / `DUMP` parts are ignored.
 */

export type StepIssueKind = "duplicateStepNumber" | "stepOutOfOrder";

export const STEP_ISSUE_KINDS: readonly StepIssueKind[] = [
  "duplicateStepNumber",
  "stepOutOfOrder",
];

export function isStepIssueKind(kind: unknown): kind is StepIssueKind {
  return (STEP_ISSUE_KINDS as readonly unknown[]).includes(kind);
}

export interface StepIssue {
  /** 0-indexed line of the step's opening tag. */
  line: number;
  /** The step number's digits. */
  startCol: number;
  endCol: number;
  message: string;
  /** The normalized tag name, e.g. `STEP 10`. */
  identifier: string;
  kind: StepIssueKind;
  severity: "warning" | "information";
}

export function checkSteps(text: string): StepIssue[] {
  const lines = text.split(/\r?\n/);
  const issues: StepIssue[] = [];
  /** Step number → line (0-indexed) of the first step that uses it. */
  const firstLine = new Map<number, number>();
  let previous: { value: number; digits: string } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const tag = parseNumberedStepTag(lines[i]);
    if (!tag || tag.kind === "close") {
      continue;
    }
    const value = Number(tag.digits);
    const at = { line: i, startCol: tag.startCol, endCol: tag.endCol };
    const first = firstLine.get(value);
    if (first !== undefined) {
      issues.push({
        ...at,
        message: `Step number ${tag.digits} is already used by the step at line ${first + 1}.`,
        identifier: tag.name,
        kind: "duplicateStepNumber",
        severity: "warning",
      });
    } else {
      firstLine.set(value, i);
      if (previous && value < previous.value) {
        issues.push({
          ...at,
          message: `Step ${tag.digits} comes after step ${previous.digits}: step numbers are not in ascending order.`,
          identifier: tag.name,
          kind: "stepOutOfOrder",
          severity: "information",
        });
      }
    }
    previous = { value, digits: tag.digits };
  }
  return issues;
}

/** Same shape as `FixEdit` in quickFixes.ts. */
export interface StepFixEdit {
  line: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
}

/** Same shape as `QuickFix` in quickFixes.ts. */
export interface StepQuickFix {
  title: string;
  edits: StepFixEdit[];
  preferred: boolean;
}

export const RENUMBER_STEPS_FIX_TITLE = "Renumber steps";

function toFixEdit(e: StepNumberEdit): StepFixEdit {
  return {
    line: e.line,
    startCol: e.startCol,
    endLine: e.line,
    endCol: e.endCol,
    newText: e.newText,
  };
}

/**
 * The quick fix for both step issues: renumber every numbered step of the file
 * (the same edit as the Update Step Numbers command). `undefined` when the
 * steps are already sequential. Never "preferred" — it rewrites the numbers of
 * the whole file, so it must be picked on purpose.
 */
export function computeRenumberStepsFix(
  text: string,
  increment = 10
): StepQuickFix | undefined {
  const { edits } = planStepRenumber(text, increment);
  if (edits.length === 0) {
    return undefined;
  }
  return {
    title: RENUMBER_STEPS_FIX_TITLE,
    edits: edits.map(toFixEdit),
    preferred: false,
  };
}
