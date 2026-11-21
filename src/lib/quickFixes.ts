/**
 * Quick fixes for the in-process ("esi Helper") diagnostics. vscode-free:
 * text + issue in, plain edits out — see providers/codeActions.ts for the
 * CodeAction wiring.
 *
 * Rules every fix here obeys:
 *   - an edit never touches a line other than the one(s) it is about, and is
 *     expressed in line/column terms so it is identical on LF and CRLF text
 *     (a removed line takes its own line break with it, whichever kind it is);
 *   - no fix is offered for a value holding a `%macro%` — it only resolves at
 *     run time, so there is nothing here to judge it against;
 *   - section tags are read through parseSectionTag.ts only, and a one-liner
 *     `[NAME/]` never gets a closing tag.
 */
import {
  ASSIGNMENT_RE,
  ComponentIssue,
  IssueKind,
  MATCH_FIELD,
  MATCH_VALUES,
  PARAMETER_FIELDS,
  validateComponents,
  validateStructure,
} from "./componentValidator";
import { parseSectionTagLine } from "./parseSectionTag";
import { isKnownSectionName } from "./sectionNames";
import { rankSuggestions, suggest } from "./suggest";
import { VORILS_UNIT_PREFIX, XmlIndex } from "./xmlIndex";

export interface FixEdit {
  line: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
}

export interface QuickFix {
  title: string;
  edits: FixEdit[];
  /** The one fix VS Code may apply for "Auto Fix" / Ctrl+. Enter. */
  preferred: boolean;
  /** Set when the fix deletes a whole line (lets fix-all merge adjacent ones). */
  removesLine?: number;
}

export interface FixContext {
  text: string;
  lines: string[];
  /** Line break used for INSERTED lines; existing ones are never rewritten. */
  eol: string;
  index?: XmlIndex;
  structureIssues: ComponentIssue[];
  /** Structural + component issues, as the diagnostics pass reports them. */
  issues: ComponentIssue[];
}

/** Kinds whose fix is a single unambiguous edit, so "fix all" is safe. */
const FIX_ALL_LABELS: Partial<Record<IssueKind, string>> = {
  duplicateKey: "duplicate key",
  outputFieldInInput: "output-only field",
  valueOutOfRange: "out-of-range value",
};

const MAX_NAME_SUGGESTIONS = 3;
const TAB_WIDTH = 4;

/**
 * Analyse a document once per request. CSV-sourced issues are not reproduced
 * here (no CsvLookup) — none of them has a fix.
 */
export function createFixContext(text: string, index?: XmlIndex): FixContext {
  const structureIssues = validateStructure(text);
  const issues = index
    ? structureIssues.concat(validateComponents(text, index))
    : structureIssues;
  return {
    text,
    lines: text.split(/\r?\n/),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    index,
    structureIssues,
    issues,
  };
}

/** The issues a diagnostic (code + range) stands for. */
export function findIssues(
  ctx: FixContext,
  kind: string,
  line: number,
  startCol: number,
  endCol: number
): ComponentIssue[] {
  return ctx.issues.filter(
    (i) =>
      i.kind === kind &&
      i.line === line &&
      i.startCol === startCol &&
      i.endCol === endCol
  );
}

export function computeQuickFixes(
  ctx: FixContext,
  issue: ComponentIssue
): QuickFix[] {
  if (issue.line < 0 || issue.line >= ctx.lines.length) {
    return [];
  }
  switch (issue.kind) {
    case "unknownConnection":
      return fixUnknownConnection(ctx, issue);
    case "unknownField":
      return fixUnknownField(ctx, issue);
    case "unknownEnum":
      return fixUnknownEnum(ctx, issue);
    case "valueOutOfRange":
      return fixValueOutOfRange(ctx, issue);
    case "invalidParameterValue":
      return fixParameterValue(ctx, issue);
    case "duplicateKey":
      return fixRemoveLine(ctx, issue, `Remove duplicate '${issue.identifier}' line`);
    case "outputFieldInInput":
      return fixRemoveLine(ctx, issue, `Remove '${issue.identifier}' line`);
    case "unbalancedTag":
      return fixUnbalancedTag(ctx, issue);
    default:
      return [];
  }
}

