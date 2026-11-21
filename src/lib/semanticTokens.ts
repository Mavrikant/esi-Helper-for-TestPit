import { PARAMETER_FIELDS } from "./componentValidator";
import { parseCsvCellRef } from "./fileRefs";
import { parseSectionTagLine } from "./parseSectionTag";
import { COMPONENT_TAG_PATTERN, XmlIndex, isKnownComponent } from "./xmlIndex";

/**
 * Index-aware semantic tokens for a `.esi` document — the pure half of
 * providers/semanticTokens.ts. vscode-free so it can be unit-tested directly.
 *
 * Token types (layered over the TextMate grammar, syntaxes/esi.json):
 *   class      — component connection names ([429_…], [ED_…], …)
 *   property   — message field names (SDI, Course, flight_id, …)
 *   enumMember — enum literal values on the RHS of `=`
 *   keyword    — built-in parameter keys (time/interval/…)
 * Macros (%VAR%) are intentionally NOT emitted here — the grammar colours them
 * so they stay consistent and never leak into comments.
 *
 * Modifiers:
 *   defaultLibrary — "nothing says this name is wrong": the XML index knows it,
 *                    or there is nothing to check it against (no index loaded,
 *                    or the enclosing connection's message cannot be resolved).
 *                    A token WITHOUT it is one the index positively does not
 *                    know; package.json renders those in italics.
 *   deprecated     — a field the config marks as not used (`used === false`:
 *                    reserved / spare / padding). Rendered struck through.
 */
export const SEMANTIC_TOKEN_TYPES = [
  "class",
  "property",
  "enumMember",
  "keyword",
] as const;
export const SEMANTIC_TOKEN_MODIFIERS = ["defaultLibrary", "deprecated"] as const;

export type EsiSemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];
export type EsiSemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number];

export interface EsiSemanticToken {
  line: number;
  start: number;
  length: number;
  type: EsiSemanticTokenType;
  modifiers: EsiSemanticTokenModifier[];
}

// Field name may include dots (1553 `Mode.SelectedCourse`).
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;
const FIRST_IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/;
const COMMENT_CHARACTER = "#";

const KNOWN: EsiSemanticTokenModifier = "defaultLibrary";
const RESERVED: EsiSemanticTokenModifier = "deprecated";

/** Drop the `# comment` tail so no token is emitted inside a comment. */
function stripComment(line: string): string {
  const hash = line.indexOf(COMMENT_CHARACTER);
  return hash === -1 ? line : line.slice(0, hash);
}

function isComponentTag(name: string): boolean {
  return COMPONENT_TAG_PATTERN.test(name);
}

function topComponent(stack: string[]): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (isComponentTag(stack[i])) {
      return stack[i];
    }
  }
  return undefined;
}

/** Index of a token type in the legend. */
export function semanticTokenTypeIndex(type: EsiSemanticTokenType): number {
  return SEMANTIC_TOKEN_TYPES.indexOf(type);
}

/** Bit set of modifiers, in legend order — what SemanticTokensBuilder takes. */
export function encodeSemanticTokenModifiers(
  modifiers: readonly EsiSemanticTokenModifier[]
): number {
  let bits = 0;
  for (const modifier of modifiers) {
    bits |= 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier);
  }
  return bits;
}

/**
 * Walk the document and return its semantic tokens in document order.
 * `index` is the active project's XML index, or undefined when none is loaded
 * — then nothing can be called unknown, so nothing is marked as such.
 */
export function computeSemanticTokens(
  documentText: string,
  index: XmlIndex | undefined
): EsiSemanticToken[] {
  const tokens: EsiSemanticToken[] = [];
  const lines = documentText.split(/\r?\n/);
  // Open sections, innermost last — tracks the enclosing component message.
  const stack: string[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum];

    // Section tags drive the stack and colour component connections. The
    // grammar of a tag line lives in parseSectionTag.ts and nowhere else.
    const tag = parseSectionTagLine(raw);
    if (tag) {
      if (tag.invalid) {
        continue;
      }
      if (isComponentTag(tag.name)) {
        const start = raw.indexOf(tag.name, tag.startCol);
        if (start !== -1 && start < tag.endCol) {
          const known = index ? isKnownComponent(index, tag.name) : true;
          tokens.push({
            line: lineNum,
            start,
            length: tag.name.length,
            type: "class",
            modifiers: known ? [KNOWN] : [],
          });
        }
      }
      if (tag.kind === "open") {
        stack.push(tag.name);
      } else if (tag.kind === "close") {
        // Close the nearest matching opener; a stray close changes nothing.
        const at = stack.lastIndexOf(tag.name);
        if (at !== -1) {
          stack.length = at;
        }
      }
      // A one-liner `[NAME/]` opens AND closes: it never goes on the stack.
      continue;
    }

    // Field assignment inside an open component block. Comment-stripped view:
    // tokens are never emitted inside `# …`.
    const enclosing = topComponent(stack);
    if (!enclosing) {
      continue;
    }
    const line = stripComment(raw);
    const assignMatch = ASSIGNMENT_RE.exec(line);
    if (!assignMatch) {
      continue;
    }
    const fieldName = assignMatch[2];
    const fieldStart = assignMatch[1].length;

    if (PARAMETER_FIELDS.has(fieldName)) {
      // Built-in parameter key → keyword (always known).
      tokens.push({
        line: lineNum,
        start: fieldStart,
        length: fieldName.length,
        type: "keyword",
        modifiers: [KNOWN],
      });
      continue;
    }

    const message = index?.resolveConnectionMessage(enclosing);
    const field = message?.fields.find((f) => f.name === fieldName);
    // Unknown only when there IS a message to look the field up in.
    const modifiers: EsiSemanticTokenModifier[] = field || !message ? [KNOWN] : [];
    if (field?.used === false) {
      modifiers.push(RESERVED);
    }
    tokens.push({
      line: lineNum,
      start: fieldStart,
      length: fieldName.length,
      type: "property",
      modifiers,
    });

    // RHS enum literal — only for fields with an enum table, and never for CSV
    // references or macros (the grammar colours those).
    if (!field?.enums || field.enums.length === 0) {
      continue;
    }
    const eqIndex = line.indexOf("=", fieldStart + fieldName.length);
    const rhs = line.slice(eqIndex + 1);
    const rhsTrimmed = rhs.trimStart();
    if (rhsTrimmed.startsWith("%") || parseCsvCellRef(rhsTrimmed) !== undefined) {
      continue;
    }
    const valueMatch = FIRST_IDENT_RE.exec(rhs);
    if (!valueMatch) {
      continue;
    }
    const known = field.enums.some((e) => e.name === valueMatch[0]);
    tokens.push({
      line: lineNum,
      start: eqIndex + 1 + valueMatch.index,
      length: valueMatch[0].length,
      type: "enumMember",
      modifiers: known ? [KNOWN] : [],
    });
  }
  return tokens;
}
