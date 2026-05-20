import { refactorWhitespace } from "./refactorWhitespace";

const INDENT = "    ";

// Whole-line opening tag, e.g. "[STEP 10]" or "[STEP INPUTS]". A trailing
// "# comment" after the tag is allowed — e.g. "[429_FOO_input1]  # Scenario 1".
// Mid-line tags (e.g. `foo = [bar]`) are treated as content. Capture group
// extracts the tag name so it can be matched against its closer.
const OPENING_TAG_NAME = /^\[([^/\]][^\]]*)\]\s*(?:#.*)?$/;

// Whole-line closing tag. The name capture lets us match it against the
// open tag on the top of the stack — strict-name matching prevents an
// orphaned [/X] from silently popping an unrelated [Y].
const CLOSING_TAG_LINE = /^\[\/([^\]]+)\]\s*(?:#.*)?$/;

// `<pre>...</pre>` blocks participate in indentation tracking like [TAG]/[/TAG]:
//   - A line containing `<pre>` opens a block — even if `<pre>` is mid-line
//     followed by inline content (e.g. `xxx = <pre> Following stuff:`). The
//     only exception is when the same line also contains `</pre>` AFTER the
//     opener — that's a single-line block, depth-neutral.
//   - A line ending with `</pre>` closes the current block.
// The CLOSER is `$`-anchored so a stray `content </pre>` still terminates.
// `\b` on the opener prevents matching e.g. `<prefix>`.
const PRE_OPEN_TAG = /<pre\b[^>]*>/i;
const PRE_CLOSE_TAG = /<\/pre>/i;
const PRE_CLOSER_AT_END = /<\/pre>\s*(?:#.*)?$/i;

type Context =
  | { kind: "tag"; name: string }
  | { kind: "pre"; preCol: number; contentCol: number };

type TagPending = { idx: number; name: string };

// Classify a line's <pre>/</pre> role.
//   isOpener      — line contains `<pre>` with no `</pre>` after it.
//   isCloser      — line ends with `</pre>` and has no `<pre>` opener on it.
//   isSingleLine  — line contains `<pre>...</pre>` on the same line.
//   openMatch     — RegExp match for the opener position (when present).
function classifyPreLine(line: string): {
  isOpener: boolean;
  isCloser: boolean;
  isSingleLine: boolean;
  openMatch: RegExpExecArray | null;
} {
  const openMatch = PRE_OPEN_TAG.exec(line);
  const closerAtEnd = PRE_CLOSER_AT_END.test(line);
  let closeAfterOpen = false;
  if (openMatch) {
    const remaining = line.slice(openMatch.index + openMatch[0].length);
    closeAfterOpen = PRE_CLOSE_TAG.test(remaining);
  }
  return {
    isOpener: openMatch !== null && !closeAfterOpen,
    isCloser: closerAtEnd && !openMatch,
    isSingleLine: closeAfterOpen,
    openMatch,
  };
}

// Pre-scan to identify opens that will never get a matching close. These
// "orphan" opens are recorded by line index; the main pass renders them at
// the current depth but does NOT push them onto the stack, so a stray
// `[NeverClosed]` or unclosed `<pre>` early in a file does not cascade-shift
// every subsequent tag's indent.
//
// Two phases:
//   1. Match <pre>/</pre> pairs. Unmatched <pre> openers are orphans;
//      matched pairs produce an opener→closer index map.
//   2. Match [TAG]/[/TAG] by name, *skipping over matched pre regions*
//      entirely (their content is opaque for tag purposes). Mismatched
//      closes are left for the main pass to treat as content. Opens
//      bypassed by a deeper [/X] match (e.g. `[B]` inside `[A]...[/A]`
//      with no `[/B]`) are also orphans.
function findOrphanLineIndices(lines: string[]): Set<number> {
  const orphan = new Set<number>();

  // Phase 1: pre matching.
  const preOpenToClose = new Map<number, number>();
  const preStack: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s === "") continue;
    const { isOpener, isCloser, isSingleLine } = classifyPreLine(s);
    if (isSingleLine) continue;
    if (isOpener) {
      preStack.push(i);
      continue;
    }
    if (isCloser) {
      const openerIdx = preStack.pop();
      if (openerIdx !== undefined) {
        preOpenToClose.set(openerIdx, i);
      }
    }
  }
  for (const idx of preStack) {
    orphan.add(idx);
  }

  // Phase 2: tag matching, skipping matched pre regions.
  const pending: TagPending[] = [];
  let i = 0;
  while (i < lines.length) {
    const s = lines[i].trim();
    if (s === "") {
      i += 1;
      continue;
    }
    const preCloseAt = preOpenToClose.get(i);
    if (preCloseAt !== undefined) {
      i = preCloseAt + 1;
      continue;
    }
    if (orphan.has(i)) {
      // unmatched <pre> opener — treat as content for tag purposes
      i += 1;
      continue;
    }
    const closeMatch = s.match(CLOSING_TAG_LINE);
    if (closeMatch) {
      const name = closeMatch[1].trim();
      let foundAt = -1;
      for (let j = pending.length - 1; j >= 0; j--) {
        if (pending[j].name === name) {
          foundAt = j;
          break;
        }
      }
      if (foundAt !== -1) {
        for (let j = foundAt + 1; j < pending.length; j++) {
          orphan.add(pending[j].idx);
        }
        pending.length = foundAt;
      }
      i += 1;
      continue;
    }
    const openMatch = s.match(OPENING_TAG_NAME);
    if (openMatch) {
      pending.push({ idx: i, name: openMatch[1].trim() });
    }
    i += 1;
  }
  for (const p of pending) {
    orphan.add(p.idx);
  }
  return orphan;
}

