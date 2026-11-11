import * as fs from "fs";
import { resolveScriptRelative } from "./fileRefs";

/**
 * CSV reading for `<file>.csv line:<N> col:<M>` references — one
 * implementation shared by the live component diagnostics, the "Show
 * Validation Info" report, the document links and the CSV hover.
 *
 * The parser follows RFC 4180: comma-separated, a field may be wrapped in
 * double quotes and then hold commas, line breaks and `""` (an escaped quote).
 * It is lenient where the previous comma-split reader was, so simple files
 * read exactly as before:
 *   - blanks around an UNQUOTED field are trimmed (and blanks around the
 *     quotes of a quoted one are ignored);
 *   - a field whose opening quote is never closed is taken literally instead
 *     of swallowing the rest of the file;
 *   - a blank line is a record with one empty field, so `line:N` keeps
 *     counting physical lines.
 * A UTF-8 BOM is dropped. The delimiter is always a comma.
 */

export interface CsvCell {
  text: string;
  /** 0-based position of the field's first character in the file. */
  line: number;
  character: number;
}

export interface CsvTable {
  rows: CsvCell[][];
  /**
   * 1-based number of the first record that spans several physical lines
   * (a quoted field with a line break), or 0 when there is none. From that
   * record on, "line N" could mean the Nth record or the Nth physical line.
   */
  firstMultilineRow: number;
}

const BOM = "﻿";

function isBlank(ch: string): boolean {
  return ch === " " || ch === "\t";
}

export function parseCsvTable(input: string): CsvTable {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: CsvCell[][] = [];
  let firstMultilineRow = 0;
  let pos = 0;
  let line = 0;
  let lineStart = 0;
  let row: CsvCell[] = [];

  const atNewline = (i: number): number => {
    if (text[i] === "\n") {
      return 1;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      return 2;
    }
    return 0;
  };

  /**
   * Try to read a quoted field starting at the `"` at `start`. Succeeds only
   * when the quote closes and nothing but blanks follows before the next
   * delimiter / line end; returns undefined otherwise (caller reads literally).
   */
  const readQuoted = (
    start: number
  ): { value: string; end: number; newlines: number; lastLineStart: number } | undefined => {
    let i = start + 1;
    let value = "";
    let newlines = 0;
    let lastLineStart = lineStart;
    for (;;) {
      if (i >= text.length) {
        return undefined;
      }
      const ch = text[i];
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        i += 1;
        break;
      }
      if (ch === "\n") {
        newlines += 1;
        lastLineStart = i + 1;
      }
      value += ch;
      i += 1;
    }
    while (i < text.length && isBlank(text[i])) {
      i += 1;
    }
    if (i < text.length && text[i] !== "," && atNewline(i) === 0) {
      return undefined;
    }
    return { value, end: i, newlines, lastLineStart };
  };

  while (pos < text.length) {
    // --- one field ---
    let start = pos;
    while (start < text.length && isBlank(text[start])) {
      start += 1;
    }
    const quoted = text[start] === '"' ? readQuoted(start) : undefined;
    if (quoted) {
      row.push({ text: quoted.value, line, character: start - lineStart });
      if (quoted.newlines > 0) {
        if (firstMultilineRow === 0) {
          firstMultilineRow = rows.length + 1;
        }
        line += quoted.newlines;
        lineStart = quoted.lastLineStart;
      }
      pos = quoted.end;
    } else {
      let end = pos;
      while (end < text.length && text[end] !== "," && atNewline(end) === 0) {
        end += 1;
      }
      const rawField = text.slice(pos, end);
      const lead = rawField.length - rawField.replace(/^\s+/, "").length;
      row.push({
        text: rawField.trim(),
        line,
        character: pos + lead - lineStart,
      });
      pos = end;
    }

    // --- what ended it ---
    if (pos >= text.length) {
      break;
    }
    if (text[pos] === ",") {
      pos += 1;
      if (pos >= text.length) {
        // Trailing comma at end of file: one last empty field.
        row.push({ text: "", line, character: pos - lineStart });
      }
      continue;
    }
    pos += atNewline(pos);
    rows.push(row);
    row = [];
    line += 1;
    lineStart = pos;
  }
  if (row.length > 0) {
    rows.push(row);
  }
  return { rows, firstMultilineRow };
}

/** Parse CSV text into rows of field values. */
export function parseCsv(input: string): string[][] {
  return parseCsvTable(input).rows.map((r) => r.map((c) => c.text));
}

export type CsvCellResult =
  | {
      status: "ok";
      value: string;
      /** 0-based position of the cell in the CSV file. */
      fileLine: number;
      fileCharacter: number;
      /** All field values of the addressed record. */
      row: string[];
      /** The same column in the FIRST record (often, not always, a header). */
      firstRowValue: string | undefined;
    }
  | { status: "fileMissing" }
  | { status: "rowMissing"; rowCount: number }
  | { status: "colMissing"; colCount: number }
  /**
   * The file has a record spanning several lines at or before the requested
   * line, so the address cannot be resolved without knowing how TestPit
   * counts such lines. Callers must not guess.
   */
  | { status: "ambiguous" };