/**
 * "Fix all <kind> problems in this file" — every issue's preferred edit in one
 * go. Only for kinds with a single unambiguous fix, and only when at least two
 * issues can actually be fixed. Overlapping edits are dropped, not merged.
 */
export function computeFixAll(
  ctx: FixContext,
  kind: string
): QuickFix | undefined {
  const label = FIX_ALL_LABELS[kind as IssueKind];
  if (!label) {
    return undefined;
  }
  const removed = new Set<number>();
  const edits: FixEdit[] = [];
  let fixed = 0;
  for (const issue of ctx.issues) {
    if (issue.kind !== kind) {
      continue;
    }
    const fix = computeQuickFixes(ctx, issue).find((f) => f.preferred);
    if (!fix) {
      continue;
    }
    fixed += 1;
    if (fix.removesLine !== undefined) {
      removed.add(fix.removesLine);
    } else {
      edits.push(...fix.edits);
    }
  }
  if (fixed < 2) {
    return undefined;
  }
  const all = dropOverlaps(edits.concat(removeLinesEdits(ctx.lines, removed)));
  return {
    title: `Fix all ${label} problems in this file`,
    edits: all,
    preferred: false,
  };
}

/** Apply edits to text. Line breaks outside the edited ranges are untouched. */
export function applyEdits(text: string, edits: FixEdit[]): string {
  const starts = [0];
  const breakRe = /\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = breakRe.exec(text)) !== null) {
    starts.push(m.index + m[0].length);
  }
  const resolved = edits
    .map((e) => ({
      from: starts[e.line] + e.startCol,
      to: starts[e.endLine] + e.endCol,
      newText: e.newText,
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  for (const e of resolved) {
    out = out.slice(0, e.from) + e.newText + out.slice(e.to);
  }
  return out;
}

// ---------------------------------------------------------------- helpers ---

function replaceOnLine(
  line: number,
  startCol: number,
  endCol: number,
  newText: string
): FixEdit {
  return { line, startCol, endLine: line, endCol, newText };
}

function comparePos(l1: number, c1: number, l2: number, c2: number): number {
  return l1 - l2 || c1 - c2;
}

function dropOverlaps(edits: FixEdit[]): FixEdit[] {
  const sorted = edits
    .slice()
    .sort((a, b) => comparePos(a.line, a.startCol, b.line, b.startCol));
  const out: FixEdit[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && comparePos(e.line, e.startCol, last.endLine, last.endCol) < 0) {
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * Delete whole lines, each with exactly one line break: its own when a line
 * follows, otherwise the one before it (the last line has none of its own).
 */
function removeLinesEdits(lines: string[], remove: Set<number>): FixEdit[] {
  const sorted = [...remove]
    .filter((l) => l >= 0 && l < lines.length)
    .sort((a, b) => a - b);
  const edits: FixEdit[] = [];
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i];
    let last = first;
    while (i + 1 < sorted.length && sorted[i + 1] === last + 1) {
      i += 1;
      last = sorted[i];
    }
    i += 1;
    if (last + 1 < lines.length) {
      edits.push({ line: first, startCol: 0, endLine: last + 1, endCol: 0, newText: "" });
    } else if (first > 0) {
      edits.push({
        line: first - 1,
        startCol: lines[first - 1].length,
        endLine: last,
        endCol: lines[last].length,
        newText: "",
      });
    } else {
      edits.push({ line: 0, startCol: 0, endLine: last, endCol: lines[last].length, newText: "" });
    }
  }
  return edits;
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#");
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

function indentWidth(line: string): number {
  let w = 0;
  for (const ch of leadingWhitespace(line)) {
    w += ch === "\t" ? TAB_WIDTH : 1;
  }
  return w;
}

/** The value part of a `key = value` line, comment stripped; undefined if not one. */
function assignmentValue(line: string): string | undefined {
  const a = ASSIGNMENT_RE.exec(line);
  return a ? a[3].split("#")[0].trim() : undefined;
}

function valueHasMacro(line: string): boolean {
  return (assignmentValue(line) ?? "").includes("%");
}

/**
 * False when the assignment's value runs on past its own line (an open
 * `<pre>` body or a hanging continuation) — removing just the key line would
 * orphan the rest.
 */
function isSingleLineAssignment(lines: string[], line: number): boolean {
  const raw = lines[line];
  if (/<pre\b/i.test(raw) && !/<\/pre>/i.test(raw)) {
    return false;
  }
  const next = lines[line + 1];
  if (
    next !== undefined &&
    !isBlankOrComment(next) &&
    !parseSectionTagLine(next) &&
    !ASSIGNMENT_RE.test(next) &&
    indentWidth(next) > indentWidth(raw)
  ) {
    return false;
  }
  return true;
}

function textAt(ctx: FixContext, issue: ComponentIssue): string {
  return ctx.lines[issue.line].slice(issue.startCol, issue.endCol);
}

function changeTo(name: string): string {
  return `Change to '${name}'`;
}

// ---------------------------------------------------------- name repairs ---

/**
 * The `[/NAME]` line closing the block opened on `openLine`, or undefined —
 * always undefined for a one-liner `[NAME/]`, which has no closer to rename.
 */
function findClosingTag(
  lines: string[],
  openLine: number,
  name: string
): { line: number; nameCol: number } | undefined {
  const opener = parseSectionTagLine(lines[openLine]);
  if (!opener || opener.invalid || opener.kind !== "open" || opener.name !== name) {
    return undefined;
  }
  let depth = 0;
  for (let l = openLine + 1; l < lines.length; l++) {
    const tag = parseSectionTagLine(lines[l]);
    if (!tag || tag.invalid || tag.name !== name) {
      continue;
    }
    if (tag.kind === "open") {
      depth += 1;
    } else if (tag.kind === "close") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const nameCol = lines[l].indexOf(name, tag.startCol);
      if (nameCol === -1 || nameCol + name.length > tag.endCol) {
        return undefined;
      }
      return { line: l, nameCol };
    }
  }
  return undefined;
}

function fixUnknownConnection(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const name = issue.identifier;
  if (!ctx.index || textAt(ctx, issue) !== name) {
    return [];
  }
  // Only VORILS1_ is registered; a script's VORILS<N>_ resolves to the same
  // message, so offer those candidates under the unit number actually typed.
  const unit = /^VORILS\d+_/.exec(name)?.[0];
  const candidates: string[] = [];
  for (const key of ctx.index.connections.keys()) {
    const m = unit ? VORILS_UNIT_PREFIX.exec(key) : null;
    candidates.push(m && unit ? unit + m[1] : key);
  }
  const closer = findClosingTag(ctx.lines, issue.line, name);
  return suggest(name, candidates, MAX_NAME_SUGGESTIONS).map((s, i) => {
    const edits = [replaceOnLine(issue.line, issue.startCol, issue.endCol, s)];
    if (closer) {
      edits.push(
        replaceOnLine(closer.line, closer.nameCol, closer.nameCol + name.length, s)
      );
    }
    return { title: changeTo(s), edits, preferred: i === 0 };
  });
}

/** Keys already assigned in the block around `line` (between its nearest tags). */
function keysInBlock(lines: string[], line: number): Set<string> {
  const keys = new Set<string>();
  const collect = (from: number, step: number): void => {
    for (let l = from; l >= 0 && l < lines.length; l += step) {
      if (parseSectionTagLine(lines[l])) {
        return;
      }
      const a = ASSIGNMENT_RE.exec(lines[l]);
      if (a) {
        keys.add(a[2]);
      }
    }
  };
  collect(line - 1, -1);
  collect(line + 1, 1);
  return keys;
}

function fixUnknownField(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const name = issue.identifier;
  const fields = issue.fix?.messageFields;
  if (!fields || textAt(ctx, issue) !== name) {
    return [];
  }
  // A name the block already assigns would only trade this warning for a
  // duplicate-key error.
  const taken = keysInBlock(ctx.lines, issue.line);
  const candidates = fields
    .map((f) => f.name)
    .concat([...PARAMETER_FIELDS])
    .filter((c) => !taken.has(c));
  return suggest(name, candidates, MAX_NAME_SUGGESTIONS).map((s, i) => ({
    title: changeTo(s),
    edits: [replaceOnLine(issue.line, issue.startCol, issue.endCol, s)],
    preferred: i === 0,
  }));
}

// --------------------------------------------------------- value repairs ---

function fixUnknownEnum(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const enums = issue.fix?.field?.enums;
  // A CSV-sourced value lives in the spreadsheet: the range is the whole
  // `file.csv line:N col:M` reference, and overwriting that with a literal
  // would silently drop the data-driven input.
  if (!enums || enums.length === 0 || issue.fix?.fromCsv) {
    return [];
  }
  if (valueHasMacro(ctx.lines[issue.line]) || textAt(ctx, issue) !== issue.identifier) {
    return [];
  }
  const names = enums.map((e) => e.name);
  const ranked = rankSuggestions(issue.identifier, names, names.length);
  const distance = new Map(ranked.map((r) => [r.name, r.distance]));
  const best = ranked[0]?.name;
  // Close names first (nearest first); the rest keep their table order.
  const ordered = enums
    .map((e, i) => ({ e, i, d: distance.get(e.name) ?? Infinity }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const seen = new Set<string>();
  const fixes: QuickFix[] = [];
  for (const { e } of ordered) {
    if (seen.has(e.name)) {
      continue;
    }
    seen.add(e.name);
    fixes.push({
      title: `Replace with '${e.name}' (= ${e.value})`,
      edits: [replaceOnLine(issue.line, issue.startCol, issue.endCol, e.name)],
      preferred: e.name === best,
    });
  }
  return fixes;
}

function fixValueOutOfRange(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const min = issue.fix?.min;
  const max = issue.fix?.max;
  if (min === undefined || max === undefined) {
    return [];
  }
  if (valueHasMacro(ctx.lines[issue.line])) {
    return [];
  }
  const value = Number(textAt(ctx, issue));
  if (!isFinite(value)) {
    return [];
  }
  let bound: number;
  let which: string;
  if (value < min) {
    bound = min;
    which = "minimum";
  } else if (value > max) {
    bound = max;
    which = "maximum";
  } else {
    return [];
  }
  return [
    {
      title: `Set to ${which} (${bound})`,
      edits: [replaceOnLine(issue.line, issue.startCol, issue.endCol, String(bound))],
      preferred: true,
    },
  ];
}

function fixParameterValue(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const raw = ctx.lines[issue.line];
  const value = assignmentValue(raw);
  if (value === undefined || value.includes("%")) {
    return [];
  }
  // An empty value has a one-column placeholder range; insert rather than
  // overwrite whatever happens to sit in that column.
  const empty = value.length === 0;
  if (!empty && textAt(ctx, issue) !== value) {
    return [];
  }
  const edit = (text: string): FixEdit =>
    empty
      ? replaceOnLine(issue.line, issue.startCol, issue.startCol, ` ${text}`)
      : replaceOnLine(issue.line, issue.startCol, issue.endCol, text);

  if (issue.identifier === MATCH_FIELD) {
    const best =
      MATCH_VALUES.find((v) => v.toLowerCase() === value.toLowerCase()) ??
      suggest(value, MATCH_VALUES, 1)[0];
    // `next` (the engine default) leads unless the typed value points at `any`.
    const ordered = MATCH_VALUES.slice().sort(
      (a, b) =>
        Number(b === best) - Number(a === best) ||
        Number(b === "next") - Number(a === "next")
    );
    return ordered.map((v) => ({
      title: changeTo(v),
      edits: [edit(v)],
      preferred: v === best,
    }));
  }
  // occurrence: the only repair that cannot be a guess is the keyword's case.
  if (!empty && value !== "ALL" && value.toUpperCase() === "ALL") {
    return [{ title: changeTo("ALL"), edits: [edit("ALL")], preferred: true }];
  }
  return [];
}

function fixRemoveLine(
  ctx: FixContext,
  issue: ComponentIssue,
  title: string
): QuickFix[] {
  const raw = ctx.lines[issue.line];
  if (valueHasMacro(raw) || !isSingleLineAssignment(ctx.lines, issue.line)) {
    return [];
  }
  return [
    {
      title,
      edits: removeLinesEdits(ctx.lines, new Set([issue.line])),
      preferred: true,
      removesLine: issue.line,
    },
  ];
}

// -------------------------------------------------------- unbalanced tags ---

function issueKey(i: ComponentIssue): string {
  return `${i.kind}|${i.identifier}`;
}

/**
 * Does applying `edits` clear `issue` without surfacing a structural problem
 * that was not already there? Compared by kind + name, since lines shift.
 */
function resolvesStructure(
  ctx: FixContext,
  issue: ComponentIssue,
  edits: FixEdit[]
): boolean {
  const budget = new Map<string, number>();
  for (const i of ctx.structureIssues) {
    budget.set(issueKey(i), (budget.get(issueKey(i)) ?? 0) + 1);
  }
  budget.set(issueKey(issue), (budget.get(issueKey(issue)) ?? 0) - 1);
  for (const i of validateStructure(applyEdits(ctx.text, edits))) {
    const left = (budget.get(issueKey(i)) ?? 0) - 1;
    if (left < 0) {
      return false;
    }
    budget.set(issueKey(i), left);
  }
  return true;
}

function fixUnbalancedTag(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const tag = parseSectionTagLine(ctx.lines[issue.line]);
  if (!tag || tag.invalid || tag.name !== issue.identifier) {
    return [];
  }
  if (issue.fix?.unbalanced === "orphanClose" && tag.kind === "close") {
    return fixOrphanClose(ctx, issue);
  }
  // `open` only: a one-liner is complete as written and never gets a closer.
  if (issue.fix?.unbalanced === "unclosed" && tag.kind === "open") {
    return fixUnclosed(ctx, issue);
  }
  return [];
}

/** A closer naming nothing that is open: most likely a misspelt/miscopied name. */
function fixOrphanClose(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const open = issue.fix?.openSections ?? [];
  if (open.length === 0) {
    return [];
  }
  // The closer spells a reserved section name and the innermost open section
  // is a near miss of it: the OPENER is the typo. Rewriting the closer to match
  // would turn a real section into an unknown one, so that is never offered.
  if (
    isKnownSectionName(issue.identifier) &&
    !isKnownSectionName(open[0]) &&
    suggest(issue.identifier, [open[0]], 1).length > 0
  ) {
    return fixMisspeltOpener(ctx, issue, open[0]);
  }
  const candidates = suggest(issue.identifier, open, MAX_NAME_SUGGESTIONS);
  if (!candidates.includes(open[0])) {
    candidates.push(open[0]); // the innermost open section is what is due next
  }
  for (const name of candidates) {
    const edits = [
      replaceOnLine(issue.line, issue.startCol, issue.endCol, `[/${name}]`),
    ];
    if (resolvesStructure(ctx, issue, edits)) {
      return [{ title: changeTo(`[/${name}]`), edits, preferred: true }];
    }
  }
  return [];
}

/** Rename the innermost open `[typo]` to the (correctly spelt) closer's name. */
function fixMisspeltOpener(
  ctx: FixContext,
  issue: ComponentIssue,
  typo: string
): QuickFix[] {
  for (let l = issue.line - 1; l >= 0; l--) {
    const t = parseSectionTagLine(ctx.lines[l]);
    if (!t || t.invalid || t.kind !== "open" || t.name !== typo) {
      continue;
    }
    const opener = `[${issue.identifier}]`;
    const edits = [replaceOnLine(l, t.startCol, t.endCol, opener)];
    return resolvesStructure(ctx, issue, edits)
      ? [{ title: `Change opening tag to '${opener}'`, edits, preferred: true }]
      : [];
  }
  return [];
}

/**
 * Lines in [from, to) that belong to a multi-line `<pre>` body, its `</pre>`
 * line included. Their text is preformatted prose: neither its indentation
 * nor a tag-looking line in it says anything about the section structure.
 */
function preBodyLines(lines: string[], from: number, to: number): Set<number> {
  const body = new Set<number>();
  let inPre = false;
  for (let l = from; l < to; l++) {
    const raw = lines[l];
    if (inPre) {
      body.add(l);
      inPre = !/<\/pre>/i.test(raw);
    } else if (
      !raw.trim().startsWith("#") &&
      /<pre\b/i.test(raw) &&
      !/<\/pre>/i.test(raw)
    ) {
      inPre = true;
    }
  }
  return body;
}

/**
 * Where the unclosed block opened on `openLine` ends: the index of the first
 * line that is no longer part of it (at most `bound`).
 */
function blockEnd(
  lines: string[],
  openLine: number,
  bound: number,
  isMessage: boolean
): number {
  const openIndent = indentWidth(lines[openLine]);
  let first = openLine + 1;
  while (first < bound && isBlankOrComment(lines[first])) {
    first += 1;
  }
  if (first >= bound) {
    return bound;
  }
  const inPre = preBodyLines(lines, first, bound);
  if (indentWidth(lines[first]) > openIndent) {
    // Indented body: it ends at the first line back at the opener's level.
    for (let l = first; l < bound; l++) {
      if (inPre.has(l)) {
        continue;
      }
      if (!isBlankOrComment(lines[l]) && indentWidth(lines[l]) <= openIndent) {
        return l;
      }
    }
    return bound;
  }
  // Flat file — indentation says nothing. A message block holds only fields,
  // so it ends at the next tag; a container runs to the closer that exposed it.
  if (isMessage) {
    for (let l = first; l < bound; l++) {
      const t = inPre.has(l) ? undefined : parseSectionTagLine(lines[l]);
      if (t && !t.invalid) {
        return l;
      }
    }
  }
  return bound;
}

function fixUnclosed(ctx: FixContext, issue: ComponentIssue): QuickFix[] {
  const { lines } = ctx;
  const name = issue.identifier;
  const bound = Math.min(issue.fix?.closerLine ?? lines.length, lines.length);
  if (bound <= issue.line) {
    return [];
  }
  // A block that directly holds `key = value` lines is a message block.
  let isMessage = false;
  for (let l = issue.line + 1; l < bound; l++) {
    if (isBlankOrComment(lines[l])) {
      continue;
    }
    isMessage = !parseSectionTagLine(lines[l]) && ASSIGNMENT_RE.test(lines[l]);
    break;
  }
  const closer = `${leadingWhitespace(lines[issue.line])}[/${name}]`;
  const tried = new Set<number>();
  for (const end of [blockEnd(lines, issue.line, bound, isMessage), bound]) {
    // Sit directly under the block's last line, above any blank lines.
    let after = end - 1;
    while (after > issue.line && lines[after].trim() === "") {
      after -= 1;
    }
    if (tried.has(after)) {
      continue;
    }
    tried.add(after);
    const col = lines[after].length;
    const edits = [replaceOnLine(after, col, col, ctx.eol + closer)];
    if (resolvesStructure(ctx, issue, edits)) {
      return [{ title: `Add missing '[/${name}]'`, edits, preferred: true }];
    }
  }
  return [];
}
