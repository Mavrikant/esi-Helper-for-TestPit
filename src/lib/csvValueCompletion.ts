/**
 * Completion of the value-from-CSV form `field = <file>.csv line:<N> col:<M>`
 * (the form componentValidator / fileRefs.parseCsvCellRef already read).
 * Two steps are offered after a field's `=`:
 *   - the `.csv` files beside the script (or in the folder typed so far),
 *     each inserting the whole reference with `line` / `col` as tab stops;
 *   - once a `.csv` name stands there, the ` line:N col:M` tail alone.
 *
 * vscode-free. The folder listing takes an injectable `readdir`.
 */
import * as fs from "fs";
import { parseCsvCellRef } from "./fileRefs";

/** Snippet text of the cell address; both numbers are 1-based (fileRefs.ts). */
export const CSV_TAIL_SNIPPET = "line:${1:1} col:${2:1}";

export type CsvValueContext =
  | {
      kind: "file";
      /** Folder part typed so far, with its trailing separator ("" = none). */
      dirPart: string;
      /**
       * Replace range on the line: the file-name part, through the rest of
       * it after the cursor (retyping a name replaces it whole).
       */
      startCol: number;
      endCol: number;
      /**
       * Present (true) when a ` line:N col:M` address already follows the
       * name: only the name is inserted then.
       */
      hasTail?: true;
    }
  | {
      kind: "tail";
      /**
       * Replace range on the line: the word of the tail at the cursor, while
       * it can still be `line` (and the blanks before a `col:M` after it).
       */
      startCol: number;
      endCol: number;
      /**
       * Present (true) when the numbers already follow (`li|:4 col:2`): only
       * the `line` word is inserted then.
       */
      hasAddress?: true;
      /**
       * Present (true) when a `col:M` already follows (`data.csv |col:2`):
       * only `line:N ` goes in front of it.
       */
      colFollows?: true;
    };

// A path being typed: optional drive, then the characters parseCsvCellRef
// accepts in a file name. No blank, no `%` (a macro cannot be resolved here).
const PATH_PARTIAL_RE = /^(?:[A-Za-z]:)?[A-Za-z0-9_.\-\\/]*$/;
// `<file>.csv`, blanks, and the start of the tail (nothing of it, or letters).
const TAIL_PARTIAL_RE = /^(?:[A-Za-z]:)?[A-Za-z0-9_.\-\\/]+\.csv\s+([A-Za-z]*)$/i;
// After the cursor: the rest of a file name; then an address already there.
const PATH_REST_RE = /^[A-Za-z0-9_.\-\\/]*/;
const ADDRESS_AFTER_NAME_RE = /^\s+line\s*:\s*\d+\s+col\s*:\s*\d+/i;
// After the cursor, in the tail: the rest of the word; then `:N`, or the
// column part of the address (with the blanks before it).
const WORD_REST_RE = /^[A-Za-z]*/;
const NUMBER_AFTER_WORD_RE = /^\s*:\s*\d+/;
const COL_AFTER_RE = /^(\s*)col\s*:\s*\d+/i;

/**
 * Where the cursor stands in a CSV reference, from the text of its line.
 * `undefined` when the line has no `=` before the cursor, or the value typed
 * so far cannot be the start of one (a comment, a macro, several words).
 */
