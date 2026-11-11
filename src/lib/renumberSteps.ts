import { parseSectionTagLine, SectionTagKind } from "./parseSectionTag";

/**
 * Step renumbering: every NUMBERED step (`[STEP 5]`) gets the next multiple of
 * `increment` in document order — 10, 20, 30, … by default.
 *
 * Tag shapes come from `parseSectionTagLine`, so the one-liner `[STEP 5/]` and
 * the sloppy forms TestPit repairs (`[[STEP 5]]`, `[//STEP 5]`, `[STEP 5] junk`,
 * `[STEP 5`) are renumbered too. A closing tag is renumbered with ITS opener
 * (found on a section stack), never by counting closers. Steps with a
 * non-numeric id (`[STEP GET_DUMP]`, `[STEP %N%]`) and the `STEP DEFINITION` /
 * `STEP INPUTS` / `STEP OUTPUTS` / `STEP DUMP` parts are left alone and do not
 * use up a number.
 *
 * Only the digits change: the rest of every line, and every line break, is
 * kept byte-for-byte. vscode-free.
 */

/** A numbered step tag found on one line. */
export interface NumberedStepTag {
  kind: SectionTagKind;
  /** Normalized tag name, e.g. `STEP 10`. */
  name: string;
  /** The digits as written (`10`, `007`). */
  digits: string;
  /** Column of the first digit in the original line. */
  startCol: number;
  /** Column just past the last digit in the original line. */
  endCol: number;
}

/** One replacement of a step number; confined to a single line. */
export interface StepNumberEdit {
  /** 0-indexed line. */
  line: number;
  startCol: number;
  endCol: number;
  oldText: string;
  newText: string;
}

export interface StepRenumberPlan {
  /** Numbered steps in the script (openers and one-liners). */
  steps: number;
  /** How many of those steps get a different number (opener and/or closer). */
  changed: number;
  /** The digit replacements, in document order. Empty when nothing changes. */
  edits: StepNumberEdit[];
}

const NUMBERED_STEP_NAME_RE = /^STEP +(\d+)$/;

/**
 * The numbered step tag on a line, or `undefined` when the line is anything
 * else (content, another section, a step with a non-numeric id, or a tag
 * TestPit would reject).
 */
export function parseNumberedStepTag(raw: string): NumberedStepTag | undefined {
  const tag = parseSectionTagLine(raw);
  if (!tag || tag.invalid) {
    return undefined;
  }
  const m = NUMBERED_STEP_NAME_RE.exec(tag.name);
  if (!m) {
    return undefined;
  }
  // The normalized name is a contiguous slice of the line (tabs read as
  // spaces, which keeps columns), so the digits sit at its end.
  const nameCol = raw.replace(/\t/g, " ").indexOf(tag.name, tag.startCol);
  if (nameCol < 0) {
    return undefined;
  }
  const endCol = nameCol + tag.name.length;
  return {
    kind: tag.kind,
    name: tag.name,
    digits: m[1],
    startCol: endCol - m[1].length,
    endCol,
  };
}

interface OpenSection {
  name: string;
  /** Set for a numbered step: the number its closer must get. */
  newNumber?: string;
  /** Set for a numbered step: its slot in the per-step "changed" list. */
  stepIndex?: number;
}

/** Work out which step numbers change, without touching the text. */
export function planStepRenumber(text: string, increment = 10): StepRenumberPlan {
  const lines = text.split(/\r?\n/);
  const edits: StepNumberEdit[] = [];
  const changedSteps: boolean[] = [];
  const stack: OpenSection[] = [];

  const replace = (
    line: number,
    tag: NumberedStepTag,
    newNumber: string,
    stepIndex: number
  ): void => {
    if (tag.digits === newNumber) {
      return;
    }
    edits.push({
      line,
      startCol: tag.startCol,
      endCol: tag.endCol,
      oldText: tag.digits,
      newText: newNumber,
    });
    changedSteps[stepIndex] = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const tag = parseSectionTagLine(lines[i]);
    if (!tag || tag.invalid) {
      continue;
    }
    const step = parseNumberedStepTag(lines[i]);

    if (tag.kind === "close") {
      let at = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === tag.name) {
          at = s;
          break;
        }
      }
      // A numbered closer whose number matches no open step, met while a
      // numbered step is the innermost open section, closes that step: its
      // number was simply left stale (the usual copy-paste slip).
      if (
        at < 0 &&
        step &&
        stack.length > 0 &&
        stack[stack.length - 1].newNumber !== undefined
      ) {
        at = stack.length - 1;
      }
      if (at < 0) {
        continue; // orphan closer: nothing to pair it with, leave it
      }
      const opener = stack[at];
      stack.splice(at);
      if (step && opener.newNumber !== undefined && opener.stepIndex !== undefined) {
        replace(i, step, opener.newNumber, opener.stepIndex);
      }
      continue;
    }

    let entry: OpenSection = { name: tag.name };
    if (step) {
      const stepIndex = changedSteps.length;
      const newNumber = String((stepIndex + 1) * increment);
      changedSteps.push(false);
      replace(i, step, newNumber, stepIndex);
      entry = { name: tag.name, newNumber, stepIndex };
    }
    // A one-liner opens and closes on its own line: never on the stack.
    if (tag.kind === "open") {
      stack.push(entry);
    }
  }

  return {
    steps: changedSteps.length,
    changed: changedSteps.filter(Boolean).length,
    edits,
  };
}

/** Apply a plan's edits. Everything outside the replaced digits is untouched. */
export function applyStepNumberEdits(
  text: string,
  edits: readonly StepNumberEdit[]
): string {
  if (edits.length === 0) {
    return text;
  }
  // Even slots are lines, odd slots their line breaks (kept as they are).
  const parts = text.split(/(\r?\n)/);
  // Right-to-left, so earlier columns on the same line stay valid.
  const ordered = [...edits].sort(
    (a, b) => b.line - a.line || b.startCol - a.startCol
  );
  for (const e of ordered) {
    const line = parts[e.line * 2];
    if (line === undefined) {
      continue;
    }
    parts[e.line * 2] =
      line.slice(0, e.startCol) + e.newText + line.slice(e.endCol);
  }
  return parts.join("");
}

export function renumberSteps(text: string, increment = 10): string {
  return applyStepNumberEdits(text, planStepRenumber(text, increment).edits);
}

/**
 * What the renumber command tells the user. `increment` only shapes the
 * example sequence in the "already sequential" wording.
 */
export function describeStepRenumber(
  plan: StepRenumberPlan,
  increment = 10
): string {
  const noun = (n: number): string => (n === 1 ? "step" : "steps");
  if (plan.steps === 0) {
    return "No numbered steps found — nothing to renumber.";
  }
  if (plan.edits.length === 0) {
    const sequence =
      plan.steps === 1
        ? `${increment}`
        : `${increment}, ${increment * 2}, …`;
    return `Steps are already sequential (${plan.steps} ${noun(plan.steps)}: ${sequence}).`;
  }
  return `Renumbered ${plan.changed} of ${plan.steps} ${noun(plan.steps)}.`;
}
