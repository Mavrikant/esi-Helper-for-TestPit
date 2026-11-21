/**
 * Decision logic for section-tag completion: what to offer after `[` and
 * `[/`, which span of the line an accepted item replaces, and the text it
 * inserts. vscode-free so it is unit-tested directly; the provider
 * (providers/completion.ts) only maps the result onto CompletionItems.
 *
 * Tag lines are classified by parseSectionTag.ts and nowhere else — a
 * one-liner `[NAME/]` therefore never lands on a stack here.
 */
import { nextStepNumber } from "./nextStepNumber";
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
  /** Label and filter text; also the tag name unless `isStep` is set. */
  name: string;
  detail: string;
  /** Positions this section belongs in — it is ranked first there. */
  validIn: readonly TagPosition[];
  /**
   * `[STEP <id>]`: the name needs an id, written as a tab stop holding the
   * next number of the file's own numbering (nextStepNumber.ts).
   */
  isStep?: boolean;
  /** Written as `[NAME/]`: opens and closes on one line, no closing tag. */
  oneLiner?: boolean;
  /**
   * What a brand-new block is filled with, instead of an empty line: the
   * lines between the tags, written relative to the tag's own column, in
   * snippet syntax (tab stops numbered from 1). These are the multi-line
   * bodies snippets.json used to carry — one list entry per section now.
   */
  body?: readonly string[];
}

const STEP_DEFINITION_BODY: readonly string[] = [
  "    Step Description      = $1",
  "    Step Requirements     = $2",
  "    Step Dependencies     = N/A$3",
  "    Step Conditions       = <pre>",
  "                                <br/> $4",
  "                                <br/> $5",
  "                            </pre>",
  "    Step Expected Results = <pre>",
  "                                <br/> $6",
  "                            </pre>",
];

/** Label of the second STEP entry: the step with all three parts filled in. */
export const STEP_SKELETON_LABEL = "STEP (full skeleton)";

/** Suffix of the second entry of a connection: the block plus its field lines. */
export const WITH_FIELDS_SUFFIX = " (with fields)";

/**
 * The inside of a full step, relative to the `[STEP <id>]` column. Tab stop 1
 * is the step id, so the stops here start at 2.
 */
