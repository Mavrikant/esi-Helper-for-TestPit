/**
 * Section-tag grammar, ported from TestPit's own reader.
 *
 * A `.esi` section tag occupies its own line. TestPit's `ScriptParser.cpp`
 * (`readSection` + `checkTagName`) is deliberately forgiving about the SHAPE
 * of that line whenever the intent is not in doubt, and repairs it with a
 * WARNING instead of an error. The forms it accepts are pinned by the
 * regression case `TRT/Scripts/Validation/val_test_tag_recovery_pass.esi`:
 *
 *   [NAME]        opening tag                                  depth + 1
 *   [/NAME]       closing tag                                  depth - 1
 *   [NAME/]       ONE-LINER: opens and closes on one line      depth unchanged
 *   [[NAME]]      repeated braces        -> NAME    (warning)
 *   [//NAME]      repeated slashes       -> /NAME   (warning)
 *   [NAME] junk   text after the tag end -> truncated at the last ']'
 *   [NAME        closing brace missing   -> one is appended
 *
 * The one-liner `/]` is the important one: it is the ONLY reason a section
 * name may legitimately appear without a matching closing tag. Parsing it as
 * a plain opener (which a naive `\[(\/?)([^\]]+)\]` regex does — the `/`
 * lands inside the captured name) leaves it forever open on the tag stack and
 * produces a bogus "never closed" error, and every later close in the file
 * cascades into "no matching opening tag".
 *
 * Kept vscode-free so it can be unit-tested directly.
 */

/** What the line does to the section stack. */
export type SectionTagKind = "open" | "close" | "oneLiner";

export interface SectionTag {
  kind: SectionTagKind;
  /** Tag name after brace/slash normalization, trimmed. */
  name: string;
  /** Column of the `[` that opens the tag, in the original line. */
  startCol: number;
  /** Column just past the tag's `]`, in the original line. */
  endCol: number;
  /**
   * True when TestPit's `checkTagName` would reject the name outright — it is
   * empty, or still contains `[`, `]` or `/` after normalization (e.g.
   * `[ NAME / ]`, where the space before `]` means the line does NOT end in
   * `/]` so it is not a one-liner). Callers should ignore such a line for
   * stack purposes rather than guess at what it meant; TestPit's own validity
   * check reports it.
   */
  invalid: boolean;
  /**
   * True when TestPit repaired the line (missing brace / trailing junk /
   * repeated braces or slashes) and logged a warning. The tag is still real.
   */
  repaired: boolean;
}

const COMMENT_CHARACTER = "#";
const OPENING_TAG = "[";
const CLOSING_TAG = "[/";
const TAG_END = "]";
const ONE_LINER_TAG = "/]";

/**
 * Mirror of `checkTagName`: strip repeated leading `[`/`/` and trailing
 * `]`/`/`, then reject what is left if it is empty or still holds a brace or
 * slash.
 */
function normalizeTagName(inner: string): {
  name: string;
  invalid: boolean;
  stripped: boolean;
} {
  let tag = inner;
  let stripped = false;

  while (tag.startsWith(OPENING_TAG) || tag.startsWith("/")) {
    tag = tag.slice(1);
    stripped = true;
  }
  while (tag.endsWith(TAG_END) || tag.endsWith("/")) {
    tag = tag.slice(0, -1);
    stripped = true;
  }

  const invalid =
    tag.trim() === "" ||
    tag.includes(OPENING_TAG) ||
    tag.includes(TAG_END) ||
    tag.includes("/");

  return { name: tag.trim(), invalid, stripped };
}

/**
 * Parse one line as a section tag, the way TestPit's reader does.
 *
 * Returns `undefined` when the line is not a tag line at all (blank, a
 * comment, or anything that does not start with `[` once comments and
 * surrounding whitespace are gone) — those are content, and the caller
 * handles them as `key = value` lines or prose.
 */
export function parseSectionTagLine(raw: string): SectionTag | undefined {
  // TestPit: strip the comment, tabs become spaces, then trim.
  // Both transforms are length-preserving on the retained prefix, so
  // indices into `codeOnly` are still valid columns in `raw`.
  const codeOnly = raw.split(COMMENT_CHARACTER)[0].replace(/\t/g, " ");
  const trimmed = codeOnly.trim();

  if (trimmed === "" || !trimmed.startsWith(OPENING_TAG)) {
    return undefined;
  }

  const startCol = codeOnly.indexOf(OPENING_TAG);
  const lastBracket = codeOnly.lastIndexOf(TAG_END);
  const endCol =
    lastBracket > startCol ? lastBracket + 1 : startCol + trimmed.length;

  // "try to fix invalid tag close": truncate after the last ']', or append
  // one when the line has none at all.
  let line = trimmed;
  let repaired = false;
  if (!line.endsWith(TAG_END)) {
    const last = line.lastIndexOf(TAG_END);
    line = last > -1 ? line.slice(0, last + 1) : line + TAG_END;
    repaired = true;
  }

  // Order matters and follows the reader: a closing tag is recognised first,
  // so `[/NAME/]` is a close (not a one-liner); only then `/]`.
  let kind: SectionTagKind;
  let inner: string;
  if (line.startsWith(CLOSING_TAG)) {
    kind = "close";
    inner = line.slice(CLOSING_TAG.length, -1);
  } else if (line.endsWith(ONE_LINER_TAG)) {
    kind = "oneLiner";
    inner = line.slice(1, -ONE_LINER_TAG.length);
  } else {
    kind = "open";
    inner = line.slice(1, -1);
  }

  const { name, invalid, stripped } = normalizeTagName(inner);

  return {
    kind,
    name,
    startCol,
    endCol,
    invalid,
    repaired: repaired || stripped,
  };
}
