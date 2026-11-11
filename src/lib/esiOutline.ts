/**
 * Document outline + folding ranges for `.esi`, built from the section tags.
 *
 * Tag lines are classified ONLY by parseSectionTag.ts (the port of TestPit's
 * reader), so the one-liner `[NAME/]`, the sloppy forms TestPit repairs, and
 * `#` comments are treated exactly as the structural validator treats them:
 *   - a `#` line (or a tag after a `#`) is not a tag;
 *   - a name TestPit would reject outright (`invalid`) is skipped;
 *   - a one-liner is a leaf and never goes on the tag stack.
 *
 * Both entry points are total: any text (unclosed tags, stray or mismatched
 * closers, CRLF, empty input) yields a well-formed result — `endLine` is never
 * before `startLine`, children lie inside their parent, and the selection
 * span lies inside the node's own range.
 *
 * Kept vscode-free so it can be unit-tested directly.
 */
import { parseSectionTagLine } from "./parseSectionTag";
import {
  isStepSectionName,
  SEC_INCLUDE,
  SEC_STEP_DEFINITION,
  SEC_STEP_INPUTS,
  SEC_STEP_OUTPUTS,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
  SEC_VARIABLES,
} from "./sectionNames";
import { COMPONENT_TAG_PATTERN } from "./xmlIndex";

/** What a node is, so the provider can pick a distinct symbol kind/icon. */
export type OutlineKind =
  | "testSteps" // [TEST STEPS] — the root that holds the steps
  | "step" // [STEP <id>]
  | "stepIO" // [STEP INPUTS] / [STEP OUTPUTS]
  | "definition" // [TEST DEFINITION] / [STEP DEFINITION]
  | "variables" // [VARIABLES]
  | "include" // [INCLUDE]
  | "component" // bus-prefixed message block ([429_…], [DIS_…], [PART_…_…], …)
  | "section"; // anything else ([TIMELIMIT], [MANUAL_VERIFY], [STEP DUMP/], …)

export interface OutlineNode {
  /** Tag name as TestPit reads it (normalized, trimmed, never empty). */
  name: string;
  kind: OutlineKind;
  /** Short extra text: a step's description, an include's file, … or "". */
  detail: string;
  /** Line of the opening tag (0-based). */
  startLine: number;
  /** Last line of the block (the closing tag when there is one); >= startLine. */
  endLine: number;
  /** Length of `endLine`'s text — the end column of the full range. */
  endCol: number;
  /** Line the name sits on; always `startLine`. */
  selectionLine: number;
  /** Columns of the opening tag (`[` … just past `]`) on `selectionLine`. */
  selectionStartCol: number;
  selectionEndCol: number;
  /** True for the one-liner form `[NAME/]`. */
  oneLiner: boolean;
  /** True when the block was ended by its own `[/NAME]` (or is a one-liner). */
  closed: boolean;
  children: OutlineNode[];
}

export type EsiFoldingKind = "comment" | "region";

export interface EsiFoldingRange {
  /** First line of the fold (stays visible when collapsed). */
  startLine: number;
  /** Last line hidden by the fold; always > startLine. */
  endLine: number;
  /** "comment" for `#` runs; undefined for sections and `<pre>` bodies. */
  kind?: EsiFoldingKind;
}

const STEP_IO_SECTIONS: ReadonlySet<string> = new Set([
  SEC_STEP_INPUTS,
  SEC_STEP_OUTPUTS,
]);

const COMMENT_CHARACTER = "#";
const ASSIGNMENT_RE = /^\s*([^=]*?)\s*=\s*(.*)$/;
const PRE_OPEN_ONLY = /^<pre\b[^>]*>$/i;
const MARKUP_TAG = /<[^>]*>/g;
const DETAIL_MAX = 120;

