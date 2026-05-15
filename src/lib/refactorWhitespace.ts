export function refactorWhitespace(text: string, tabSize = 4): string {
  const tabReplacement = " ".repeat(tabSize);
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\t/g, tabReplacement);
}
