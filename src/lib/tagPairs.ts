/**
 * Opening/closing section-tag pairing for `.esi`.
 *
 * Tag lines are classified ONLY by parseSectionTag.ts (the port of TestPit's
 * reader), and pairs are formed exactly the way the structural validator in
 * componentValidator.ts walks its tag stack, so what the editor highlights as
 * "a pair" is what the validator treats as one:
 *   - a `#` line (or a tag after a `#`) is not a tag;
 *   - a name TestPit would reject outright (`invalid`) is skipped;
 *   - a one-liner `[NAME/]` opens and closes on its own line: it never goes on
 *     the stack and has no pair;
 *   - a closer pairs with the NEAREST still-open tag of the same name
 *     (case-sensitive); tags opened after that one were never closed and get
 *     no pair;
 *   - a closer with no open tag of its name (stray / mismatched) pairs with
 *     nothing and leaves the stack alone.
 *
 * Every entry point is total: any text (unclosed tags, CRLF, empty input,
 * out-of-range positions) yields a result or `undefined`, never a throw.
 *
 * Kept vscode-free so it can be unit-tested directly.
 */
import { parseSectionTagLine, SectionTag } from "./parseSectionTag";

/** Where one tag of a pair sits. All columns are 0-based, ends exclusive. */
export interface TagNameRange {
  line: number;
  /** Columns of the NAME alone (no brackets, slashes or padding). */
  startCol: number;
  endCol: number;
  /** Columns of the whole tag: its `[` … just past its `]`. */
  tagStartCol: number;
  tagEndCol: number;
}

export interface TagPair {
  /** Tag name as TestPit reads it (normalized, trimmed, never empty). */
  name: string;
  open: TagNameRange;
  close: TagNameRange;
}

export interface TagPairAtCursor extends TagPair {
  /** Which of the two tags the cursor is on. */
  cursorOn: "open" | "close";
  /** True when the cursor is inside (or touching either end of) the name. */
  inName: boolean;
}

/**
 * What a tag name may consist of while it is being edited: anything except
 * the characters that end or restructure a tag (`[`, `]`, `/`), the comment
 * character and line breaks. Spaces, digits, underscores, dots and `%` are
 * all allowed — `STEP 12`, `429_SOME_LABEL`, `PART_p_q`.
 *
 * Not global/sticky, so it is safe to hand to VS Code as the linked-editing
 * word pattern (it must match the WHOLE edited name for the link to hold).
 */
export const TAG_NAME_WORD_PATTERN = /[^[\]/#\r\n]+/;

/**
 * Columns of the normalized name inside a parsed tag line.
 *
 * A valid tag is `[` + repeated `[`/`/` + padding + NAME + …, and the name
 * holds none of `[`, `]`, `/` — so skipping those and the padding lands on
 * the name's first character. Verified against the parser's own name; a
 * mismatch (should not happen) yields `undefined` rather than a wrong range.
 */
function locateName(
  raw: string,
  tag: SectionTag
): { startCol: number; endCol: number } | undefined {
  // Same length-preserving transform the parser applies before it measures.
  const text = raw.replace(/\t/g, " ");
  let col = tag.startCol;
  while (col < tag.endCol && (text[col] === "[" || text[col] === "/")) {
    col++;
  }
  while (col < tag.endCol && text[col] === " ") {
    col++;
  }
  const endCol = col + tag.name.length;
  if (tag.name === "" || text.slice(col, endCol) !== tag.name) {
    return undefined;
  }
  return { startCol: col, endCol };
}

/** Every matched opening/closing pair in the text, ordered by closing line. */
export function buildTagPairs(text: string): TagPair[] {
  const lines = text.split(/\r?\n/);
  const pairs: TagPair[] = [];
  const stack: { name: string; range: TagNameRange | undefined }[] = [];

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    const tag = parseSectionTagLine(raw);
    if (!tag || tag.invalid || tag.kind === "oneLiner") {
      continue;
    }
    const located = locateName(raw, tag);
    const range: TagNameRange | undefined = located && {
      line,
      startCol: located.startCol,
      endCol: located.endCol,
      tagStartCol: tag.startCol,
      tagEndCol: tag.endCol,
    };

    if (tag.kind === "open") {
      stack.push({ name: tag.name, range });
      continue;
    }

    let matchIdx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === tag.name) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx === -1) {
      continue; // stray / mismatched closer: no pair, stack untouched
    }
    const opener = stack[matchIdx];
    stack.length = matchIdx; // anything opened after it was never closed
    if (opener.range && range) {
      pairs.push({ name: tag.name, open: opener.range, close: range });
    }
  }
  return pairs;
}

function onTag(range: TagNameRange, line: number, character: number): boolean {
  return (
    range.line === line &&
    character >= range.tagStartCol &&
    character <= range.tagEndCol
  );
}

/**
 * The pair whose opening or closing tag the cursor is on, or `undefined`.
 *
 * "On" means anywhere from the tag's `[` to just past its `]` (both ends
 * inclusive, so a cursor resting right after the tag still counts). A tag
 * holds one section name per line, so at most one pair can match.
 */
export function findTagPair(
  text: string,
  line: number,
  character: number
): TagPairAtCursor | undefined {
  for (const pair of buildTagPairs(text)) {
    const cursorOn = onTag(pair.open, line, character)
      ? "open"
      : onTag(pair.close, line, character)
        ? "close"
        : undefined;
    if (cursorOn) {
      const own = pair[cursorOn];
      return {
        ...pair,
        cursorOn,
        inName: character >= own.startCol && character <= own.endCol,
      };
    }
  }
  return undefined;
}

/** Where "Go to Matching Tag" should put the cursor. */
export interface MatchingTagTarget {
  line: number;
  /** Start column of the target tag's name. */
  character: number;
  /** The tag being jumped to. */
  target: "open" | "close";
  name: string;
}

/**
 * The tag to jump to from `line` (the column does not matter):
 *   - on an opening tag  → its closing tag;
 *   - on a closing tag   → its opening tag;
 *   - anywhere else      → the opening tag of the innermost matched block
 *                          that encloses the line.
 * `undefined` when the line is an unmatched tag, a one-liner, or outside
 * every matched block.
 */
export function findMatchingTag(
  text: string,
  line: number
): MatchingTagTarget | undefined {
  const pairs = buildTagPairs(text);
  const to = (pair: TagPair, target: "open" | "close"): MatchingTagTarget => ({
    line: pair[target].line,
    character: pair[target].startCol,
    target,
    name: pair.name,
  });

  for (const pair of pairs) {
    if (pair.open.line === line) {
      return to(pair, "close");
    }
    if (pair.close.line === line) {
      return to(pair, "open");
    }
  }

  // A tag line that is not half of a pair (unclosed opener, stray closer,
  // one-liner, rejected name) has no match — don't guess at an enclosing one.
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length || parseSectionTagLine(lines[line])) {
    return undefined;
  }

  let innermost: TagPair | undefined;
  for (const pair of pairs) {
    if (pair.open.line < line && line < pair.close.line) {
      if (!innermost || pair.open.line > innermost.open.line) {
        innermost = pair;
      }
    }
  }
  return innermost && to(innermost, "open");
}

/** Line of the matching tag for `line`, or -1 — see {@link findMatchingTag}. */
export function findMatchingTagLine(text: string, line: number): number {
  return findMatchingTag(text, line)?.line ?? -1;
}