// `<pre>` line roles — same rules formatEsi.ts uses for its block tracking.
const PRE_OPEN_TAG = /<pre\b[^>]*>/i;
const PRE_CLOSE_TAG = /<\/pre>/i;
const PRE_CLOSER_AT_END = /<\/pre>\s*(?:#.*)?$/i;

/** Classify a (normalized, valid) tag name. */
export function outlineKindOf(name: string): OutlineKind {
  if (name === SEC_TEST_STEPS) {
    return "testSteps";
  }
  if (name === SEC_VARIABLES) {
    return "variables";
  }
  if (name === SEC_INCLUDE) {
    return "include";
  }
  if (name === SEC_TEST_DEFINITION || name === SEC_STEP_DEFINITION) {
    return "definition";
  }
  if (STEP_IO_SECTIONS.has(name)) {
    return "stepIO";
  }
  if (isStepSectionName(name)) {
    return "step";
  }
  if (COMPONENT_TAG_PATTERN.test(name)) {
    return "component";
  }
  return "section";
}

function stripComment(line: string): string {
  return line.split(COMMENT_CHARACTER)[0];
}

function cleanDetail(value: string): string {
  const text = value.replace(MARKUP_TAG, " ").replace(/\s+/g, " ").trim();
  return text.length > DETAIL_MAX ? text.slice(0, DETAIL_MAX - 1) + "…" : text;
}

/**
 * Which node (if any) a `key = value` line directly inside `top` describes:
 *   [STEP DEFINITION] `Step Description` → the enclosing step
 *   [TEST DEFINITION] `Test Description` → the definition itself
 *   [INCLUDE]         `include file`     → the include itself
 */
function detailTarget(
  top: OutlineNode,
  parent: OutlineNode | undefined,
  key: string
): OutlineNode | undefined {
  const k = key.toLowerCase().replace(/\s+/g, " ");
  if (top.name === SEC_STEP_DEFINITION && k === "step description") {
    return parent && parent.kind === "step" ? parent : undefined;
  }
  if (top.name === SEC_TEST_DEFINITION && k === "test description") {
    return top;
  }
  if (top.kind === "include" && k === "include file") {
    return top;
  }
  return undefined;
}

/**
 * Build the section tree of a `.esi` document.
 *
 * Recovery rules (mirroring validateStructure's stack walk):
 *   - a closer matches the NEAREST open section of that name; sections opened
 *     after it were never closed and end on the last content line before it;
 *   - a closer with no open section of that name is ignored;
 *   - sections still open at end of file run to the last non-blank line.
 */
export function buildOutline(text: string): OutlineNode[] {
  const lines = text.split(/\r?\n/);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  // Last line at or before `from` that is not blank, but never before `min`.
  const lastContentLine = (from: number, min: number): number => {
    let i = Math.min(from, lines.length - 1);
    while (i > min && lines[i].trim() === "") {
      i--;
    }
    return Math.max(i, min);
  };
  const finish = (node: OutlineNode, endLine: number, closed: boolean): void => {
    node.endLine = Math.max(endLine, node.startLine);
    node.endCol = lines[node.endLine].length;
    node.closed = closed;
  };
  // End a never-closed node: no later than `limit`, trailing blanks trimmed,
  // but always covering its own children.
  const finishUnclosed = (node: OutlineNode, limit: number): void => {
    const last = node.children[node.children.length - 1];
    const min = last ? Math.max(last.endLine, node.startLine) : node.startLine;
    finish(node, lastContentLine(limit, min), false);
  };

  // A node whose detail is a `key = <pre>` waiting for its first body line.
  let pendingDetail: OutlineNode | undefined;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum];
    const tag = parseSectionTagLine(raw);

    if (!tag) {
      const code = stripComment(raw).trim();
      if (code === "") {
        continue;
      }
      if (pendingDetail) {
        if (PRE_CLOSE_TAG.test(code) && cleanDetail(code) === "") {
          pendingDetail = undefined; // empty <pre></pre> body
          continue;
        }
        const d = cleanDetail(code);
        if (d !== "") {
          pendingDetail.detail = d;
          pendingDetail = undefined;
        }
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top) {
        continue;
      }
      const m = ASSIGNMENT_RE.exec(code);
      if (!m) {
        continue;
      }
      const target = detailTarget(top, stack[stack.length - 2], m[1]);
      if (!target || target.detail !== "") {
        continue;
      }
      const value = m[2].trim();
      if (PRE_OPEN_ONLY.test(value)) {
        pendingDetail = target;
      } else {
        target.detail = cleanDetail(value);
      }
      continue;
    }

    // Any tag line ends a pending `<pre>` description lookup.
    pendingDetail = undefined;
    if (tag.invalid) {
      continue; // TestPit rejects the name; don't guess (validator does the same)
    }

    if (tag.kind === "close") {
      let matchIdx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === tag.name) {
          matchIdx = i;
          break;
        }
      }
      if (matchIdx === -1) {
        continue; // stray closer
      }
      for (let i = stack.length - 1; i > matchIdx; i--) {
        finishUnclosed(stack[i], lineNum - 1);
      }
      finish(stack[matchIdx], lineNum, true);
      stack.length = matchIdx;
      continue;
    }

    const node: OutlineNode = {
      name: tag.name,
      kind: outlineKindOf(tag.name),
      detail: "",
      startLine: lineNum,
      endLine: lineNum,
      endCol: raw.length,
      selectionLine: lineNum,
      selectionStartCol: Math.max(0, Math.min(tag.startCol, raw.length)),
      selectionEndCol: Math.max(0, Math.min(tag.endCol, raw.length)),
      oneLiner: tag.kind === "oneLiner",
      closed: tag.kind === "oneLiner",
      children: [],
    };
    if (node.selectionEndCol < node.selectionStartCol) {
      node.selectionEndCol = node.selectionStartCol;
    }
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    if (tag.kind === "open") {
      stack.push(node);
    }
  }

  // Still open at EOF: innermost first, so parents see final child ranges.
  for (let i = stack.length - 1; i >= 0; i--) {
    finishUnclosed(stack[i], lines.length - 1);
  }
  return roots;
}

