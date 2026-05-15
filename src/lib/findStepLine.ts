export function findStepLine(text: string, stepNumber: string): number {
  const stepRegex = new RegExp(`\\[STEP ${stepNumber}\\]`);
  const lines = text.split("\n");
  return lines.findIndex((line) => stepRegex.test(line));
}
