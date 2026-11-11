/**
 * `%MACRO%` variables: where they are defined, where they are used, and the
 * checks / edits built on that. vscode-free and fs-free — an included file is
 * read through an injected {@link MacroFileReader}.
 *
 * What this file takes as given, and where each fact comes from in this repo
 * (TestPit's own source is NOT here, so nothing beyond these is assumed):
 *   - a macro is written `%NAME%`, NAME = letters, digits, underscore
 *     (syntaxes/esi.json `macros`);
 *   - `%NAME% = value` lines inside `[VARIABLES]` define macros
 *     (snippets.json `VARIABLES`; tagCompletion: "Constant macros for this file");
 *   - `%NAME% = value` lines also appear inside `[INCLUDE]` next to
 *     `include file = <path>` (esiOutline test: `%TESTSETUP% = SLTS`), i.e. an
 *     include can hand macros to the file it runs;
 *   - `#` starts a comment anywhere on a line (parseSectionTag, grammar).
 *
 * What is NOT known, and how it is handled:
 *   - whether a macro defined in an included file is visible to the includer,
 *     whether names are case-sensitive, whether definition order matters,
 *     whether TestPit has built-in / environment / command-line macros, and
 *     what an include path is relative to. So: every definition that can be
 *     found (this file + readable includes) counts as "defined", order is
 *     ignored, "undefined" is a warning at most and is dropped whenever part of
 *     the picture is missing, and a case-only mismatch is only a hint.
 */
import type { FixEdit, QuickFix } from "./quickFixes";
import { parseSectionTagLine } from "./parseSectionTag";
import {
  SEC_INCLUDE,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
  SEC_VARIABLES,
} from "./sectionNames";
import { suggest } from "./suggest";

const COMMENT_CHARACTER = "#";
const NAME_CHARS = "A-Za-z0-9_";
const MACRO_RE_SOURCE = `%([${NAME_CHARS}]+)%`;
const MACRO_NAME_RE = new RegExp(`^[${NAME_CHARS}]+$`);
const DEFINITION_RE = new RegExp(`^\\s*%([${NAME_CHARS}]+)%\\s*=(.*)$`);
const KEY_VALUE_RE = /^\s*([^=]+?)\s*=(.*)$/;
const INCLUDE_FILE_KEY = "include file";
const DEFAULT_MAX_INCLUDE_DEPTH = 8;
const MAX_NAME_SUGGESTIONS = 3;

/**
 * Names that are never reported as undefined although nothing in a script
 * defines them. `TIMEOUT`: the extension's own `[CMD_EXECUTE]` snippet writes
 * `wait timeout = %TIMEOUT%` with no accompanying definition. Whether TestPit
 * supplies it or the author is expected to define it is not known here, so the
 * deliberate choice is to stay silent about it (it is still reported as
 * unused if a script defines it and never uses it, and it is not offered in
 * completion unless a script defines it).
 */
export const ASSUMED_EXTERNAL_MACROS: ReadonlySet<string> = new Set(["TIMEOUT"]);

export type MacroScope =
  /** `%X% = v` inside `[VARIABLES]`. */
  | "variables"
  /** `%X% = v` inside `[INCLUDE]` — handed to the included file. */
  | "includeArgument";

export interface MacroDefinition {
  name: string;
  /** Text right of `=`, comment removed, trimmed. First line only. */
  value: string;
  line: number;
  /** Columns of the whole `%NAME%` token. */
  startCol: number;
  endCol: number;
  scope: MacroScope;
  /** Reader key of the included file it is in; absent = the document itself. */
  file?: string;
}

export interface MacroOccurrence {
  name: string;
  line: number;
  /** Columns of the whole `%NAME%` token. */
  startCol: number;
  endCol: number;
  role: "definition" | "reference";
}

export interface MacroInclude {
  /** Value of `include file`, comment and surrounding quotes removed. */
  path: string;
  line: number;
  startCol: number;
  endCol: number;
}

export interface MacroScan {
  definitions: MacroDefinition[];
  /** Every `%NAME%` outside a comment, definitions included, in text order. */
  occurrences: MacroOccurrence[];
  includes: MacroInclude[];
  /** Has a `[TEST STEPS]` / `[TEST DEFINITION]` — same test as validateStructure. */
  isRootScript: boolean;
}

export interface IncludedFile {
  /** Stable identity of the file (an absolute path); used for cycle detection. */
  key: string;
  text: string;
}

