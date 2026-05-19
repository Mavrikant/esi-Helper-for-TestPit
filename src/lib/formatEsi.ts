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

// `<pre>...</pre>` blocks participate in depth tracking like [TAG]/[/TAG]:
//   - A line ending with `<pre>` opens a block (with optional `# comment`).
//   - A line ending with `</pre>` closes it (also optional `# comment`).
// The CLOSER is intentionally `$`-anchored only (not `^`-anchored) so a
// stray `content </pre>` on one line still terminates the block.
// `\b` on the opener prevents matching e.g. `<prefix>`.
const PRE_OPENER_AT_END = /<pre\b[^>]*>\s*(?:#.*)?$/i;
const PRE_CLOSER_AT_END = /<\/pre>\s*(?:#.*)?$/i;

type Context =
  | { kind: "tag"; name: string }
  | { kind: "pre" };

type TagPending = { idx: number; name: string };

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
    const isOpener = PRE_OPENER_AT_END.test(s);
    const isCloser = PRE_CLOSER_AT_END.test(s);
    if (isOpener && isCloser) continue;
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

    // Inside a <pre> block, every line is raw content. Only </pre> exits
    // the block — bracket-tag-looking content (`[STEP X]`, `[/Y]`, etc.)
    // does NOT affect depth here.
    if (inPre()) {
      if (PRE_CLOSER_AT_END.test(stripped)) {
        stack.pop();
        out.push(INDENT.repeat(stack.length) + stripped);
      } else {
        out.push(INDENT.repeat(stack.length) + stripped);
      }
      continue;
    }

    const isPreOpener = PRE_OPENER_AT_END.test(stripped);
    const isPreCloser = PRE_CLOSER_AT_END.test(stripped);

    if (isPreOpener && isPreCloser) {
      out.push(INDENT.repeat(stack.length) + stripped);
      continue;
    }

    if (isPreCloser) {
      // Orphan </pre> with no open pre on the stack — treat as content.
      out.push(INDENT.repeat(stack.length) + stripped);
      continue;
    }

    if (isPreOpener) {
      out.push(INDENT.repeat(stack.length) + stripped);
      if (!orphan.has(i)) {
        stack.push({ kind: "pre" });
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

    const openMatch = stripped.match(OPENING_TAG_NAME);
    if (openMatch) {
      out.push(INDENT.repeat(stack.length) + stripped);
      if (!orphan.has(i)) {
        stack.push({ kind: "tag", name: openMatch[1].trim() });
      }
      continue;
    }

    out.push(INDENT.repeat(stack.length) + stripped);
  }

  return out.join("\n");
}
