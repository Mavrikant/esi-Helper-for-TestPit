/**
 * Decision logic for section-tag completion: what to offer after `[` and
 * `[/`, which span of the line an accepted item replaces, and the text it
 * inserts. vscode-free so it is unit-tested directly; the provider
 * (providers/completion.ts) only maps the result onto CompletionItems.
 *
 * Tag lines are classified by parseSectionTag.ts and nowhere else — a
 * one-liner `[NAME/]` therefore never lands on a stack here.
 */
import { parseSectionTagLine } from "./parseSectionTag";
import {
  isStepSectionName,
  SEC_EXTERNAL_VERIFY,
  SEC_INCLUDE,
  SEC_MANUAL_VERIFY,
  SEC_STEP_DEFINITION,
  SEC_STEP_DUMP,
  SEC_STEP_INPUTS,
  SEC_STEP_OUTPUTS,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
  SEC_VARIABLES,
} from "./sectionNames";

/** One level of indentation, as formatEsi.ts writes it. */
const INDENT = "    ";


/** Where the cursor sits in the section tree (its innermost open section). */
export type TagPosition =
  | "root" // outside every section
  | "testSteps" // directly inside [TEST STEPS]
  | "step" // directly inside a [STEP <id>]
  | "stepInputs"
  | "stepOutputs"
  | "include"
  | "other"; // inside a message block or a section not known here

interface StructuralSection {
  /** Label and filter text; also the tag name unless `nameSnippet` is set. */
  name: string;
  detail: string;
  /** Positions this section belongs in — it is ranked first there. */
  validIn: readonly TagPosition[];
  /** Snippet form of the name, for a name that needs filling in. */
  nameSnippet?: string;
  /** Written as `[NAME/]`: opens and closes on one line, no closing tag. */
  oneLiner?: boolean;
}

const COMMAND_POSITIONS: readonly TagPosition[] = [
  "root",
  "step",
  "stepInputs",
  "include",
];

/**
 * The structural (non-component) section names, in the order a script
 * usually has them.
 */
export const STRUCTURAL_SECTIONS: readonly StructuralSection[] = [
  { name: SEC_VARIABLES, detail: "Constant macros for this file", validIn: ["root"] },
  { name: SEC_TEST_DEFINITION, detail: "Test description, used in the report", validIn: ["root"] },
  { name: SEC_TEST_STEPS, detail: "Holds the steps of the test", validIn: ["root"] },
  {
    name: "STEP",
    detail: "A test step: [STEP <id>]",
    validIn: ["testSteps"],
    nameSnippet: "STEP ${1:10}",
  },
  { name: SEC_STEP_DEFINITION, detail: "Description, requirements and expected results of the step", validIn: ["step"] },
  { name: SEC_STEP_INPUTS, detail: "Messages and commands sent in this step", validIn: ["step"] },
  { name: SEC_STEP_OUTPUTS, detail: "Messages expected in this step", validIn: ["step"] },
  { name: SEC_INCLUDE, detail: "Run another .esi file here", validIn: ["step", "root"] },
  { name: "STEP GET_DUMP", detail: "Step that collects the configured memory dump", validIn: ["testSteps"] },
  { name: "TIMELIMIT", detail: "Delay, in ms (time = …)", validIn: ["stepInputs"] },
  { name: SEC_MANUAL_VERIFY, detail: "Operator pass/fail prompt", validIn: ["stepOutputs"] },
  { name: SEC_EXTERNAL_VERIFY, detail: "Verdict read from a result file", validIn: ["stepOutputs"] },
  { name: SEC_STEP_DUMP, detail: "One-liner section: [STEP DUMP/]", validIn: ["stepOutputs"], oneLiner: true },
  { name: "CMD_EXECUTE", detail: "Run a host executable or script", validIn: COMMAND_POSITIONS },
  { name: "CMD_INSTRUCTION", detail: "Blocking instruction to the operator", validIn: COMMAND_POSITIONS },
  { name: "CMD_SWMemoryWrite", detail: "Write a binary file into a memory region", validIn: COMMAND_POSITIONS },
];

/** Component connections (`[429_…]`, `[PART_…]`, …) belong in these. */
const CONNECTION_POSITIONS: readonly TagPosition[] = ["stepInputs", "stepOutputs"];

export interface OpenSection {
  name: string;
  /** 0-indexed line of the opening tag. */
  line: number;
  /** Leading whitespace of the opening tag's line, verbatim. */
  indent: string;
}