/** Resolve a 1-based `line`/`col` address in a parsed table. */
export function lookupCsvCell(
  table: CsvTable | undefined,
  line: number,
  col: number
): CsvCellResult {
  if (!table) {
    return { status: "fileMissing" };
  }
  if (table.firstMultilineRow > 0 && line >= table.firstMultilineRow) {
    return { status: "ambiguous" };
  }
  const row = line >= 1 ? table.rows[line - 1] : undefined;
  if (!row) {
    return { status: "rowMissing", rowCount: table.rows.length };
  }
  const cell = col >= 1 ? row[col - 1] : undefined;
  if (!cell) {
    return { status: "colMissing", colCount: row.length };
  }
  return {
    status: "ok",
    value: cell.text,
    fileLine: cell.line,
    fileCharacter: cell.character,
    row: row.map((c) => c.text),
    firstRowValue: table.rows[0]?.[col - 1]?.text,
  };
}

export type CsvCellLookup = (
  filename: string,
  line: number,
  col: number
) => CsvCellResult;

/**
 * Build a CSV cell lookup for one script. `filename` is resolved against the
 * script's folder (resolveScriptRelative); each file is read and parsed at
 * most once per lookup instance, so make a fresh one per validation pass /
 * request to pick up edits. An unreadable file answers "fileMissing".
 */
export function createCsvCellLookup(
  scriptPath: string,
  readFile: (absolutePath: string) => string = (p) => fs.readFileSync(p, "utf-8")
): CsvCellLookup {
  const tables = new Map<string, CsvTable | undefined>();
  return (filename, line, col) => {
    const fullPath = resolveScriptRelative(scriptPath, filename);
    if (!tables.has(fullPath)) {
      let table: CsvTable | undefined;
      try {
        table = parseCsvTable(readFile(fullPath));
      } catch {
        table = undefined;
      }
      tables.set(fullPath, table);
    }
    return lookupCsvCell(tables.get(fullPath), line, col);
  };
}

/** Why a cell could not be read, as a short phrase; undefined when it could. */
export function describeCsvMiss(result: CsvCellResult, line: number): string | undefined {
  switch (result.status) {
    case "fileMissing":
      return "file not found or unreadable";
    case "rowMissing":
      return `the file has ${result.rowCount} line(s)`;
    case "colMissing":
      return `line ${line} has ${result.colCount} column(s)`;
    default:
      return undefined;
  }
}

const HOVER_VALUE_MAX = 200;
const HOVER_ROW_NEIGHBOURS = 3;

/** Inline-code a cell value for Markdown: one line, bounded, backtick-safe. */
function code(value: string): string {
  let s = value.replace(/\r?\n/g, "⏎");
  if (s.length > HOVER_VALUE_MAX) {
    s = s.slice(0, HOVER_VALUE_MAX - 1) + "…";
  }
  if (s.length === 0) {
    return "*(empty)*";
  }
  if (!s.includes("`")) {
    return "`" + s + "`";
  }
  // CommonMark: fence with a backtick run longer than any inside the text.
  const longest = Math.max(...(s.match(/`+/g) ?? [""]).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return `${fence} ${s} ${fence}`;
}

/**
 * Markdown for the CSV-cell hover: the cell's value with its column / row
 * context, or a plain statement of what is missing. `resolvedPath` is the
 * absolute path the reference resolved to.
 */
export function renderCsvCellMarkdown(
  ref: { file: string; line: number; col: number },
  result: CsvCellResult,
  resolvedPath: string
): string {
  const title = `**CSV cell** ${code(ref.file)} line ${ref.line}, col ${ref.col}`;
  const where = `Resolved to ${code(resolvedPath)}`;
  if (result.status === "ambiguous") {
    return [
      title,
      "Not resolved: this file has a quoted field that spans several lines at or before this line, so the line number is ambiguous.",
      where,
    ].join("\n\n");
  }
  if (result.status !== "ok") {
    return [
      title,
      `Cell not found: ${describeCsvMiss(result, ref.line)}.`,
      where,
    ].join("\n\n");
  }
  const parts = [title, `Value: ${code(result.value)}`];
  if (ref.line > 1 && result.firstRowValue !== undefined) {
    parts.push(`Column ${ref.col}, line 1: ${code(result.firstRowValue)}`);
  }
  const target = ref.col - 1;
  const from = Math.max(0, target - HOVER_ROW_NEIGHBOURS);
  const to = Math.min(result.row.length, target + HOVER_ROW_NEIGHBOURS + 1);
  const cells = result.row
    .slice(from, to)
    .map((v, i) => (from + i === target ? `**${code(v)}**` : code(v)));
  const rowText =
    (from > 0 ? "… , " : "") +
    cells.join(" , ") +
    (to < result.row.length ? " , …" : "");
  parts.push(
    `Line ${ref.line} (${result.row.length} column(s)): ${rowText}`,
    where
  );
  return parts.join("\n\n");
}