function classifyPreLine(line: string): { opens: boolean; closes: boolean } {
  const open = PRE_OPEN_TAG.exec(line);
  if (open) {
    const rest = line.slice(open.index + open[0].length);
    return { opens: !PRE_CLOSE_TAG.test(rest), closes: false };
  }
  return { opens: false, closes: PRE_CLOSER_AT_END.test(line) };
}

/**
 * Folding ranges: every multi-line section, every multi-line `<pre>…</pre>`
 * body, and every run of two or more consecutive `#` comment lines.
 *
 * A fold hides lines `startLine+1 … endLine`. For a section closed by its own
 * `[/NAME]` and for `<pre>` blocks the fold stops one line short, so the
 * closing tag stays visible under the collapsed header.
 */
export function foldingRanges(text: string): EsiFoldingRange[] {
  const lines = text.split(/\r?\n/);
  const out: EsiFoldingRange[] = [];

  const addSections = (nodes: OutlineNode[]): void => {
    for (const n of nodes) {
      const end = n.closed ? n.endLine - 1 : n.endLine;
      if (end > n.startLine) {
        out.push({ startLine: n.startLine, endLine: end });
      }
      addSections(n.children);
    }
  };
  addSections(buildOutline(text));

  const preStack: number[] = [];
  let commentStart = -1;
  const flushComments = (endExclusive: number): void => {
    if (commentStart !== -1 && endExclusive - 1 > commentStart) {
      out.push({
        startLine: commentStart,
        endLine: endExclusive - 1,
        kind: "comment",
      });
    }
    commentStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(COMMENT_CHARACTER)) {
      if (commentStart === -1) {
        commentStart = i;
      }
      continue;
    }
    flushComments(i);
    if (s === "") {
      continue;
    }
    const { opens, closes } = classifyPreLine(s);
    if (opens) {
      preStack.push(i);
    } else if (closes) {
      const start = preStack.pop();
      if (start !== undefined && i - 1 > start) {
        out.push({ startLine: start, endLine: i - 1 });
      }
    }
  }
  flushComments(lines.length);

  out.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  return out;
}
