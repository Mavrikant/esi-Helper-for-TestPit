import { refactorWhitespace } from "./refactorWhitespace";

const INDENT = "    ";

// Lines that ARE just an opening tag, e.g. "[STEP 10]" or "[STEP INPUTS]".
// Mid-line tags (e.g. `Step Conditions = <pre>` or `foo [BAR]`) are treated
// as regular content so their depth isn't disturbed. A trailing "# comment"
// after the tag (with any amount of whitespace before the #) is allowed —
// e.g. `[429_FOO_input1]          # Scenario 1`.
const OPENING_TAG_LINE = /^\[[^/\]][^\]]*\]\s*(?:#.*)?$/;
const CLOSING_TAG_LINE = /^\[\/[^\]]+\]\s*(?:#.*)?$/;

// `<pre>...</pre>` blocks (used by Step Conditions / Step Expected Results)
// participate in depth tracking just like [TAG]/[/TAG]:
//   - A line ending with `<pre>` (and not also closing it on the same line)
//     opens a block — content on subsequent lines indents one level deeper.
//   - A line that IS just `</pre>` closes the block.
// This produces clean output where `<br/>` lines sit one indent past the
// `Step Conditions = <pre>` line and `</pre>` aligns back with it, instead
// of preserving whatever (often misaligned) column the source happened to
// use.
const PRE_OPENER_AT_END = /<pre[^>]*>\s*$/i;
const PRE_CLOSER_WHOLE_LINE = /^<\/pre>\s*$/i;

export function formatEsi(text: string): string {
  const normalized = refactorWhitespace(text);
  const lines = normalized.split(/\r?\n/);
  const out: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped === "") {
      out.push("");
      continue;
    }

    const tagClosing = CLOSING_TAG_LINE.test(stripped);
    const tagOpening = !tagClosing && OPENING_TAG_LINE.test(stripped);
    const preCloser = PRE_CLOSER_WHOLE_LINE.test(stripped);
    const preOpener = !preCloser && PRE_OPENER_AT_END.test(stripped);

    if (tagClosing || preCloser) {
      depth = Math.max(0, depth - 1);
    }

    out.push(INDENT.repeat(depth) + stripped);

    if (tagOpening || preOpener) {
      depth += 1;
    }
  }

  return out.join("\n");
}
