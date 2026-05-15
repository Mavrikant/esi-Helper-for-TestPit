import { XmlIndex } from "./xmlIndex";

export type IssueKind =
  | "unknownConnection"
  | "unknownField"
  | "unknownEnum";

export interface ComponentIssue {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  identifier: string;
  kind: IssueKind;
}

const TAG_RE = /\[(\/?)([A-Za-z0-9_]+)\]/g;
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const RHS_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const COMPONENT_TAG = /^(429|1553|Discrete|Mem)_/;

const TIMING_FIELDS = new Set(["time", "delay"]);

interface StackEntry {
  name: string;
  isComponent: boolean;
}

/**
 * Walk the document and emit a warning for each identifier that the XML
 * index doesn't know about:
 *   - Component tags ([429_…]) whose connection is missing
 *   - Field names inside an open component that aren't in its message
 *   - Enum values on the RHS of `=` that aren't in the field's enum list
 *
 * Pure function (no vscode dependency) — see componentDiagnostics.ts for the
 * VS Code wiring.
 */
export function validateComponents(
  documentText: string,
  index: XmlIndex
): ComponentIssue[] {
  const issues: ComponentIssue[] = [];
  const lines = documentText.split("\n");
  const stack: StackEntry[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Walk all tags on the line (open + close), maintain the depth stack
    // and emit unknown-connection issues for any unrecognized component opener.
    TAG_RE.lastIndex = 0;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = TAG_RE.exec(line)) !== null) {
      const isClosing = tagMatch[1] === "/";
      const name = tagMatch[2];
      if (isClosing) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) {
            stack.splice(i, stack.length - i);
            break;
          }
        }
        continue;
      }
      const isComponent = COMPONENT_TAG.test(name);
      stack.push({ name, isComponent });
      if (isComponent && !index.connections.has(name)) {
        const startCol = tagMatch.index + 1; // skip the [
        issues.push({
          line: lineNum,
          startCol,
          endCol: startCol + name.length,
          message: `Unknown TestPit component '${name}' — not present in the active project's MessageConfig.`,
          identifier: name,
          kind: "unknownConnection",
        });
      }
    }

    // Field assignment inside an open component block.
    const enclosing = topComponent(stack);
    if (!enclosing) {
      continue;
    }
    const assignMatch = ASSIGNMENT_RE.exec(line);
    if (!assignMatch) {
      continue;
    }
    const fieldName = assignMatch[2];
    if (TIMING_FIELDS.has(fieldName)) {
      continue;
    }
    const message = index.resolveConnectionMessage(enclosing);
    if (!message) {
      // Connection is unknown OR has no resolvable message — already
      // flagged above (or silently skipped). Don't double-warn on field.
      continue;
    }
    const field = message.fields.find((f) => f.name === fieldName);
    if (!field) {
      const startCol = assignMatch[1].length;
      issues.push({
        line: lineNum,
        startCol,
        endCol: startCol + fieldName.length,
        message: `Unknown field '${fieldName}' for message '${message.name}'.`,
        identifier: fieldName,
        kind: "unknownField",
      });
      continue;
    }
    if (field.dataType !== "Enum" || !field.enums || field.enums.length === 0) {
      continue;
    }

    // Validate the RHS identifier against the field's enum table.
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    let rhsStart = eqIndex + 1;
    while (rhsStart < line.length && line[rhsStart] === " ") {
      rhsStart += 1;
    }
    const rhsTail = line.slice(rhsStart);
    const valueMatch = RHS_IDENT_RE.exec(rhsTail);
    if (!valueMatch) {
      continue;
    }
    const value = valueMatch[0];
    if (field.enums.some((e) => e.name === value)) {
      continue;
    }
    issues.push({
      line: lineNum,
      startCol: rhsStart,
      endCol: rhsStart + value.length,
      message: `Unknown enum value '${value}' for field '${fieldName}'. Valid: ${field.enums
        .map((e) => e.name)
        .join(", ")}.`,
      identifier: value,
      kind: "unknownEnum",
    });
  }

  return issues;
}

function topComponent(stack: StackEntry[]): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].isComponent) {
      return stack[i].name;
    }
  }
  return undefined;
}
