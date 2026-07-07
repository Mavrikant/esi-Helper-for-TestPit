import {
  COMPONENT_TAG_PATTERN,
  EnumDef,
  FieldDef,
  XmlIndex,
  isKnownComponent,
} from "./xmlIndex";

export type IssueKind =
  | "unknownConnection"
  | "unknownField"
  | "unknownEnum"
  | "unknownCsvCell"
  | "unbalancedTag"
  | "invalidNesting"
  | "outputFieldInInput"
  | "valueOutOfRange"
  | "duplicateKey";

export interface ComponentIssue {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  identifier: string;
  kind: IssueKind;
  /** Diagnostic severity; callers treat an absent value as "warning". */
  severity?: "error" | "warning";
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

// "Parameter" fields TestPit accepts inside a message block in addition to the
// message's own data fields — kept in sync with TestPit's ScriptMessageValidator.cpp
// (commonFields/outputFields across A429/1553/Discrete/PART/VORILS/A708). Only the
// single-token params are listed; multi-word ones ("time offset", "clear time",
// "frame count", "return code") aren't matched by ASSIGNMENT_RE so they're skipped
// anyway. Exported so the hover/semantic/completion providers share one source.
//
// NOTE: TestPit also lists VALUE as a Discrete-only param, but it is deliberately
// NOT included here: the XML index synthesizes a real enum-typed `value` field for
// DIS_ messages, so we WANT it validated against the discrete's enum table (and
// flagged on buses that don't define it).
export const PARAMETER_FIELDS = new Set([
  "time",
  "period",
  "interval",
  "occurrence",
  "count",
  "parity",
  "synchronize",
  "validity",
  "angle",
  "duration",
  "image",
]);

// --- Structural-check vocabulary (from TestPit ParserCharacterDefinitions.h) ---
// A section/message tag occupies its own line and TestPit tags are line-oriented,
// so a whole-line bracket is a tag while an inline `[..]` in prose/values is not.
// This keeps the structural checks free of prose false-positives.
const SECTION_LINE_RE = /^(\s*)\[\s*(\/?)\s*([^\]\r\n#]+?)\s*\]\s*(?:#.*)?$/;
const SEC_TEST_STEPS = "TEST STEPS";
const SEC_TEST_DEFINITION = "TEST DEFINITION";
const SEC_STEP_INPUTS = "STEP INPUTS";
const SEC_MANUAL_VERIFY = "MANUAL_VERIFY";
const SEC_EXTERNAL_VERIFY = "EXTERNAL_VERIFY";
const A708_TAG_PREFIX = "708_";
// occurrence/synchronize are output-only for EVERY bus (ScriptMessageValidator.cpp
// outputFields), so inside a STEP INPUTS message they are always an "unexpected
// output field in input message" — safe to flag regardless of bus. Bus-specific
// output params (validity/angle/…) are deliberately excluded to stay conservative.
const OUTPUT_ONLY_IN_INPUT = new Set(["occurrence", "synchronize"]);

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
    if (PARAMETER_FIELDS.has(fieldName)) {
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
      // Non-enum (numeric) field: range-check a bare numeric-literal RHS
      // against MinValue/MaxValue. Macros / CSV refs / ranges are skipped —
      // the value may be resolved by a macro pass or include, so never guess.
      checkNumericRange(field, line, lineNum, fieldName, issues);
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
      if (enumAccepts(field.enums, cellValue)) {
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
      // Not a symbolic identifier — may be a numeric enum value. TestPit
      // accepts an enum by its number too (getEnumValue), so validate a bare
      // integer literal against the enum table's numeric values.
      checkEnumNumericValue(field, line, lineNum, fieldName, issues);
      continue;
    }
    const value = valueMatch[0];
    if (enumAccepts(field.enums, value)) {
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

const INT_RE = /^[+-]?\d+$/;

/**
 * Is `raw` an accepted enum literal — a defined enum NAME, or (matching
 * TestPit's getEnumValue) the numeric VALUE of a defined enum? Numeric
 * matching only applies when both the RHS and the enum's value are integers.
 */
function enumAccepts(enums: EnumDef[], raw: string): boolean {
  const value = raw.trim();
  if (enums.some((e) => e.name === value)) {
    return true;
  }
  if (INT_RE.test(value)) {
    const n = parseInt(value, 10);
    return enums.some((e) => {
      const ev = (e.value ?? "").trim();
      return INT_RE.test(ev) && parseInt(ev, 10) === n;
    });
  }
  return false;
}

/**
 * Validate a bare integer RHS for an enum field against the enum table's
 * numeric values (TestPit accepts an enum by its number too). Skips macros,
 * CSV refs, floats, hex, and any enum table that carries no numeric values —
 * so the value is only judged when it is unambiguously resolvable here.
 */
function checkEnumNumericValue(
  field: FieldDef,
  line: string,
  lineNum: number,
  fieldName: string,
  issues: ComponentIssue[]
): void {
  if (!field.enums || field.enums.length === 0) {
    return;
  }
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) {
    return;
  }
  let rhs = line.slice(eqIndex + 1);
  const hash = rhs.indexOf("#");
  if (hash !== -1) {
    rhs = rhs.slice(0, hash);
  }
  const trimmed = rhs.trim();
  if (!INT_RE.test(trimmed)) {
    return; // not a bare integer (macro / float / hex / range) — leave it alone
  }
  const numericEnums = field.enums.filter((e) => INT_RE.test((e.value ?? "").trim()));
  if (numericEnums.length === 0) {
    return; // enum table has no numeric values to compare against
  }
  const val = parseInt(trimmed, 10);
  if (numericEnums.some((e) => parseInt(e.value.trim(), 10) === val)) {
    return;
  }
  const litStart = eqIndex + 1 + rhs.indexOf(trimmed);
  issues.push({
    line: lineNum,
    startCol: litStart,
    endCol: litStart + trimmed.length,
    message: `Unknown enum value ${trimmed} for field '${fieldName}'. Valid values: ${field.enums
      .map((e) => `${e.name}=${e.value}`)
      .join(", ")}.`,
    identifier: trimmed,
    kind: "unknownEnum",
    severity: "warning",
  });
}

/**
 * Range-check a numeric field assignment against its MinValue/MaxValue.
 * Only fires for a bare numeric literal RHS and a sensible closed range
 * (min < max); anything with a macro, CSV reference, range, or units is
 * left alone — its real value may only be known after preprocessing.
 */
function checkNumericRange(
  field: FieldDef,
  line: string,
  lineNum: number,
  fieldName: string,
  issues: ComponentIssue[]
): void {
  if (field.minValue === undefined || field.maxValue === undefined) {
    return;
  }
  const min = Number(field.minValue);
  const max = Number(field.maxValue);
  // Trust only a sensible closed range; skip placeholders like 0/0 or
  // inverted bounds to avoid false positives.
  if (!isFinite(min) || !isFinite(max) || !(max > min)) {
    return;
  }
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) {
    return;
  }
  let rhs = line.slice(eqIndex + 1);
  const hash = rhs.indexOf("#");
  if (hash !== -1) {
    rhs = rhs.slice(0, hash);
  }
  const trimmed = rhs.trim();
  // Bare numeric literal only — no %macro%, csv ref, range (a-b), or units.
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return;
  }
  const val = Number(trimmed);
  if (!isFinite(val) || (val >= min && val <= max)) {
    return;
  }
  const litStart = eqIndex + 1 + rhs.indexOf(trimmed);
  issues.push({
    line: lineNum,
    startCol: litStart,
    endCol: litStart + trimmed.length,
    message: `Value ${trimmed} for '${fieldName}' is outside the allowed range ${min}..${max}.`,
    identifier: trimmed,
    kind: "valueOutOfRange",
    severity: "warning",
  });
}

/**
 * Structural / nesting checks that DON'T need the XML index, so they run even
 * with no active profile loaded:
 *   - unbalanced / mismatched section tags
 *   - A708 message under [STEP INPUTS]                    (TestPit error)
 *   - MANUAL_VERIFY / EXTERNAL_VERIFY under [STEP INPUTS] (TestPit warning)
 *   - occurrence / synchronize (output-only) in a [STEP INPUTS] message
 *
 * Only runs on complete scripts (those with a [TEST STEPS] / [TEST DEFINITION]
 * root); include-fragments are skipped so partial trees aren't false-flagged.
 * Pure function — no vscode / fs dependency.
 */
export function validateStructure(documentText: string): ComponentIssue[] {
  const issues: ComponentIssue[] = [];
  const lines = documentText.split(/\r?\n/);

  // Fragment guard.
  let isCompleteScript = false;
  for (const raw of lines) {
    const m = SECTION_LINE_RE.exec(raw);
    if (m && m[2] !== "/") {
      const name = m[3].trim();
      if (name === SEC_TEST_STEPS || name === SEC_TEST_DEFINITION) {
        isCompleteScript = true;
        break;
      }
    }
  }
  if (!isCompleteScript) {
    return issues;
  }

  interface OpenTag {
    name: string;
    line: number;
    startCol: number;
    endCol: number;
    isComponent: boolean;
    keys?: Set<string>; // keys seen in this message block, for duplicate detection
  }
  const stack: OpenTag[] = [];
  const inInputBlock = (): boolean =>
    stack.some((s) => s.name === SEC_STEP_INPUTS);

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum];
    const m = SECTION_LINE_RE.exec(raw);
    if (m) {
      const closing = m[2] === "/";
      const name = m[3].trim();
      const lb = raw.indexOf("[");
      const rb = raw.indexOf("]");
      const startCol = lb >= 0 ? lb : 0;
      const endCol = rb >= 0 ? rb + 1 : raw.length;

      if (closing) {
        let matchIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx === -1) {
          issues.push({
            line: lineNum,
            startCol,
            endCol,
            message: `Closing tag [/${name}] has no matching opening tag.`,
            identifier: name,
            kind: "unbalancedTag",
            severity: "error",
          });
        } else {
          // Any tags opened after the match were never closed.
          for (let i = stack.length - 1; i > matchIdx; i--) {
            const o = stack[i];
            issues.push({
              line: o.line,
              startCol: o.startCol,
              endCol: o.endCol,
              message: `Section [${o.name}] is not closed before [/${name}].`,
              identifier: o.name,
              kind: "unbalancedTag",
              severity: "error",
            });
          }
          stack.splice(matchIdx, stack.length - matchIdx);
        }
        continue;
      }

      // Opening tag — nesting checks (only when a STEP INPUTS is an ancestor).
      if (inInputBlock()) {
        if (name.startsWith(A708_TAG_PREFIX)) {
          issues.push({
            line: lineNum,
            startCol,
            endCol,
            message: `A708 message '${name}' cannot be defined under a [STEP INPUTS] section.`,
            identifier: name,
            kind: "invalidNesting",
            severity: "error",
          });
        } else if (name === SEC_MANUAL_VERIFY || name === SEC_EXTERNAL_VERIFY) {
          issues.push({
            line: lineNum,
            startCol,
            endCol,
            message: `[${name}] is not valid under [STEP INPUTS] — it belongs in [STEP OUTPUTS].`,
            identifier: name,
            kind: "invalidNesting",
            severity: "warning",
          });
        }
      }
      const isComponent = COMPONENT_TAG_PATTERN.test(name);
      stack.push({
        name,
        line: lineNum,
        startCol,
        endCol,
        isComponent,
        keys: isComponent ? new Set<string>() : undefined,
      });
      continue;
    }