export function csvValueContext(
  line: string,
  character: number
): CsvValueContext | undefined {
  const before = line.slice(0, character);
  const eq = before.indexOf("=");
  if (eq === -1 || before.includes("#")) {
    return undefined;
  }
  const rhs = before.slice(eq + 1).replace(/^\s+/, "");
  const after = line.slice(character);
  const tail = TAIL_PARTIAL_RE.exec(rhs);
  if (tail) {
    // The rest of the word at the cursor is replaced only while the word can
    // still be `line`: another one (`data.csv |col:2`) is kept.
    const wordRest = (WORD_REST_RE.exec(after) as RegExpExecArray)[0];
    const inLineWord = "line".startsWith((tail[1] + wordRest).toLowerCase());
    const rest = inLineWord ? wordRest : "";
    const afterWord = after.slice(rest.length);
    if (inLineWord && NUMBER_AFTER_WORD_RE.test(afterWord)) {
      return {
        kind: "tail",
        startCol: character - tail[1].length,
        endCol: character + rest.length,
        hasAddress: true,
      };
    }
    const col = COL_AFTER_RE.exec(afterWord);
    return {
      kind: "tail",
      startCol: character - tail[1].length,
      endCol: character + rest.length + (col ? col[1].length : 0),
      ...(col ? { colFollows: true as const } : {}),
    };
  }
  if (!PATH_PARTIAL_RE.test(rhs)) {
    return undefined;
  }
  const lastSep = Math.max(rhs.lastIndexOf("/"), rhs.lastIndexOf("\\"));
  const dirPart = rhs.slice(0, lastSep + 1);
  const rest = (PATH_REST_RE.exec(after) as RegExpExecArray)[0];
  return {
    kind: "file",
    dirPart,
    startCol: character - (rhs.length - dirPart.length),
    endCol: character + rest.length,
    ...(ADDRESS_AFTER_NAME_RE.test(after.slice(rest.length))
      ? { hasTail: true as const }
      : {}),
  };
}

export interface CsvValueEntry {
  kind: "file" | "tail";
  label: string;
  detail: string;
  /** Snippet syntax. */
  insertText: string;
  filterText: string;
  /** Ranked below everything else offered for the value. */
  sortText: string;
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&");
}

/**
 * One entry per file: the file name followed by the cell-address tab stops —
 * or the name alone when an address already follows (`withTail: false`).
 */
export function csvFileEntries(
  fileNames: readonly string[],
  options: { withTail?: boolean } = {}
): CsvValueEntry[] {
  const withTail = options.withTail ?? true;
  return fileNames.map((name, i) => ({
    kind: "file" as const,
    label: name,
    detail: "CSV cell: line:N col:M",
    insertText: withTail
      ? `${escapeSnippet(name)} ${CSV_TAIL_SNIPPET}`
      : escapeSnippet(name),
    filterText: name,
    sortText: `9${String(i).padStart(4, "0")}`,
  }));
}

/**
 * The ` line:N col:M` tail, for a `.csv` name that is already typed — or the
 * `line` word alone when its numbers already follow (`withNumbers: false`),
 * or `line:N ` alone in front of a `col:M` already there (`beforeCol`).
 */
export function csvTailEntry(
  options: { withNumbers?: boolean; beforeCol?: boolean } = {}
): CsvValueEntry {
  return {
    kind: "tail",
    label: "line:N col:M",
    detail: "CSV cell address (1-based line and column)",
    insertText: options.beforeCol
      ? "line:${1:1} "
      : options.withNumbers ?? true
        ? CSV_TAIL_SNIPPET
        : "line",
    filterText: "line",
    sortText: "90000",
  };
}

/** Upper bound on the files listed from one folder. */
export const CSV_FILE_LIMIT = 200;

interface DirEntryLike {
  name: string;
  isFile(): boolean;
}

/**
 * Is `name` a file name the reference parser reads back whole? A name with a
 * blank, a parenthesis, `$`, a non-ASCII letter, … is not: inserting it would
 * give text the extension does not treat as a CSV reference.
 */
function isReferableCsvName(name: string): boolean {
  return parseCsvCellRef(`${name} line:1 col:1`)?.file === name;
}

/**
 * Names of the `.csv` files directly in `dir`, sorted, capped — only those
 * parseCsvCellRef accepts as a file name. A folder that cannot be read
 * (missing, no access) simply has none.
 */
export function listCsvFiles(
  dir: string,
  readdir: (dir: string) => DirEntryLike[] = (d) =>
    fs.readdirSync(d, { withFileTypes: true }),
  limit = CSV_FILE_LIMIT
): string[] {
  let entries: DirEntryLike[];
  try {
    entries = readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.csv$/i.test(e.name) && isReferableCsvName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}
