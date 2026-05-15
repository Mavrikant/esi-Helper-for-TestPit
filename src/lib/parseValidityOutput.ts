export type ValiditySeverity = "error" | "warning";

export interface ValidityIssue {
  lineNumber: number;
  startCol: number;
  endCol: number;
  severity: ValiditySeverity;
  message: string;
}

const ISSUE_PATTERN = /\[(Fatal|Error|Warn.)\].*(Line:|Line\(s\):)\s?(\d+)/;
const MESSAGE_PREFIX_LENGTH = 8;

export function parseValidityOutput(
  validityOutput: string,
  documentLines: string[]
): ValidityIssue[] {
  if (documentLines.length === 0) {
    return [];
  }
  const issues: ValidityIssue[] = [];
  for (const line of validityOutput.split("\n")) {
    const match = line.match(ISSUE_PATTERN);
    if (!match) {
      continue;
    }
    const type = match[1];
    let lineNumber = parseInt(match[3], 10) - 1;
    if (Number.isNaN(lineNumber) || lineNumber < 0) {
      lineNumber = 0;
    }
    if (lineNumber >= documentLines.length) {
      lineNumber = documentLines.length - 1;
    }
    const lineText = documentLines[lineNumber];
    const startCol = lineText.search(/\S|$/);
    const endCol = lineText.trimEnd().length;
    const message = line.trim().slice(MESSAGE_PREFIX_LENGTH);
    const severity: ValiditySeverity = type === "Warn." ? "warning" : "error";
    issues.push({ lineNumber, startCol, endCol, severity, message });
  }
  return issues;
}
