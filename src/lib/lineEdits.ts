// Minimal, line-preserving edits between a document and its formatted form.
//
// The ESI formatter never adds, removes or reorders lines — it only rewrites
// the content of a line. So instead of replacing the whole document (which
// throws away cursor, selection and fold state), each changed line becomes one
// small edit that touches only the part of the line that differs. Line
// terminators are never part of an edit, so CRLF / LF survive untouched.
//
// vscode-free: positions are plain { line, startCol, endCol } in UTF-16 units,
// the same units VS Code's Position.character uses.

export interface LineEdit {
  /** 0-based line index. */
  line: number;
  /** Replaced span on that line: [startCol, endCol). */
  startCol: number;
  endCol: number;
  newText: string;
}

/** Inclusive 0-based line span. */
export interface LineSpan {
  startLine: number;
  endLine: number;
}

/**
 * Expand a selection to whole lines. A multi-line selection that ends at
 * column 0 has not actually selected anything on its last line, so that line
 * is left out (the usual editor convention).
 */
export function selectionToLineSpan(
  startLine: number,
  endLine: number,
  endCharacter: number
): LineSpan {
  const lo = Math.min(startLine, endLine);
  let hi = Math.max(startLine, endLine);
  if (endLine > startLine && endCharacter === 0) {
    hi -= 1;
  }
  return { startLine: lo, endLine: hi };
}

/**
 * Per-line edits turning `original` into `formatted`, restricted to `span`
 * when given. Lines outside the span are never touched.
 *
 * Returns `null` when the two texts do not have the same number of lines —
 * the line-by-line mapping is then meaningless and the caller must decide
 * what to do (the ESI transforms always preserve the line count).
 */
export function computeLineEdits(
  original: string,
  formatted: string,
  span?: LineSpan
): LineEdit[] | null {
  const before = original.split(/\r?\n/);
  const after = formatted.split(/\r?\n/);
  if (before.length !== after.length) {
    return null;
  }
  const first = Math.max(0, span ? span.startLine : 0);
  const last = Math.min(before.length - 1, span ? span.endLine : before.length - 1);
  const edits: LineEdit[] = [];
  for (let line = first; line <= last; line++) {
    const a = before[line];
    const b = after[line];
    if (a === b) {
      continue;
    }
    // Trim the common prefix and suffix so only the differing middle is
    // replaced (typically just the leading indent or the padding before `=`).
    const maxCommon = Math.min(a.length, b.length);
    let prefix = 0;
    while (prefix < maxCommon && a.charCodeAt(prefix) === b.charCodeAt(prefix)) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < maxCommon - prefix &&
      a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
    ) {
      suffix += 1;
    }
    edits.push({
      line,
      startCol: prefix,
      endCol: a.length - suffix,
      newText: b.slice(prefix, b.length - suffix),
    });
  }
  return edits;
}

/**
 * Apply line edits to `text`, keeping every line terminator exactly as it
 * was. Reference implementation of what the editor does with the edits; used
 * by the tests to prove the edits reproduce the formatter's output.
 */
export function applyLineEdits(text: string, edits: LineEdit[]): string {
  // Split keeping the terminators: [line0, eol0, line1, eol1, …, lineN].
  const parts = text.split(/(\r?\n)/);
  for (const e of edits) {
    const idx = e.line * 2;
    const current = parts[idx];
    parts[idx] = current.slice(0, e.startCol) + e.newText + current.slice(e.endCol);
  }
  return parts.join("");
}
