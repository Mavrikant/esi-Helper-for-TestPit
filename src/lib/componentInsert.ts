/**
 * Where and what the component browser writes into a `.esi` document when a
 * connection or a field is picked in the side view. vscode-free; the command
 * (commands/insertComponent.ts) only applies the plan as a snippet.
 *
 * The block text itself comes from tagCompletion.ts — the same function that
 * answers `[` in the editor — so a block inserted from the view is the block
 * completion would have written on that line (including NOT adding a closing
 * tag when one is already waiting below).
 *
 * Placement, the same for both kinds:
 *   - cursor on a blank line → that line is filled in. Its own whitespace is
 *     kept as the indentation; a line with none is indented one level deeper
 *     than the section it sits in.
 *   - cursor on a line with text → a new line is added BELOW it, indented like
 *     that line, or one level deeper when that line is an opening section tag.
 * The cursor line's own text is never changed.
 */
import { parseSectionTagLine } from "./parseSectionTag";
import { computeTagCompletions, openSectionsBefore } from "./tagCompletion";

/** One level of indentation, as formatEsi.ts writes it. */
const INDENT = "    ";

export interface InsertPlan {
  /** 0-indexed line the snippet goes on. */
  line: number;
  /** The snippet replaces columns [startCol, endCol) of that line. */
  startCol: number;
  endCol: number;
  /**
   * Snippet syntax (tab stops, escaped `$`), indentation spelled out — insert
   * it with `keepWhitespace`. Lines are separated by `\n`.
   */
  snippet: string;
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&");
}

interface Slot {
  /** The document's lines with the new, still empty, line in place. */
  lines: string[];
  /** Index in `lines` of the line the text is written on. */
  targetLine: number;
  indent: string;
  /** True when the target line was added below the cursor line. */
  added: boolean;
  cursorLine: number;
  cursorLineLength: number;
}

function slotFor(documentText: string, cursorLine: number): Slot | undefined {
  const lines = documentText.split(/\r?\n/);
  if (cursorLine < 0 || cursorLine >= lines.length) {
    return undefined;
  }
  const text = lines[cursorLine];
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  if (text.trim() === "") {
    let indent = text;
    if (indent === "") {
      const open = openSectionsBefore(lines, cursorLine);
      indent = open.length > 0 ? open[open.length - 1].indent + INDENT : "";
    }
    return {
      lines,
      targetLine: cursorLine,
      indent,
      added: false,
      cursorLine,
      cursorLineLength: text.length,
    };
  }
  const tag = parseSectionTagLine(text);
  const opens = tag !== undefined && !tag.invalid && tag.kind === "open";
  const withNew = lines.slice();
  withNew.splice(cursorLine + 1, 0, "");
  return {
    lines: withNew,
    targetLine: cursorLine + 1,
    indent: opens ? lead + INDENT : lead,
    added: true,
    cursorLine,
    cursorLineLength: text.length,
  };
}

function planFor(slot: Slot, body: string): InsertPlan {
  if (slot.added) {
    return {
      line: slot.cursorLine,
      startCol: slot.cursorLineLength,
      endCol: slot.cursorLineLength,
      snippet: `\n${body}`,
    };
  }
  return {
    line: slot.cursorLine,
    startCol: 0,
    endCol: slot.cursorLineLength,
    snippet: body,
  };
}

/**
 * Plan inserting the block of connection `name` (`[name]` … `[/name]`) at the
 * cursor line. Undefined when the cursor line is outside the document.
 */
export function planConnectionInsert(
  documentText: string,
  cursorLine: number,
  name: string
): InsertPlan | undefined {
  const slot = slotFor(documentText, cursorLine);
  if (!slot) {
    return undefined;
  }
  // Ask tag completion what typing `[` on that line and accepting `name`
  // would write.
  const lines = slot.lines.slice();
  lines[slot.targetLine] = `${slot.indent}[`;
  const result = computeTagCompletions(
    lines.join("\n"),
    slot.targetLine,
    slot.indent.length + 1,
    "",
    false,
    [name]
  );
  const entry = result?.entries.find(
    (e) => e.source === "connection" && e.label === name
  );
  if (!entry) {
    return undefined;
  }
  const text = entry.isSnippet ? entry.insertText : escapeSnippet(entry.insertText);
  return planFor(slot, `${slot.indent}[${text}`);
}

/**
 * Plan inserting a `name = ` line for field `name` at the cursor line, the
 * cursor left after the `=`. Undefined when the cursor line is outside the
 * document.
 */
export function planFieldInsert(
  documentText: string,
  cursorLine: number,
  name: string
): InsertPlan | undefined {
  const slot = slotFor(documentText, cursorLine);
  if (!slot) {
    return undefined;
  }
  return planFor(slot, `${slot.indent}${escapeSnippet(name)} = $0`);
}
