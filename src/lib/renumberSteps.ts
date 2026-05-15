const STEP_OPEN = /\[STEP \d+\]/g;
const STEP_CLOSE = /\[\/STEP \d+\]/g;

export function renumberSteps(text: string, increment = 10): string {
  const stepCount = (text.match(STEP_OPEN) || []).length;
  let result = text.replace(STEP_OPEN, "[STEP XX]");
  for (let i = 0; i < stepCount; i++) {
    result = result.replace("[STEP XX]", `[STEP ${(i + 1) * increment}]`);
  }
  result = result.replace(STEP_CLOSE, "[/STEP XX]");
  for (let i = 0; i < stepCount; i++) {
    result = result.replace("[/STEP XX]", `[/STEP ${(i + 1) * increment}]`);
  }
  return result;
}
