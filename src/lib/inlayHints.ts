import { ASSIGNMENT_RE, PARAMETER_FIELDS } from "./componentValidator";
import { parseSectionTagLine } from "./parseSectionTag";
import { SEC_STEP_DEFINITION, SEC_TEST_DEFINITION } from "./sectionNames";
import { COMPONENT_TAG_PATTERN, EnumDef, FieldDef, XmlIndex } from "./xmlIndex";

/**
 * Inlay hints for field assignments inside a component block — pure, no
 * vscode dependency (providers/inlayHints.ts is the wiring).
 *
 * Everything shown is read straight from the active profile's XML configs;
 * nothing here says how TestPit treats the value:
 *   enumName — a NUMERIC literal assigned to a field that has an enum table:
 *              the name(s) the table gives that number
 *   unit     — a numeric literal assigned to a non-enum field that declares a
 *              `Unit` in the XML
 *   range    — the field's MinValue..MaxValue (off by default — it is noisy)
 *
 * Deliberately silent for: a value holding a %macro%, a CSV cell reference,
 * anything that is not one bare decimal literal, parameter keys
 * (PARAMETER_FIELDS), fields the message does not have, fields the XML marks
 * unused (reserved / spare), and every line of a [TEST DEFINITION] /
 * [STEP DEFINITION] block.
 */

export type EsiInlayHintKind = "enumName" | "unit" | "range";

export interface EsiInlayHint {
  /** 0-based line. */
  line: number;
  /** 0-based column just past the literal the hint annotates. */
  character: number;
  label: string;
  kind: EsiInlayHintKind;
  /** Plain-text explanation of where the hint comes from. */
  tooltip: string;
}

export interface InlayHintOptions {
  enumNames: boolean;
  units: boolean;
  ranges: boolean;
}

export const DEFAULT_INLAY_HINT_OPTIONS: InlayHintOptions = {
  enumNames: true,
  units: true,
  ranges: false,
};

/** Inclusive 0-based line span; hints outside it are not produced. */
export interface HintLineRange {
  startLine: number;
  endLine: number;
}

const INT_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/;
const COMMENT_CHARACTER = "#";

interface StackEntry {
  name: string;
  isComponent: boolean;
}

export function computeInlayHints(
  documentText: string,
  index: XmlIndex | undefined,
  range?: HintLineRange,
  options: InlayHintOptions = DEFAULT_INLAY_HINT_OPTIONS
): EsiInlayHint[] {
  const hints: EsiInlayHint[] = [];
  if (!index || !(options.enumNames || options.units || options.ranges)) {
    return hints;
  }
  const lines = documentText.split(/\r?\n/);
  const first = Math.max(0, range?.startLine ?? 0);
  const last = Math.min(lines.length - 1, range?.endLine ?? lines.length - 1);
  // The enclosing block depends on every line above, so the walk always
  // starts at the top; it stops at the end of the requested span.
  const stack: StackEntry[] = [];

  for (let lineNum = 0; lineNum <= last; lineNum++) {
    const raw = lines[lineNum];
    const tag = parseSectionTagLine(raw);
    if (tag) {
      if (tag.invalid || tag.kind === "oneLiner") {
        // A one-liner opens and closes on its own line: never on the stack.
        continue;
      }
      if (tag.kind === "close") {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === tag.name) {
            stack.splice(i, stack.length - i);
            break;
          }
        }
        continue;
      }
      stack.push({
        name: tag.name,
        isComponent: COMPONENT_TAG_PATTERN.test(tag.name),
      });
      continue;
    }
    if (lineNum < first) {
      continue;
    }
    const enclosing = enclosingComponent(stack);
    if (!enclosing) {
      continue;
    }
    const assign = ASSIGNMENT_RE.exec(raw);
    if (!assign) {
      continue;
    }
    const fieldName = assign[2];
    if (PARAMETER_FIELDS.has(fieldName)) {
      continue;
    }
    const value = assign[3].split(COMMENT_CHARACTER)[0].trim();
    // One bare decimal literal only. This is what rules out %macros%, CSV
    // cell references, enum names, hex, ranges and multi-token values.
    if (!NUMBER_RE.test(value)) {
      continue;
    }
    const field = index
      .resolveConnectionMessage(enclosing)
      ?.fields.find((f) => f.name === fieldName);
    if (!field || field.used === false) {
      continue;
    }
    const eq = raw.indexOf("=", assign[1].length + fieldName.length);
    const character = raw.indexOf(value, eq + 1) + value.length;
    const push = (kind: EsiInlayHintKind, label: string, tooltip: string): void => {
      hints.push({ line: lineNum, character, label, kind, tooltip });
    };

    // "Has an enum table" is the signal, not DataType (Enum / Enum8 / …).
    if (field.enums && field.enums.length > 0) {
      if (options.enumNames) {
        const names = enumNamesFor(field.enums, value);
        if (names.length > 0) {
          push(
            "enumName",
            names.join(" | "),
            `Enum name for ${value} in field '${fieldName}' (from the active profile's XML config).`
          );
        }
      }
      continue;
    }
    if (options.units) {
      const unit = declaredUnit(field);
      if (unit) {
        push(
          "unit",
          unit,
          `Unit declared for field '${fieldName}' in the active profile's XML config.`
        );
      }
    }
    if (options.ranges) {
      const bounds = declaredRange(field);
      if (bounds) {
        push(
          "range",
          `[${bounds.min}..${bounds.max}]`,
          `MinValue..MaxValue declared for field '${fieldName}' in the active profile's XML config.`
        );
      }
    }
  }
  return hints;
}

function enclosingComponent(stack: StackEntry[]): string | undefined {
  // Anything under a definition block is prose, however it is bracketed.
  if (stack.some((s) => s.name === SEC_TEST_DEFINITION || s.name === SEC_STEP_DEFINITION)) {
    return undefined;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].isComponent) {
      return stack[i].name;
    }
  }
  return undefined;
}

/** Names the enum table gives an integer literal (integer-to-integer only). */
function enumNamesFor(enums: EnumDef[], literal: string): string[] {
  if (!INT_RE.test(literal)) {
    return [];
  }
  const n = parseInt(literal, 10);
  const names: string[] = [];
  for (const e of enums) {
    const ev = (e.value ?? "").trim();
    if (INT_RE.test(ev) && parseInt(ev, 10) === n && !names.includes(e.name)) {
      names.push(e.name);
    }
  }
  return names;
}

/** The XML `Unit`, minus the placeholders configs use for "none" (`-`, `N/A`). */
function declaredUnit(field: FieldDef): string | undefined {
  const unit = (field.unit ?? "").trim();
  if (unit === "" || /^(-+|n\/?a|none)$/i.test(unit)) {
    return undefined;
  }
  return unit;
}

/** Same trust rule as the validator's range check: a finite range with min < max. */
function declaredRange(field: FieldDef): { min: number; max: number } | undefined {
  if (field.minValue === undefined || field.maxValue === undefined) {
    return undefined;
  }
  const min = Number(field.minValue);
  const max = Number(field.maxValue);
  if (!isFinite(min) || !isFinite(max) || !(max > min)) {
    return undefined;
  }
  return { min, max };
}
