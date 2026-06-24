import { COMPONENT_TAG_PATTERN, XmlIndex, isKnownComponent } from "./xmlIndex";

export type IssueKind =
  | "unknownConnection"
  | "unknownField"
  | "unknownEnum"
  | "unknownCsvCell";

export interface ComponentIssue {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  identifier: string;
  kind: IssueKind;
}

/**
 * Looks up a single cell in a CSV file referenced by an .esi script.
 * Implementation lives in componentDiagnostics.ts (the VS Code wrapper)
 * because reading the CSV needs fs access + the .esi file's directory
 * for path resolution; the validator stays pure.
 *
 * Returns the cell value (already trimmed and unquoted), or undefined
 * if the file can't be read or the requested cell doesn't exist.
 */
export type CsvLookup = (
  filename: string,
  line: number,
  col: number
) => string | undefined;

const TAG_RE = /\[(\/?)([A-Za-z0-9_]+)\]/g;
// Field name may include dots (1553 `Mode.SelectedCourse`).
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;
const RHS_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
// `<filename>.csv line:<N> col:<M>` — the input-from-CSV pattern that
// scripts use to pull a value out of a fixture spreadsheet at runtime.
// Whitespace around `:` is tolerated.
const CSV_REF_RE = /^([A-Za-z0-9_.\-]+\.csv)\s+line\s*:\s*(\d+)\s+col\s*:\s*(\d+)/i;
const COMPONENT_TAG = COMPONENT_TAG_PATTERN;

// Built-in scheduling keywords valid inside any component block — never
// flagged as unknown fields.
const TIMING_FIELDS = new Set(["time", "interval", "occurrence", "period"]);

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
  index: XmlIndex,
  csvLookup?: CsvLookup
): ComponentIssue[] {
  const issues: ComponentIssue[] = [];
  // Split on either LF or CRLF — VS Code documents on Windows commonly
  // carry CRLF, and a trailing \r breaks the assignment regex's $ anchor.
  const lines = documentText.split(/\r?\n/);
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
      if (isComponent && !isKnownComponent(index, name)) {
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
    // Validate against the enum table whenever the field has one — the type
    // string varies across configs ("Enum", "Enum8", "Enum16", …), so the
    // presence of an enum table is the reliable signal, not the type name.
    if (!field.enums || field.enums.length === 0) {
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

    // CSV reference form: `myfile.csv line:N col:M`. Look up the actual
    // cell value and validate THAT against the field's enum table.
    const csvMatch = CSV_REF_RE.exec(rhsTail);
    if (csvMatch) {
      const csvFile = csvMatch[1];
      const csvLine = parseInt(csvMatch[2], 10);
      const csvCol = parseInt(csvMatch[3], 10);
      const refStartCol = rhsStart;
      const refEndCol = rhsStart + csvMatch[0].length;
      if (!csvLookup) {
        continue;
      }
      const cellValue = csvLookup(csvFile, csvLine, csvCol);
      if (cellValue === undefined) {
        issues.push({
          line: lineNum,
          startCol: refStartCol,
          endCol: refEndCol,
          message: `CSV cell '${csvFile}' line:${csvLine} col:${csvCol} not found (file unreadable or out-of-range).`,
          identifier: csvMatch[0],
          kind: "unknownCsvCell",
        });
        continue;
      }
      if (field.enums.some((e) => e.name === cellValue)) {
        continue;
      }
      issues.push({
        line: lineNum,
        startCol: refStartCol,
        endCol: refEndCol,
        message: `Unknown enum value '${cellValue}' (from ${csvFile} line:${csvLine} col:${csvCol}) for field '${fieldName}'. Valid: ${field.enums
          .map((e) => e.name)
          .join(", ")}.`,
        identifier: cellValue,
        kind: "unknownEnum",
      });
      continue;
    }

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
