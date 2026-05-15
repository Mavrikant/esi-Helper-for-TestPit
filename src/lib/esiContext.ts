import { COMPONENT_TAG_PATTERN } from "./xmlIndex";

export type EsiContext =
  | { kind: "tagName"; partial: string }
  | { kind: "fieldName"; messageName: string }
  | { kind: "fieldValue"; messageName: string; fieldName: string }
  | { kind: "variableRef"; partial: string }
  | { kind: "other" };

const TAG_OPEN_RE = /\[([A-Za-z0-9_]+)\]/g;
const TAG_CLOSE_RE = /\[\/([A-Za-z0-9_]+)\]/g;

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
  const lines = documentText.split("\n");
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
    // Skip closing tags ([/...) — these aren't completion targets
    if (!partial.startsWith("/")) {
      return { kind: "tagName", partial };
    }
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
      // Cursor is on the RHS of `=`
      const fieldName = before.slice(0, eqIndex).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName)) {
        return {
          kind: "fieldValue",
          messageName: enclosingMessage,
          fieldName,
        };
      }
    } else {
      // Cursor is on the LHS — likely typing a field name
      const trimmedBefore = before.trimStart();
      if (/^[A-Za-z_]?[A-Za-z0-9_]*$/.test(trimmedBefore)) {
        return { kind: "fieldName", messageName: enclosingMessage };
      }
    }
  }

  return { kind: "other" };
}

/**
 * Walk backwards from `lineIndex` to find the nearest `[NAME]` opening tag
 * that hasn't been closed yet by a `[/NAME]` between it and the cursor.
 * Returns the bare NAME, or undefined if not inside any open block.
 */
function findEnclosingMessage(lines: string[], lineIndex: number): string | undefined {
  const closedSinceCursor = new Set<string>();
  for (let i = lineIndex; i >= 0; i--) {
    const line = lines[i];
    // Walk closing tags first (they "consume" later openers we'd see going up).
    TAG_CLOSE_RE.lastIndex = 0;
    let closeMatch: RegExpExecArray | null;
    while ((closeMatch = TAG_CLOSE_RE.exec(line)) !== null) {
      // Only count closers BEFORE the cursor on the cursor line.
      if (i === lineIndex) {
        // For the cursor line, we already returned earlier if cursor was
        // inside an open tag — here we just consider the line as content.
      }
      closedSinceCursor.add(closeMatch[1]);
    }
    TAG_OPEN_RE.lastIndex = 0;
    let openMatch: RegExpExecArray | null;
    let lastOpenOnLine: string | undefined;
    while ((openMatch = TAG_OPEN_RE.exec(line)) !== null) {
      lastOpenOnLine = openMatch[1];
    }
    if (lastOpenOnLine && !closedSinceCursor.has(lastOpenOnLine)) {
      // Skip standalone container tags like STEP, STEP DEFINITION,
      // STEP INPUTS, STEP OUTPUTS, VARIABLES — these don't have field
      // assignments of bus components inside them; we want bus-prefixed
      // tags (429_*, 1553_*, DIS_*, Mem_*).
      if (isComponentTag(lastOpenOnLine)) {
        return lastOpenOnLine;
      }
    }
    if (lastOpenOnLine) {
      // Mark it consumed so a higher-level open with the same name doesn't
      // also match.
      closedSinceCursor.add(lastOpenOnLine);
    }
  }
  return undefined;
}

function isComponentTag(name: string): boolean {
  return COMPONENT_TAG_PATTERN.test(name);
}