export interface TagCompletionEntry {
  label: string;
  /** "section" = structural name, "connection" = from the XML index, "close" = closing tag. */
  source: "section" | "connection" | "close";
  detail?: string;
  /** Replaces columns [startCol, endCol) of the cursor line. */
  insertText: string;
  /** True when `insertText` is snippet syntax (tab stops, escaped `$`). */
  isSnippet: boolean;
  filterText: string;
  sortText: string;
  preselect?: boolean;
  /**
   * Closing tags only: the whitespace before `[/` should be replaced with
   * this (the opening tag's own indentation) — columns [0, bracketCol).
   * Absent when the line is already indented like its opener.
   */
  lineIndent?: string;
}

export interface TagCompletionResult {
  mode: "open" | "close";
  /** Section tree position of the cursor line. */
  position: TagPosition;
  /** Column of the `[` the cursor sits in. */
  bracketCol: number;
  /** Replace range on the cursor line, shared by every entry. */
  startCol: number;
  endCol: number;
  entries: TagCompletionEntry[];
}

const isStepName = isStepSectionName;

/**
 * Sections still open just before `lineIndex`, outermost first. A proper
 * stack: a close pops back to its opener, a close with no opener is ignored,
 * and a one-liner (or a name TestPit would reject) never touches it.
 */
export function openSectionsBefore(
  lines: readonly string[],
  lineIndex: number
): OpenSection[] {
  const stack: OpenSection[] = [];
  const end = Math.min(lineIndex, lines.length);
  for (let i = 0; i < end; i++) {
    const tag = parseSectionTagLine(lines[i]);
    if (!tag || tag.invalid || tag.kind === "oneLiner") {
      continue;
    }
    if (tag.kind === "open") {
      stack.push({
        name: tag.name,
        line: i,
        indent: lines[i].slice(0, tag.startCol),
      });
      continue;
    }
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s].name === tag.name) {
        stack.length = s;
        break;
      }
    }
  }
  return stack;
}

/** Classify the cursor position from its innermost open section. */
export function tagPositionOf(stack: readonly OpenSection[]): TagPosition {
  if (stack.length === 0) {
    return "root";
  }
  const name = stack[stack.length - 1].name;
  if (name === SEC_TEST_STEPS) {
    return "testSteps";
  }
  if (name === SEC_STEP_INPUTS) {
    return "stepInputs";
  }
  if (name === SEC_STEP_OUTPUTS) {
    return "stepOutputs";
  }
  if (name === SEC_INCLUDE) {
    return "include";
  }
  return isStepName(name) ? "step" : "other";
}

/**
 * Closing tags below the cursor line that close nothing: no opener below
 * them, and none above the cursor either.
 *
 * `names`: a tag typed on the cursor line with one of these names is already
 * closed, so no second closing tag is inserted for it.
 *
 * `atCursorLevel`: one of them sits at the cursor's own nesting level (before
 * any enclosing section closes, no opener pending). That is the closer of the
 * block whose opening tag is being retyped on the cursor line, so no closing
 * tag is inserted whatever name is accepted - a new pair above the old body
 * would orphan it.
 */
function unclaimedClosesBelow(
  lines: readonly string[],
  lineIndex: number,
  openAbove: readonly OpenSection[]
): { names: Set<string>; atCursorLevel: boolean } {
  const above = openAbove.map((s) => s.name);
  const below: string[] = [];
  const unclaimed = new Set<string>();
  let atCursorLevel = false;
  let enclosingClosed = false;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const tag = parseSectionTagLine(lines[i]);
    if (!tag || tag.invalid || tag.kind === "oneLiner") {
      continue;
    }
    if (tag.kind === "open") {
      below.push(tag.name);
      continue;
    }
    const inBelow = below.lastIndexOf(tag.name);
    if (inBelow !== -1) {
      below.length = inBelow;
      continue;
    }
    const inAbove = above.lastIndexOf(tag.name);
    if (inAbove !== -1) {
      above.length = inAbove;
      enclosingClosed = true;
    } else {
      unclaimed.add(tag.name);
      if (!enclosingClosed && below.length === 0) {
        atCursorLevel = true;
      }
    }
  }
  return { names: unclaimed, atCursorLevel };
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&");
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * How much of the line after the cursor an accepted item takes with it.
 *
 * `language-configuration.json` auto-closes `[` to `[]`, so on a tag line
 * the rest of the name and its `]` are swallowed and the item writes its own
 * `]` — never `]]`. A `[` in the middle of a line (prose, a value) is left as
 * it always was: only the typed partial is replaced.
 */
