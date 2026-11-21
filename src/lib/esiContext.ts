import { parseSectionTagLine } from "./parseSectionTag";
import { COMPONENT_TAG_PATTERN } from "./xmlIndex";

export type EsiContext =
  | { kind: "tagName"; partial: string }
  | { kind: "closeTagName"; partial: string }
  | { kind: "fieldName"; messageName: string }
  | { kind: "fieldValue"; messageName: string; fieldName: string }
  | { kind: "variableRef"; partial: string }
  | { kind: "other" };

/**
 * Determine the lexical context the cursor is in for completion / hover /
 * semantic-token decisions.
 *
 * The function is pure (no vscode dependency) so it's unit-testable.
 *
 * @param documentText  full document text
 * @param lineIndex     0-indexed line number of the cursor
 * @param character     0-indexed character index within that line
 */
export function resolveContext(
  documentText: string,
  lineIndex: number,
  character: number
): EsiContext {
  const lines = documentText.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { kind: "other" };
  }
  const line = lines[lineIndex];
  const before = line.slice(0, character);

  // 1. Inside [ ... ] — tag name completion
  const lastOpenBracket = before.lastIndexOf("[");
  const lastCloseBracket = before.lastIndexOf("]");
  if (lastOpenBracket > lastCloseBracket) {
    // Cursor is between [ and an unclosed ]
    const partial = before.slice(lastOpenBracket + 1);
    // `[/…` is a closing tag: its own context, so it is offered the open
    // sections rather than new tag names.
    if (partial.startsWith("/")) {
      return { kind: "closeTagName", partial: partial.slice(1) };
    }
    return { kind: "tagName", partial };
  }

  // 2. After a `%` — variable reference
  const lastPercent = before.lastIndexOf("%");
  if (lastPercent !== -1) {
    const tail = before.slice(lastPercent + 1);
    if (/^\w*$/.test(tail)) {
      return { kind: "variableRef", partial: tail };
    }
  }

  // 3. Inside an open block (between [NAME] and [/NAME]) and the line
  //    looks like a field assignment.
  const enclosingMessage = findEnclosingMessage(lines, lineIndex);
  if (enclosingMessage) {
    const eqIndex = before.indexOf("=");
    if (eqIndex !== -1 && character > eqIndex) {
      // Cursor is on the RHS of `=`. Field name may include dots
      // (e.g. 1553's `Mode.SelectedCourse = …`).
      const fieldName = before.slice(0, eqIndex).trim();
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(fieldName)) {
        return {
          kind: "fieldValue",
          messageName: enclosingMessage,
          fieldName,
        };
      }
    } else {
      // Cursor is on the LHS — likely typing a field name (possibly dotted).
      const trimmedBefore = before.trimStart();
      if (/^[A-Za-z_]?[A-Za-z0-9_.]*$/.test(trimmedBefore)) {
        return { kind: "fieldName", messageName: enclosingMessage };
      }
    }
  }

  return { kind: "other" };
}

/** The component block a line sits in: its tag name and opening line. */
export interface EnclosingBlock {
  name: string;
  /** 0-indexed line of the opening tag. */
  line: number;
}

/**
 * Walk backwards from `lineIndex` (that line included) to the nearest
 * COMPONENT opening tag not yet closed between it and the cursor. Tag lines
 * are classified by parseSectionTag.ts: a one-liner `[NAME/]` opens and
 * closes on its own line, so it never encloses anything, and a name TestPit
 * would reject is skipped.
 *
 * Structural containers (STEP, STEP INPUTS, VARIABLES, …) are walked past:
 * only a bus-prefixed tag (429_*, 1553_*, DIS_*, Mem_*, …) holds field
 * assignments.
 */
export function findEnclosingBlock(
  lines: readonly string[],
  lineIndex: number
): EnclosingBlock | undefined {
  // Closing tags met on the way up, by name: each one pairs with the next
  // opener of that name above it.
  const pendingCloses = new Map<string, number>();
  for (let i = Math.min(lineIndex, lines.length - 1); i >= 0; i--) {
    const tag = parseSectionTagLine(lines[i]);
    if (!tag || tag.invalid || tag.kind === "oneLiner") {
      continue;
    }
    const pending = pendingCloses.get(tag.name) ?? 0;
    if (tag.kind === "close") {
      pendingCloses.set(tag.name, pending + 1);
      continue;
    }
    if (pending > 0) {
      pendingCloses.set(tag.name, pending - 1);
      continue;
    }
    if (COMPONENT_TAG_PATTERN.test(tag.name)) {
      return { name: tag.name, line: i };
    }
  }
  return undefined;
}

function findEnclosingMessage(
  lines: readonly string[],
  lineIndex: number
): string | undefined {
  return findEnclosingBlock(lines, lineIndex)?.name;
}
