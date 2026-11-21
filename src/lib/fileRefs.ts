import * as path from "path";

/**
 * Pure detection of FILE REFERENCES on a `.esi` line — the text ranges that
 * name another file — plus the one rule for turning such a name into a path.
 * No vscode, no fs: the document-link and CSV-hover providers are thin glue
 * over this, and the component validator shares the CSV cell-ref grammar.
 *
 * Only forms the repo itself evidences are detected:
 *   - `<file>.csv line:<N> col:<M>` — the value-from-CSV form the component
 *     validator already resolves;
 *   - the value of an `include file` key ([INCLUDE] snippet, esiOutline) and of
 *     a `result file` key ([EXTERNAL_VERIFY] snippet);
 *   - any other value token shaped like the grammar's `file-paths` rule
 *     (syntaxes/esi.json), e.g. the script named by a `system call`.
 * Nothing here says what TestPit DOES with such a file.
 */

export type FileRefKind = "csvCell" | "path";

export interface FileRef {
  kind: FileRefKind;
  /** The path exactly as written (surrounding quotes removed). */
  path: string;
  /** Columns of the path text on the line; endCol is exclusive. */
  startCol: number;
  endCol: number;
  /** Normalised key of the `key = value` line (lower-case, single spaces). */
  key: string;
  /** csvCell only: the 1-based cell address and the end of the whole ref. */
  csvLine?: number;
  csvCol?: number;
  refEndCol?: number;
}

export interface CsvCellRefMatch {
  file: string;
  line: number;
  col: number;
  /** Length of the whole `file.csv line:N col:M` text. */
  length: number;
}

// `<file>.csv line:<N> col:<M>`; whitespace around `:` is tolerated. The file
// may carry folders (`..\data\x.csv`) or a drive. A `%macro%` anywhere in it
// deliberately does not match: it cannot be resolved here.
const CSV_CELL_REF_RE =
  /^((?:[A-Za-z]:)?[A-Za-z0-9_.\-\\/]+\.csv)\s+line\s*:\s*(\d+)\s+col\s*:\s*(\d+)/i;

/** Parse a CSV cell reference at the START of `value` (no leading blanks). */
export function parseCsvCellRef(value: string): CsvCellRefMatch | undefined {
  const m = CSV_CELL_REF_RE.exec(value);
  if (!m) {
    return undefined;
  }
  return {
    file: m[1],
    line: parseInt(m[2], 10),
    col: parseInt(m[3], 10),
    length: m[0].length,
  };
}

/** Keys whose WHOLE value is one path (it may contain spaces). */
export const PATH_VALUED_KEYS: readonly string[] = ["include file", "result file"];

// Same shape as the grammar's `file-paths` rule (syntaxes/esi.json): a
// path-like token ending in a short extension that starts with a letter.
const FILE_PATH_TOKEN_RE = /^[\w./\\:-]*[\w/\\]\.[A-Za-z][A-Za-z0-9]{0,6}$/;
// Keys may be several words ("include file"), unlike message field names.
const KEY_VALUE_RE = /^(\s*)([A-Za-z][A-Za-z0-9_. ]*?)(\s*=\s*)(.*)$/;
const COMMENT_CHARACTER = "#";
const MACRO_CHARACTER = "%";

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strip one matching pair of double quotes; returns the text and its offset. */
function unquote(text: string): { text: string; offset: number } {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return { text: text.slice(1, -1), offset: 1 };
  }
  return { text, offset: 0 };
}

/**
 * File references on ONE line (no line terminator). Only `key = value` lines
 * are considered, and a value holding a `%macro%` yields nothing for the part
 * that holds it — its real text is only known after TestPit's macro pass.
 */
export function findFileRefs(line: string): FileRef[] {
  const hash = line.indexOf(COMMENT_CHARACTER);
  const code = hash === -1 ? line : line.slice(0, hash);
  const m = KEY_VALUE_RE.exec(code);
  if (!m) {
    return [];
  }
  const key = normalizeKey(m[2]);
  const valueCol = m[1].length + m[2].length + m[3].length;
  const value = m[4].replace(/\s+$/, "");
  if (value.length === 0) {
    return [];
  }

  const csv = parseCsvCellRef(value);
  if (csv) {
    return [
      {
        kind: "csvCell",
        path: csv.file,
        startCol: valueCol,
        endCol: valueCol + csv.file.length,
        key,
        csvLine: csv.line,
        csvCol: csv.col,
        refEndCol: valueCol + csv.length,
      },
    ];
  }

  if (PATH_VALUED_KEYS.includes(key)) {
    const whole = unquote(value);
    if (whole.text.trim().length === 0 || whole.text.includes(MACRO_CHARACTER)) {
      return [];
    }
    return [
      {
        kind: "path",
        path: whole.text,
        startCol: valueCol + whole.offset,
        endCol: valueCol + whole.offset + whole.text.length,
        key,
      },
    ];
  }

  const refs: FileRef[] = [];
  const tokenRe = /\S+/g;
  let t: RegExpExecArray | null;
  while ((t = tokenRe.exec(value)) !== null) {
    const token = unquote(t[0]);
    if (token.text.includes(MACRO_CHARACTER) || !FILE_PATH_TOKEN_RE.test(token.text)) {
      continue;
    }
    const startCol = valueCol + t.index + token.offset;
    refs.push({
      kind: "path",
      path: token.text,
      startCol,
      endCol: startCol + token.text.length,
      key,
    });
  }
  return refs;
}

/** The CSV cell reference whose text covers `character` on this line, if any. */
export function csvCellRefAt(line: string, character: number): FileRef | undefined {
  return findFileRefs(line).find(
    (r) =>
      r.kind === "csvCell" &&
      character >= r.startCol &&
      character <= (r.refEndCol ?? r.endCol)
  );
}

/**
 * THE resolution rule: a referenced file is relative to the folder of the
 * script that names it (an absolute path stays as it is). `.esi` scripts are
 * written on Windows, so on a POSIX host a `\` is read as a separator.
 */
export function resolveScriptRelative(
  scriptPath: string,
  ref: string,
  pathImpl: Pick<typeof path, "sep" | "resolve" | "dirname"> = path
): string {
  const normalized = pathImpl.sep === "/" ? ref.replace(/\\/g, "/") : ref;
  return pathImpl.resolve(pathImpl.dirname(scriptPath), normalized);
}

export interface ResolvedFileRef extends FileRef {
  /** 0-based line of the reference in the document. */
  lineNumber: number;
  /** Absolute path the reference resolves to. */
  target: string;
}

/**
 * Every file reference in a document whose target EXISTS as a file, resolved
 * against the script's folder. `isFile` is injected (the provider passes an
 * fs check); each distinct target is probed once per call.
 */
export function findExistingFileRefs(
  documentText: string,
  scriptPath: string,
  isFile: (absolutePath: string) => boolean
): ResolvedFileRef[] {
  const out: ResolvedFileRef[] = [];
  const known = new Map<string, boolean>();
  const lines = documentText.split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    for (const ref of findFileRefs(lines[lineNumber])) {
      const target = resolveScriptRelative(scriptPath, ref.path);
      let exists = known.get(target);
      if (exists === undefined) {
        exists = isFile(target);
        known.set(target, exists);
      }
      if (exists) {
        out.push({ ...ref, lineNumber, target });
      }
    }
  }
  return out;
}