/**
 * Reads the file an `include file = <path>` names. `fromKey` is the key of the
 * including file, or undefined when that is the document being analysed.
 * Returns undefined when the file cannot be found or read.
 */
export type MacroFileReader = (
  includePath: string,
  fromKey: string | undefined
) => IncludedFile | undefined;

export interface MacroResolver {
  readInclude?: MacroFileReader;
  /** Key the reader would give the document itself (keeps cycles out). */
  selfKey?: string;
  /** Extra names to treat as defined elsewhere (never reported undefined). */
  knownNames?: Iterable<string>;
  /** How many include levels to follow. Default 8. */
  maxDepth?: number;
}

export interface IncludedScan {
  key: string;
  scan: MacroScan;
}

export interface MacroModel {
  local: MacroScan;
  /** Every readable file reached through includes, each once. */
  included: IncludedScan[];
  /**
   * True when some include could not be followed: no reader, unreadable file,
   * a `%macro%` in the path, or the depth limit was hit.
   */
  unresolvedIncludes: boolean;
  knownNames: Set<string>;
}

export type MacroIssueKind = "undefinedMacro" | "unusedMacro";

export const MACRO_ISSUE_KINDS: readonly MacroIssueKind[] = [
  "undefinedMacro",
  "unusedMacro",
];

export function isMacroIssueKind(kind: unknown): kind is MacroIssueKind {
  return (MACRO_ISSUE_KINDS as readonly unknown[]).includes(kind);
}

/** Shaped like ComponentIssue (componentValidator.ts), plus "hint". */
export interface MacroIssue {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  /** The macro NAME, without the percent signs. */
  identifier: string;
  kind: MacroIssueKind;
  severity: "warning" | "hint";
  /** Render with DiagnosticTag.Unnecessary (faded). */
  unnecessary?: boolean;
  /** undefinedMacro: every name a definition was found for. */
  fix?: { candidates: string[] };
}

function stripComment(line: string): string {
  const hash = line.indexOf(COMMENT_CHARACTER);
  return hash === -1 ? line : line.slice(0, hash);
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function isValidMacroName(name: string): boolean {
  return MACRO_NAME_RE.test(name);
}

/** Find definitions, occurrences and includes in one document. */
export function scanMacros(text: string): MacroScan {
  const lines = splitLines(text);
  const scan: MacroScan = {
    definitions: [],
    occurrences: [],
    includes: [],
    isRootScript: false,
  };
  // Open sections, innermost last. A one-liner `[NAME/]` is never pushed.
  const stack: string[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum];
    const tag = parseSectionTagLine(raw);
    if (tag) {
      if (!tag.invalid) {
        if (
          tag.kind !== "close" &&
          (tag.name === SEC_TEST_STEPS || tag.name === SEC_TEST_DEFINITION)
        ) {
          scan.isRootScript = true;
        }
        if (tag.kind === "open") {
          stack.push(tag.name);
        } else if (tag.kind === "close") {
          const at = stack.lastIndexOf(tag.name);
          if (at !== -1) {
            stack.length = at;
          }
        }
      }
      // A tag line holds no definition, but a macro inside the tag name
      // (`[STEP %N%]`) is still a use — fall through to the occurrence scan.
    }

    const code = stripComment(raw);
    const section = stack.length > 0 ? stack[stack.length - 1] : undefined;
    let definitionCol = -1;

    if (!tag && (section === SEC_VARIABLES || section === SEC_INCLUDE)) {
      const def = DEFINITION_RE.exec(code);
      if (def) {
        definitionCol = code.indexOf("%");
        scan.definitions.push({
          name: def[1],
          value: def[2].trim(),
          line: lineNum,
          startCol: definitionCol,
          endCol: definitionCol + def[1].length + 2,
          scope: section === SEC_VARIABLES ? "variables" : "includeArgument",
        });
      } else if (section === SEC_INCLUDE) {
        const kv = KEY_VALUE_RE.exec(code);
        if (
          kv &&
          kv[1].toLowerCase().replace(/\s+/g, " ") === INCLUDE_FILE_KEY
        ) {
          let value = kv[2].trim();
          let startCol = code.length - kv[2].length + (kv[2].length - kv[2].trimStart().length);
          if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
            startCol += 1;
          }
          if (value !== "") {
            scan.includes.push({
              path: value,
              line: lineNum,
              startCol,
              endCol: startCol + value.length,
            });
          }
        }
      }
    }

    const re = new RegExp(MACRO_RE_SOURCE, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      scan.occurrences.push({
        name: m[1],
        line: lineNum,
        startCol: m.index,
        endCol: m.index + m[0].length,
        role: m.index === definitionCol ? "definition" : "reference",
      });
    }
  }
  return scan;
}