    // Non-tag line inside a message block: field-assignment checks.
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.isComponent && top.keys) {
        const a = ASSIGNMENT_RE.exec(raw);
        if (a) {
          const key = a[2];
          const col = a[1].length;
          // Duplicate key within this message block (TestPit getFieldsParams,
          // r2105 — case-agnostic duplicate-key error).
          if (top.keys.has(key)) {
            issues.push({
              line: lineNum,
              startCol: col,
              endCol: col + key.length,
              message: `Duplicate key '${key}' in message '${top.name}'.`,
              identifier: key,
              kind: "duplicateKey",
              severity: "error",
            });
          } else {
            top.keys.add(key);
          }
          // Output-only field used in an input message block.
          if (inInputBlock() && OUTPUT_ONLY_IN_INPUT.has(key)) {
            issues.push({
              line: lineNum,
              startCol: col,
              endCol: col + key.length,
              message: `Output-only field '${key}' has no effect in a [STEP INPUTS] message.`,
              identifier: key,
              kind: "outputFieldInInput",
              severity: "warning",
            });
          }
        }
      }
    }
  }

  // Anything still open at end-of-file is unclosed.
  for (const o of stack) {
    issues.push({
      line: o.line,
      startCol: o.startCol,
      endCol: o.endCol,
      message: `Section [${o.name}] is never closed.`,
      identifier: o.name,
      kind: "unbalancedTag",
      severity: "error",
    });
  }

  return issues;
}