function stepSkeletonBody(): string[] {
  const definition = STEP_DEFINITION_BODY.map(
    (line) => INDENT + line.replace(/\$(\d)/g, (_m, n: string) => `$${Number(n) + 1}`)
  );
  return [
    `${INDENT}[${SEC_STEP_DEFINITION}]`,
    ...definition,
    `${INDENT}[/${SEC_STEP_DEFINITION}]`,
    `${INDENT}[${SEC_STEP_INPUTS}]`,
    `${INDENT}${INDENT}$8`,
    `${INDENT}[/${SEC_STEP_INPUTS}]`,
    `${INDENT}[${SEC_STEP_OUTPUTS}]`,
    `${INDENT}${INDENT}$9`,
    `${INDENT}[/${SEC_STEP_OUTPUTS}]`,
  ];
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
  {
    name: SEC_VARIABLES,
    detail: "Constant macros for this file",
    validIn: ["root"],
    body: ["    %$1% = $2"],
  },
  {
    name: SEC_TEST_DEFINITION,
    detail: "Test description, used in the report",
    validIn: ["root"],
    body: [
      "    Test Description   = $1",
      "    Test Configuration = $2",
      "    Test Dependencies  = $3",
    ],
  },
  { name: SEC_TEST_STEPS, detail: "Holds the steps of the test", validIn: ["root"] },
  {
    name: "STEP",
    detail: "A test step: [STEP <id>]",
    validIn: ["testSteps"],
    isStep: true,
  },
  {
    name: SEC_STEP_DEFINITION,
    detail: "Description, requirements and expected results of the step",
    validIn: ["step"],
    body: STEP_DEFINITION_BODY,
  },
  { name: SEC_STEP_INPUTS, detail: "Messages and commands sent in this step", validIn: ["step"] },
  { name: SEC_STEP_OUTPUTS, detail: "Messages expected in this step", validIn: ["step"] },
  { name: SEC_INCLUDE, detail: "Run another .esi file here", validIn: ["step", "root"] },
  {
    name: "STEP GET_DUMP",
    detail: "Step that collects the configured memory dump",
    validIn: ["testSteps"],
    body: [`    [${SEC_STEP_INPUTS}]`, `    [/${SEC_STEP_INPUTS}]`],
  },
  { name: "TIMELIMIT", detail: "Delay, in ms (time = …)", validIn: ["stepInputs"] },
  {
    name: SEC_MANUAL_VERIFY,
    detail: "Operator pass/fail prompt",
    validIn: ["stepOutputs"],
    body: ["    text = $1"],
  },
  {
    name: SEC_EXTERNAL_VERIFY,
    detail: "Verdict read from a result file",
    validIn: ["stepOutputs"],
    body: ["    result file = $1"],
  },
  { name: SEC_STEP_DUMP, detail: "One-liner section: [STEP DUMP/]", validIn: ["stepOutputs"], oneLiner: true },
  {
    name: "CMD_EXECUTE",
    detail: "Run a host executable or script",
    validIn: COMMAND_POSITIONS,
    body: ["    system call  = $1", "    wait timeout = %TIMEOUT%"],
  },
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
  /**
   * Connection entries: the connection's full name. Differs from `label` on
   * the "with fields" variant.
   */
  connectionName?: string;
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

export interface TagCompletionOptions {
  /**
   * The lines a new block of this connection usually needs, as key names
   * (`time`, then the message's fields). When it returns some, and the tag is
   * typed on an empty line inside [STEP INPUTS] / [STEP OUTPUTS], a second,
   * lower-ranked "with fields" entry is offered beside the plain tag.
   */
  skeletonKeys?: (connectionName: string) => readonly string[] | undefined;
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
 * @param options          optional extras (the "with fields" block variant)
 */
export function computeTagCompletions(
  documentText: string,
  lineIndex: number,
  character: number,
  partial: string,
  closing: boolean,
  connectionNames: Iterable<string>,
  options: TagCompletionOptions = {}
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
    alreadyClosed: boolean,
    body?: readonly string[]
  ): { insertText: string; isSnippet: boolean } => {
    if (oneLiner) {
      // `[NAME/]` closes itself — never a closing tag below it.
      return { insertText: tail.writeBracket ? `${name}/]` : name, isSnippet: false };
    }
    if (freshLine && !alreadyClosed && !blockClosedBelow) {
      const snippetName = nameSnippet ?? escapeSnippet(name);
      const indent = escapeSnippet(lineIndent);
      const inside = body
        ? body.map((bodyLine) => indent + bodyLine).join("\n")
        : `${indent}${INDENT}$0`;
      return {
        insertText: `${snippetName}]\n${inside}\n${indent}[/${snippetName}]`,
        isSnippet: true,
      };
    }
    if (nameSnippet && tail.writeBracket) {
      return { insertText: `${nameSnippet}]`, isSnippet: true };
    }
    return { insertText: name + bracket, isSnippet: false };
  };

  // A new step is proposed the number the file's own numbering leads to.
  const stepNameSnippet = `STEP \${1:${nextStepNumber(lines, lineIndex)}}`;

  const entries: TagCompletionEntry[] = [];
  STRUCTURAL_SECTIONS.forEach((section, i) => {
    const valid = section.validIn.includes(position);
    const isStep = section.isStep === true;
    const alreadyClosed = isStep ? stepClosedBelow : closedBelow.has(section.name);
    const rank = `${valid ? "0" : "2"}${pad(i)}`;
    entries.push({
      label: section.name,
      source: "section",
      detail: section.detail,
      ...openText(
        section.name,
        isStep ? stepNameSnippet : undefined,
        section.oneLiner === true,
        alreadyClosed,
        section.body
      ),
      filterText: section.name,
      sortText: rank,
    });
    // The whole step - definition, inputs, outputs - as a second entry right
    // below the plain one. Only where a new block is being written.
    if (isStep && freshLine && !alreadyClosed && !blockClosedBelow) {
      entries.push({
        label: STEP_SKELETON_LABEL,
        source: "section",
        detail: "A test step with its definition, inputs and outputs",
        ...openText(section.name, stepNameSnippet, false, false, stepSkeletonBody()),
        filterText: section.name,
        sortText: `${rank}+`,
      });
    }
  });

  const inMessageSection = CONNECTION_POSITIONS.includes(position);
  const connectionRank = inMessageSection ? "1" : "3";
  for (const name of connectionNames) {
    const alreadyClosed = closedBelow.has(name);
    entries.push({
      label: name,
      connectionName: name,
      source: "connection",
      ...openText(name, undefined, false, alreadyClosed),
      filterText: name,
      sortText: `${connectionRank}${name}`,
    });
    if (!inMessageSection || !freshLine || alreadyClosed || blockClosedBelow) {
      continue;
    }
    const keys = options.skeletonKeys?.(name);
    if (!keys || keys.length === 0) {
      continue;
    }
    const width = Math.max(...keys.map((k) => k.length));
    entries.push({
      label: name + WITH_FIELDS_SUFFIX,
      connectionName: name,
      source: "connection",
      detail: `block with ${keys.join(", ")}`,
      ...openText(
        name,
        undefined,
        false,
        false,
        keys.map(
          (key, k) => `${INDENT}${escapeSnippet(key.padEnd(width))} = $${k + 1}`
        )
      ),
      filterText: name,
      // A blank sorts before every name character, so the variant sits right
      // under its plain tag and above longer names sharing the prefix.
      sortText: `${connectionRank}${name} +`,
    });
  }

  return { mode: "open", ...base, entries };
}
