/**
 * The number to propose for a NEW `[STEP <n>]` typed at a given line, read
 * off the numbering the file already uses. vscode-free.
 *
 * Only what the script itself shows is used: the numbered steps (found by
 * renumberSteps.parseNumberedStepTag, so one-liners and the sloppy tag forms
 * count, while `[STEP GET_DUMP]` / `[STEP %N%]` do not) and the gap between
 * them. It is a proposal in a snippet placeholder — the user can overtype it,
 * and "Update Step Numbers" renumbers the whole file afterwards.
 */
import { parseNumberedStepTag } from "./renumberSteps";

/** renumberSteps' default increment, used when the file shows no gap. */
export const DEFAULT_STEP_INCREMENT = 10;

interface NumberedStep {
  line: number;
  digits: string;
  value: number;
}

function numberedSteps(lines: readonly string[], skipLine: number): NumberedStep[] {
  const steps: NumberedStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === skipLine) {
      continue;
    }
    const tag = parseNumberedStepTag(lines[i]);
    if (tag && tag.kind !== "close") {
      steps.push({ line: i, digits: tag.digits, value: parseInt(tag.digits, 10) });
    }
  }
  return steps;
}

/**
 * The gap the file's numbering uses: the most frequent positive difference
 * between consecutive steps (the smaller one on a tie). A file with a single
 * step shows no gap; renumbering starts at the increment, so that step's own
 * number is taken as the gap (10 → 20, 1 → 2).
 */
function inferIncrement(steps: readonly NumberedStep[]): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < steps.length; i++) {
    const diff = steps[i].value - steps[i - 1].value;
    if (diff > 0) {
      counts.set(diff, (counts.get(diff) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [diff, count] of counts) {
    if (count > bestCount || (count === bestCount && diff < best)) {
      best = diff;
      bestCount = count;
    }
  }
  if (best > 0) {
    return best;
  }
  return steps.length === 1 && steps[0].value > 0
    ? steps[0].value
    : DEFAULT_STEP_INCREMENT;
}

/**
 * Propose the number for a step opened on `lineIndex` (0-indexed; the line
 * itself is ignored, so a half-typed tag there does not count).
 *
 * - no numbered step yet: the default increment (`10`);
 * - otherwise the previous step's number plus the file's gap, when that fits
 *   before the following step and is not taken;
 * - else a free number half-way between the neighbours;
 * - else one gap past the highest number in the file (never a duplicate).
 *
 * Zero padding (`001`, `002`) is kept when the file uses it.
 */
export function nextStepNumber(lines: readonly string[], lineIndex: number): string {
  const steps = numberedSteps(lines, lineIndex);
  if (steps.length === 0) {
    return String(DEFAULT_STEP_INCREMENT);
  }
  const increment = inferIncrement(steps);
  const used = new Set(steps.map((s) => s.value));
  const before = steps.filter((s) => s.line < lineIndex);
  const prev = before.length > 0 ? before[before.length - 1] : undefined;
  const next = steps.find((s) => s.line > lineIndex);
  const highest = Math.max(...steps.map((s) => s.value));

  const fits = (n: number): boolean =>
    n > 0 &&
    !used.has(n) &&
    (prev === undefined || n > prev.value) &&
    (next === undefined || n < next.value);

  let value: number;
  const stepped = prev ? prev.value + increment : (next?.value ?? 0) - increment;
  const middle =
    prev && next ? Math.floor((prev.value + next.value) / 2) : undefined;
  if (fits(stepped)) {
    value = stepped;
  } else if (middle !== undefined && fits(middle)) {
    value = middle;
  } else {
    value = highest + increment;
  }

  const padded = steps.some((s) => s.digits.length > 1 && s.digits.startsWith("0"));
  const width = padded ? Math.max(...steps.map((s) => s.digits.length)) : 0;
  return String(value).padStart(width, "0");
}