/** Scan the document and every file its includes reach (cycle-safe). */
export function buildMacroModel(
  text: string,
  resolver: MacroResolver = {}
): MacroModel {
  const local = scanMacros(text);
  const maxDepth = resolver.maxDepth ?? DEFAULT_MAX_INCLUDE_DEPTH;
  const model: MacroModel = {
    local,
    included: [],
    unresolvedIncludes: false,
    knownNames: new Set(resolver.knownNames ?? []),
  };
  const visited = new Set<string>();
  if (resolver.selfKey !== undefined) {
    visited.add(resolver.selfKey);
  }

  const follow = (scan: MacroScan, fromKey: string | undefined, depth: number): void => {
    for (const inc of scan.includes) {
      if (!resolver.readInclude || inc.path.includes("%")) {
        model.unresolvedIncludes = true;
        continue;
      }
      if (depth > maxDepth) {
        model.unresolvedIncludes = true;
        continue;
      }
      let file: IncludedFile | undefined;
      try {
        file = resolver.readInclude(inc.path, fromKey);
      } catch {
        file = undefined;
      }
      if (!file) {
        model.unresolvedIncludes = true;
        continue;
      }
      if (visited.has(file.key)) {
        continue;
      }
      visited.add(file.key);
      const child = scanMacros(file.text);
      for (const d of child.definitions) {
        d.file = file.key;
      }
      model.included.push({ key: file.key, scan: child });
      follow(child, file.key, depth + 1);
    }
  };
  follow(local, undefined, 1);
  return model;
}

/** Definitions of `name`: the document's own first, then included files'. */
export function findMacroDefinitions(
  model: MacroModel,
  name: string
): MacroDefinition[] {
  const out = model.local.definitions.filter((d) => d.name === name);
  for (const inc of model.included) {
    out.push(...inc.scan.definitions.filter((d) => d.name === name));
  }
  return out;
}

/** Every name a definition was found for, in first-seen order. */
export function definedMacroNames(model: MacroModel): string[] {
  const names = new Set<string>();
  for (const d of model.local.definitions) {
    names.add(d.name);
  }
  for (const inc of model.included) {
    for (const d of inc.scan.definitions) {
      names.add(d.name);
    }
  }
  return Array.from(names);
}

/**
 * The macro token under the cursor, or undefined. A cursor touching either
 * `%` counts. The word pattern of the language excludes `%`, so callers must
 * use this rather than the editor's word-at-position.
 */
export function macroAt(
  text: string,
  line: number,
  character: number
): MacroOccurrence | undefined {
  const lines = splitLines(text);
  if (line < 0 || line >= lines.length) {
    return undefined;
  }
  const code = stripComment(lines[line]);
  const def = DEFINITION_RE.exec(code);
  const re = new RegExp(MACRO_RE_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const startCol = m.index;
    const endCol = m.index + m[0].length;
    if (character >= startCol && character <= endCol) {
      // Role is only decided properly by scanMacros (it needs the section);
      // here a line-leading `%X% =` is reported as a definition candidate.
      const leading = def !== null && code.indexOf("%") === startCol;
      return {
        name: m[1],
        line,
        startCol,
        endCol,
        role: leading ? "definition" : "reference",
      };
    }
  }
  return undefined;
}