function tailOf(
  before: string,
  after: string,
  bracketCol: number,
  character: number
): { tagLine: boolean; endCol: number; writeBracket: boolean; restIsEmpty: boolean } {
  const tagLine = before.slice(0, bracketCol).trim() === "";
  if (!tagLine) {
    return { tagLine, endCol: character, writeBracket: false, restIsEmpty: false };
  }
  const closed = /^([^[\]#]*)\]/.exec(after);
  if (closed) {
    return {
      tagLine,
      endCol: character + closed[0].length,
      writeBracket: true,
      restIsEmpty:
        closed[1].trim() === "" && after.slice(closed[0].length).trim() === "",
    };
  }
  const blank = after.trim() === "";
  return { tagLine, endCol: character, writeBracket: blank, restIsEmpty: blank };
}

/**
 * Compute tag completions for a cursor inside `[…` (opening) or `[/…`
 * (closing).
 *
 * @param documentText     full document text
 * @param lineIndex        0-indexed cursor line
 * @param character        0-indexed cursor column
 * @param partial          text typed between the `[` (or `[/`) and the cursor
 * @param closing          true when the cursor follows `[/`
 * @param connectionNames  full connection names from the XML index (may be empty)
 */
export function computeTagCompletions(
  documentText: string,
  lineIndex: number,
  character: number,
  partial: string,
  closing: boolean,
  connectionNames: Iterable<string>
): TagCompletionResult | undefined {
  const lines = documentText.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined;
  }
  const line = lines[lineIndex];
  const startCol = character - partial.length;
  const bracketCol = startCol - (closing ? 2 : 1);
  if (bracketCol < 0 || line[bracketCol] !== "[") {
    return undefined;
  }
  const before = line.slice(0, character);
  const after = line.slice(character);
  const lineIndent = line.slice(0, bracketCol);
  const tail = tailOf(before, after, bracketCol, character);
  const bracket = tail.writeBracket ? "]" : "";

  const stack = openSectionsBefore(lines, lineIndex);
  const position = tagPositionOf(stack);
  const base = { position, bracketCol, startCol, endCol: tail.endCol };

  if (closing) {
    const entries: TagCompletionEntry[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i];
      const entry: TagCompletionEntry = {
        label: open.name,
        source: "close",
        detail: `closes [${open.name}] from line ${open.line + 1}`,
        insertText: open.name + bracket,
        isSnippet: false,
        filterText: open.name,
        sortText: pad(entries.length),
      };
      if (entries.length === 0) {
        entry.preselect = true;
      }
      if (tail.tagLine && open.indent !== lineIndent) {
        entry.lineIndent = open.indent;
      }
      entries.push(entry);
    }
    return { mode: "close", ...base, entries };
  }

  // A closing tag is added only for a brand-new tag: nothing else on the line.
  const freshLine = tail.tagLine && tail.restIsEmpty;
  const closes = freshLine
    ? unclaimedClosesBelow(lines, lineIndex, stack)
    : undefined;
  const closedBelow = closes?.names ?? new Set<string>();
  const blockClosedBelow = closes?.atCursorLevel ?? false;
  const stepClosedBelow = Array.from(closedBelow).some(isStepName);

  const openText = (
    name: string,
    nameSnippet: string | undefined,
    oneLiner: boolean,
    alreadyClosed: boolean
  ): { insertText: string; isSnippet: boolean } => {
    if (oneLiner) {
      // `[NAME/]` closes itself — never a closing tag below it.
      return { insertText: tail.writeBracket ? `${name}/]` : name, isSnippet: false };
    }
    if (freshLine && !alreadyClosed && !blockClosedBelow) {
      const snippetName = nameSnippet ?? escapeSnippet(name);
      const indent = escapeSnippet(lineIndent);
      return {
        insertText:
          `${snippetName}]\n${indent}${INDENT}$0\n${indent}[/${snippetName}]`,
        isSnippet: true,
      };
    }
    if (nameSnippet && tail.writeBracket) {
      return { insertText: `${nameSnippet}]`, isSnippet: true };
    }
    return { insertText: name + bracket, isSnippet: false };
  };

  const entries: TagCompletionEntry[] = [];
  STRUCTURAL_SECTIONS.forEach((section, i) => {
    const valid = section.validIn.includes(position);
    const alreadyClosed = section.nameSnippet
      ? stepClosedBelow
      : closedBelow.has(section.name);
    entries.push({
      label: section.name,
      source: "section",
      detail: section.detail,
      ...openText(
        section.name,
        section.nameSnippet,
        section.oneLiner === true,
        alreadyClosed
      ),
      filterText: section.name,
      sortText: `${valid ? "0" : "2"}${pad(i)}`,
    });
  });

  const connectionRank = CONNECTION_POSITIONS.includes(position) ? "1" : "3";
  for (const name of connectionNames) {
    entries.push({
      label: name,
      source: "connection",
      ...openText(name, undefined, false, closedBelow.has(name)),
      filterText: name,
      sortText: `${connectionRank}${name}`,
    });
  }

  return { mode: "open", ...base, entries };
}