export function formatEsi(text: string): string {
  const normalized = refactorWhitespace(text);
  const lines = normalized.split(/\r?\n/);
  const orphan = findOrphanLineIndices(lines);
  const out: string[] = [];
  const stack: Context[] = [];

  const inPre = (): boolean =>
    stack.length > 0 && stack[stack.length - 1].kind === "pre";

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    if (stripped === "") {
      out.push("");
      continue;
    }

    // Inside a <pre> block: content aligns to `contentCol` and `</pre>` to
    // `preCol`. `contentCol` is `preCol + INDENT` when the opener line ends
    // with `<pre>` (content "begins" on the next line, so it's indented one
    // step in), or `preCol` when the opener has inline trailing content (the
    // first content is already on the opener line, so subsequent lines stay
    // at the same column). Bracket-tag-looking content does NOT affect depth.
    if (inPre()) {
      const top = stack[stack.length - 1] as {
        kind: "pre";
        preCol: number;
        contentCol: number;
      };
      if (PRE_CLOSER_AT_END.test(stripped)) {
        stack.pop();
        out.push(" ".repeat(top.preCol) + stripped);
      } else {
        out.push(" ".repeat(top.contentCol) + stripped);
      }
      continue;
    }

    const { isOpener, isCloser, isSingleLine, openMatch } =
      classifyPreLine(stripped);

    if (isSingleLine) {
      // Single-line `<pre>...</pre>` — depth-neutral, just render at depth.
      out.push(INDENT.repeat(stack.length) + stripped);
      continue;
    }

    if (isCloser) {
      // Orphan </pre> with no open pre on the stack — treat as content.
      out.push(INDENT.repeat(stack.length) + stripped);
      continue;
    }

    if (isOpener) {
      const indentStr = INDENT.repeat(stack.length);
      const renderedLine = indentStr + stripped;
      out.push(renderedLine);
      if (!orphan.has(i) && openMatch) {
        // openMatch was on the trimmed line; translate to the rendered line.
        const preCol = indentStr.length + openMatch.index;
        const preEndCol = preCol + openMatch[0].length;
        // Look at the slice after `<pre ...>`. If anything other than
        // whitespace + optional `# comment` remains, the opener has inline
        // trailing content, so subsequent lines anchor to col(<pre>).
        const trailingPart = renderedLine
          .slice(preEndCol)
          .replace(/\s*(?:#.*)?$/, "");
        const hasTrailingContent = trailingPart.length > 0;
        const contentCol = hasTrailingContent
          ? preCol
          : preCol + INDENT.length;
        stack.push({ kind: "pre", preCol, contentCol });
      }
      continue;
    }

    const closeMatch = stripped.match(CLOSING_TAG_LINE);
    if (closeMatch) {
      const name = closeMatch[1].trim();
      const top = stack[stack.length - 1];
      if (top && top.kind === "tag" && top.name === name) {
        stack.pop();
        out.push(INDENT.repeat(stack.length) + stripped);
      } else {
        // Mismatched or orphan close — render at current depth, no pop.
        out.push(INDENT.repeat(stack.length) + stripped);
      }
      continue;
    }

    const tagOpenMatch = stripped.match(OPENING_TAG_NAME);
    if (tagOpenMatch) {
      out.push(INDENT.repeat(stack.length) + stripped);
      if (!orphan.has(i)) {
        stack.push({ kind: "tag", name: tagOpenMatch[1].trim() });
      }
      continue;
    }

    out.push(INDENT.repeat(stack.length) + stripped);
  }

  return out.join("\n");
}