/** All occurrences of `name` in the document (definitions included). */
export function findMacroOccurrences(
  scan: MacroScan,
  name: string
): MacroOccurrence[] {
  return scan.occurrences.filter((o) => o.name === name);
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * (a) references to a macro no definition was found for — warning, or a hint
 *     when a definition differs only by case;
 * (b) `[VARIABLES]` macros never referenced — hint + `unnecessary`.
 *
 * Both are reported ONLY for a root script (one with `[TEST STEPS]` /
 * `[TEST DEFINITION]`) whose includes were all read: an include fragment gets
 * its macros from whoever includes it, and an unread include may define or
 * use anything. Macros passed in an `[INCLUDE]` block are never "unused".
 */
export function validateMacros(
  text: string,
  resolver: MacroResolver = {}
): MacroIssue[] {
  const model = buildMacroModel(text, resolver);
  const issues: MacroIssue[] = [];
  if (!model.local.isRootScript || model.unresolvedIncludes) {
    return issues;
  }

  const candidates = definedMacroNames(model);
  const defined = new Set(candidates);
  const definedLower = new Map<string, string>();
  for (const name of candidates) {
    if (!definedLower.has(name.toLowerCase())) {
      definedLower.set(name.toLowerCase(), name);
    }
  }
  const usedLower = new Set<string>();
  const collectUses = (scan: MacroScan): void => {
    for (const o of scan.occurrences) {
      if (o.role === "reference") {
        usedLower.add(o.name.toLowerCase());
      }
    }
  };
  collectUses(model.local);
  for (const inc of model.included) {
    collectUses(inc.scan);
  }

  for (const o of model.local.occurrences) {
    if (o.role === "definition") {
      continue;
    }
    if (
      defined.has(o.name) ||
      model.knownNames.has(o.name) ||
      ASSUMED_EXTERNAL_MACROS.has(o.name)
    ) {
      continue;
    }
    const caseTwin = definedLower.get(o.name.toLowerCase());
    issues.push({
      line: o.line,
      startCol: o.startCol,
      endCol: o.endCol,
      message: caseTwin
        ? `Macro %${o.name}% is not defined with this spelling; %${caseTwin}% is. ` +
          `(Whether TestPit treats macro names as case-sensitive is not known to this extension.)`
        : `Macro %${o.name}% is not defined in this script or in the files it includes.`,
      identifier: o.name,
      kind: "undefinedMacro",
      severity: caseTwin ? "hint" : "warning",
      fix: { candidates },
    });
  }

  for (const d of model.local.definitions) {
    if (d.scope !== "variables" || usedLower.has(d.name.toLowerCase())) {
      continue;
    }
    issues.push({
      line: d.line,
      startCol: d.startCol,
      endCol: d.endCol,
      message: `Variable %${d.name}% is defined but not used in this script or in the files it includes.`,
      identifier: d.name,
      kind: "unusedMacro",
      severity: "hint",
      unnecessary: true,
    });
  }

  issues.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
  return issues;
}

// ── Quick fixes ─────────────────────────────────────────────────────────

/**
 * undefinedMacro → "Change to %X%" for the closest defined names.
 * unusedMacro    → "Remove unused variable" (single-line definitions only).
 * Edits are in line/column terms, as in quickFixes.ts.
 */
export function computeMacroQuickFixes(
  text: string,
  issue: MacroIssue
): QuickFix[] {
  const lines = splitLines(text);
  if (issue.line < 0 || issue.line >= lines.length) {
    return [];
  }
  const line = lines[issue.line];
  if (line.slice(issue.startCol, issue.endCol) !== `%${issue.identifier}%`) {
    return []; // stale diagnostic
  }

  if (issue.kind === "undefinedMacro") {
    const names = suggest(
      issue.identifier,
      issue.fix?.candidates ?? [],
      MAX_NAME_SUGGESTIONS
    );
    return names.map((name, i) => ({
      title: `Change to '%${name}%'`,
      edits: [
        {
          line: issue.line,
          startCol: issue.startCol,
          endLine: issue.line,
          endCol: issue.endCol,
          newText: `%${name}%`,
        },
      ],
      preferred: i === 0,
    }));
  }

  // unusedMacro: only when the definition is the whole line and nothing hangs
  // off it (a more-indented following line may be a continued value).
  if (!DEFINITION_RE.test(stripComment(line))) {
    return [];
  }
  const next = lines[issue.line + 1];
  if (next !== undefined && next.trim() !== "" && !parseSectionTagLine(next)) {
    const indent = (s: string): number => s.length - s.trimStart().length;
    if (indent(next) > indent(line)) {
      return [];
    }
  }
  let edit: FixEdit;
  if (issue.line + 1 < lines.length) {
    edit = { line: issue.line, startCol: 0, endLine: issue.line + 1, endCol: 0, newText: "" };
  } else if (issue.line > 0) {
    edit = {
      line: issue.line - 1,
      startCol: lines[issue.line - 1].length,
      endLine: issue.line,
      endCol: line.length,
      newText: "",
    };
  } else {
    edit = { line: 0, startCol: 0, endLine: 0, endCol: line.length, newText: "" };
  }
  return [
    {
      title: `Remove unused variable '%${issue.identifier}%'`,
      edits: [edit],
      preferred: true,
      removesLine: issue.line,
    },
  ];
}

/** Re-find the issue a diagnostic (kind + range) stands for. */
export function findMacroIssue(
  issues: MacroIssue[],
  kind: string,
  line: number,
  startCol: number,
  endCol: number
): MacroIssue | undefined {
  return issues.find(
    (i) =>
      i.kind === kind &&
      i.line === line &&
      i.startCol === startCol &&
      i.endCol === endCol
  );
}

// ── Rename ──────────────────────────────────────────────────────────────

export type RenameTarget =
  | { ok: true; name: string; line: number; startCol: number; endCol: number }
  | { ok: false; reason: string };

/**
 * Can the macro under the cursor be renamed by editing THIS document only?
 * Refused when the rename would have to reach another file to stay correct:
 * the macro is not defined here, it is an `[INCLUDE]` argument (the included
 * file reads it under that name), or a file reached through an include uses or
 * defines the same name. On success the range is the NAME, without `%`.
 */
export function prepareMacroRename(
  text: string,
  line: number,
  character: number,
  resolver: MacroResolver = {}
): RenameTarget {
  const at = macroAt(text, line, character);
  if (!at) {
    return { ok: false, reason: "There is no %MACRO% here to rename." };
  }
  const model = buildMacroModel(text, resolver);
  const localDefs = model.local.definitions.filter((d) => d.name === at.name);
  if (localDefs.length === 0) {
    return {
      ok: false,
      reason: `%${at.name}% is not defined in this file, so it cannot be renamed from here.`,
    };
  }
  if (localDefs.some((d) => d.scope === "includeArgument")) {
    return {
      ok: false,
      reason: `%${at.name}% is passed to an included file in an [INCLUDE] block; renaming it here would not rename it there.`,
    };
  }
  const elsewhere = model.included.find((inc) =>
    inc.scan.occurrences.some((o) => o.name === at.name)
  );
  if (elsewhere) {
    return {
      ok: false,
      reason: `%${at.name}% also appears in an included file (${elsewhere.key}); renaming it here would not rename it there.`,
    };
  }
  return {
    ok: true,
    name: at.name,
    line: at.line,
    startCol: at.startCol + 1,
    endCol: at.endCol - 1,
  };
}

export type RenameResult =
  | { ok: true; edits: FixEdit[] }
  | { ok: false; reason: string };

/**
 * Rename the macro under the cursor: its definition(s) and every reference in
 * the document. `newName` may be given with or without the percent signs.
 */
export function computeMacroRename(
  text: string,
  line: number,
  character: number,
  newName: string,
  resolver: MacroResolver = {}
): RenameResult {
  const target = prepareMacroRename(text, line, character, resolver);
  if (!target.ok) {
    return target;
  }
  let name = newName.trim();
  if (name.length >= 2 && name.startsWith("%") && name.endsWith("%")) {
    name = name.slice(1, -1);
  }
  if (!isValidMacroName(name)) {
    return {
      ok: false,
      reason: `'${newName}' is not a valid macro name: use letters, digits and underscores only.`,
    };
  }
  const model = buildMacroModel(text, resolver);
  if (name !== target.name) {
    const taken =
      model.local.occurrences.some((o) => o.name === name) ||
      model.included.some((inc) => inc.scan.occurrences.some((o) => o.name === name));
    if (taken) {
      return {
        ok: false,
        reason: `%${name}% already exists; renaming to it would merge two macros.`,
      };
    }
  }
  const edits = findMacroOccurrences(model.local, target.name).map((o) => ({
    line: o.line,
    startCol: o.startCol + 1,
    endLine: o.line,
    endCol: o.endCol - 1,
    newText: name,
  }));
  return { ok: true, edits };
}

// ── Completion ──────────────────────────────────────────────────────────

export interface MacroCompletionEntry {
  name: string;
  /** Always `%NAME%`. */
  insertText: string;
  /** `%NAME%` — the replaced range starts at the opening `%`. */
  filterText: string;
  /** `= value`, or a note when definitions disagree. */
  detail: string;
  definitions: MacroDefinition[];
}

export interface MacroCompletions {
  /** Replace range on the cursor line: opening `%` … cursor or closing `%`. */
  startCol: number;
  endCol: number;
  entries: MacroCompletionEntry[];
}

/**
 * Completion after a `%`. Returns undefined when the cursor is not inside a
 * macro being typed (in a comment, no `%` before it, or right after the
 * CLOSING `%` of a complete macro).
 *
 * The range always starts at the opening `%` and the insert text is the full
 * `%NAME%`, so the result is the same whether or not a closing `%` exists. An
 * existing closing `%` is replaced only when it cannot be the opening `%` of a
 * following macro (the `%` left on the line after the cursor are odd in
 * number): `%TI|ME%` → replaced through the `%`; `%TI|%OTHER%` → only `%TI`.
 */
export function computeMacroCompletions(
  text: string,
  line: number,
  character: number,
  resolver: MacroResolver = {}
): MacroCompletions | undefined {
  const lines = splitLines(text);
  if (line < 0 || line >= lines.length) {
    return undefined;
  }
  const code = stripComment(lines[line]);
  if (character > code.length) {
    return undefined; // inside a comment
  }
  const before = code.slice(0, character);
  const tail = new RegExp(`%([${NAME_CHARS}]*)$`).exec(before);
  if (!tail) {
    return undefined;
  }
  const startCol = tail.index;
  // Is that `%` the closing one of a complete macro? Pair the `%` up from the
  // left the way the scanner does.
  const re = new RegExp(MACRO_RE_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    if (m.index + m[0].length - 1 === startCol) {
      return undefined;
    }
  }

  const after = code.slice(character);
  let endCol = character;
  const closing = new RegExp(`^[${NAME_CHARS}]*%`).exec(after);
  if (closing) {
    const percents = after.split("%").length - 1;
    if (percents % 2 === 1) {
      endCol = character + closing[0].length;
    }
  }

  const model = buildMacroModel(text, resolver);
  const entries: MacroCompletionEntry[] = [];
  for (const name of definedMacroNames(model)) {
    // The macro being typed on a definition line is not offered to itself.
    const definitions = findMacroDefinitions(model, name).filter(
      (d) => !(d.file === undefined && d.line === line && d.startCol === startCol)
    );
    if (definitions.length === 0) {
      continue;
    }
    const values = Array.from(new Set(definitions.map((d) => d.value)));
    entries.push({
      name,
      insertText: `%${name}%`,
      filterText: `%${name}%`,
      detail: values.length === 1 ? `= ${values[0]}` : `${values.length} different values`,
      definitions,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { startCol, endCol, entries };
}

// ── Hover / documentation text ──────────────────────────────────────────

function codeSpan(value: string): string {
  if (value === "") {
    return "_(empty)_";
  }
  return value.includes("`") ? `\`\` ${value} \`\`` : `\`${value}\``;
}

/** One markdown bullet per definition: value and where it is. */
export function describeMacroDefinitions(
  definitions: MacroDefinition[],
  fileLabel: (key: string) => string = (key) => key
): string {
  return definitions
    .map((d) => {
      const where =
        d.scope === "includeArgument"
          ? "passed to the included file in `[INCLUDE]`"
          : "defined in `[VARIABLES]`";
      const file = d.file === undefined ? "" : ` of included file \`${fileLabel(d.file)}\``;
      return `- ${codeSpan(d.value)} — ${where}${file}, line ${d.line + 1}`;
    })
    .join("\n");
}

/** Markdown for a hover on `%name%`. Plain string; the provider wraps it. */
export function renderMacroHover(
  model: MacroModel,
  name: string,
  fileLabel?: (key: string) => string
): string {
  const head = `**%${name}%** _(macro)_\n\n`;
  const definitions = findMacroDefinitions(model, name);
  if (definitions.length > 0) {
    return head + describeMacroDefinitions(definitions, fileLabel);
  }
  if (!model.local.isRootScript) {
    return (
      head +
      "Not defined in this file. This file has no `[TEST STEPS]` / `[TEST DEFINITION]`, " +
      "so it is probably included by another script, which may define it."
    );
  }
  if (model.unresolvedIncludes) {
    return (
      head +
      "Not defined in this file. An included file could not be read, so it may be defined there."
    );
  }
  if (ASSUMED_EXTERNAL_MACROS.has(name) || model.knownNames.has(name)) {
    return (
      head +
      "Not defined in this script or its includes. It is on the extension's list of names " +
      "assumed to be supplied from outside the script, so it is not reported."
    );
  }
  return head + "No definition found in this script or in the files it includes.";
}
