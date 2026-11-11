/**
 * 0-indexed line of the first `[STEP <stepNumber>]` in `text`, or -1.
 *
 * The step number is matched literally (plain substring, no RegExp), so user
 * input such as `1.` or `(` can neither over-match nor throw.
 */
export function findStepLine(text: string, stepNumber: string): number {
  const needle = `[STEP ${stepNumber}]`;
  const lines = text.split(/\r?\n/);
  return lines.findIndex((line) => line.includes(needle));
}
