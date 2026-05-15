import { refactorWhitespace } from "./refactorWhitespace";

const INDENT = "    ";

// Lines that ARE just an opening tag, e.g. "[STEP 10]" or "[STEP INPUTS]".
// Mid-line tags (e.g. `Step Conditions = <pre>` or `foo [BAR]`) are treated
// as regular content so their depth isn't disturbed.
const OPENING_TAG_LINE = /^\[[^/\]][^\]]*\]\s*$/;
const CLOSING_TAG_LINE = /^\[\/[^\]]+\]\s*$/;

// `<pre>...</pre>` blocks contain hand-aligned text (e.g. "Step Conditions"
// fields). When a `<pre>` opens without closing on the same line, we leave
// every subsequent line untouched until we see `</pre>` so the visual
// alignment isn't destroyed by re-indentation.
const PRE_OPEN = /<pre[^>]*>/i;
const PRE_CLOSE = /<\/pre>/i;

export function formatEsi(text: string): string {
  const normalized = refactorWhitespace(text);
  const lines = normalized.split("\n");
  const out: string[] = [];
  let depth = 0;
  let inPre = false;

  for (const line of lines) {
    if (inPre) {
      out.push(line);
      if (PRE_CLOSE.test(line)) {
        inPre = false;
      }
      continue;
    }

    const stripped = line.trim();

    if (stripped === "") {
      out.push("");
      continue;
    }

    const closing = CLOSING_TAG_LINE.test(stripped);
    const opening = !closing && OPENING_TAG_LINE.test(stripped);

    if (closing) {
      depth = Math.max(0, depth - 1);
    }

    out.push(INDENT.repeat(depth) + stripped);

    if (opening) {
      depth += 1;
    }

    if (PRE_OPEN.test(stripped) && !PRE_CLOSE.test(stripped)) {
      inPre = true;
    }
  }

  return out.join("\n");
}
