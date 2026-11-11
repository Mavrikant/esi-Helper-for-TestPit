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

/** Snippet text of the cell address; both numbers are 1-based (fileRefs.ts). */
export const CSV_TAIL_SNIPPET = "line:${1:1} col:${2:1}";

export type CsvValueContext =
  | {
      kind: "file";
      /** Folder part typed so far, with its trailing separator ("" = none). */
      dirPart: string;
      /** Replace range on the line: the file-name part typed so far. */
      startCol: number;
      endCol: number;
    }
  | {
      kind: "tail";
      /** Replace range on the line: what is typed of the tail so far. */
      startCol: number;
      endCol: number;
    };

// A path being typed: optional drive, then the characters parseCsvCellRef
// accepts in a file name. No blank, no `%` (a macro cannot be resolved here).
const PATH_PARTIAL_RE = /^(?:[A-Za-z]:)?[A-Za-z0-9_.\-\\/]*$/;
// `<file>.csv`, blanks, and the start of the tail (nothing of it, or letters).
const TAIL_PARTIAL_RE = /^(?:[A-Za-z]:)?[A-Za-z0-9_.\-\\/]+\.csv\s+([A-Za-z]*)$/i;

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
  const tail = TAIL_PARTIAL_RE.exec(rhs);
  if (tail) {
    return {
      kind: "tail",
      startCol: character - tail[1].length,
      endCol: character,
    };
  }
  if (!PATH_PARTIAL_RE.test(rhs)) {
    return undefined;
  }
  const lastSep = Math.max(rhs.lastIndexOf("/"), rhs.lastIndexOf("\\"));
  const dirPart = rhs.slice(0, lastSep + 1);
  return {
    kind: "file",
    dirPart,
    startCol: character - (rhs.length - dirPart.length),
    endCol: character,
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

/** One entry per file: the file name followed by the cell-address tab stops. */
export function csvFileEntries(fileNames: readonly string[]): CsvValueEntry[] {
  return fileNames.map((name, i) => ({
    kind: "file" as const,
    label: name,
    detail: "CSV cell: line:N col:M",
    insertText: `${escapeSnippet(name)} ${CSV_TAIL_SNIPPET}`,
    filterText: name,
    sortText: `9${String(i).padStart(4, "0")}`,
  }));
}

/** The ` line:N col:M` tail, for a `.csv` name that is already typed. */
export function csvTailEntry(): CsvValueEntry {
  return {
    kind: "tail",
    label: "line:N col:M",
    detail: "CSV cell address (1-based line and column)",
    insertText: CSV_TAIL_SNIPPET,
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
 * Names of the `.csv` files directly in `dir`, sorted, capped. A folder that
 * cannot be read (missing, no access) simply has none.
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
    .filter((e) => e.isFile() && /\.csv$/i.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}
