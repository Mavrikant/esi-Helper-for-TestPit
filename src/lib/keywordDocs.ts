/**
 * Hover documentation for the two kinds of `.esi` keyword the XML index knows
 * nothing about: TestPit PARAMETER keys inside a component block (`match`,
 * `occurrence`, `time`, …) and STRUCTURAL section tags (`[STEP INPUTS]`,
 * `[VARIABLES]`, …). vscode-free.
 *
 * DOMAIN HONESTY: TestPit's source is not in this repository. Every sentence
 * here restates something the repository itself evidences — CLAUDE.md, the
 * comments and messages in componentValidator.ts, the `detail` strings in
 * tagCompletion.ts, snippets.json, README.md. Where the repository knows only
 * a keyword's NAME and class (most parameters), the card says only that. Do
 * not add an explanation of what a parameter "means" unless the engine's
 * behaviour is documented somewhere in this repository first.
 */
import {
  ASSIGNMENT_RE,
  MATCH_FIELD,
  MATCH_VALUES,
  PARAMETER_FIELDS,
} from "./componentValidator";
import { resolveContext } from "./esiContext";
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
  SEC_VARIABLES,
} from "./sectionNames";
import { STRUCTURAL_SECTIONS, TagPosition } from "./tagCompletion";

// ---------------------------------------------------------------- parameters

/** What the repository knows about a parameter beyond its name. */
export interface ParameterDoc {
  /** One-line classification, e.g. "TestPit parameter — output blocks only". */
  summary: string;
  /** Further evidenced facts, one bullet each. */
  notes: readonly string[];
}

const NO_VALUE_CHECK =
  "The extension does not check its value: per the project notes, `occurrence` and `match` are the only parameters whose value TestPit constrains.";
const OUTPUT_ONLY_NOTE =
  "Output-only on every bus: in a `[STEP INPUTS]` message it has no effect, and the extension warns.";
const MACRO_EXEMPT = "A `%macro%` value is not checked.";

// `match` values, in MATCH_VALUES. Wording from CLAUDE.md / componentValidator.ts.
const MATCH_VALUE_DOCS: Readonly<Record<string, string>> = {
  next: "the default: the next record no other block has taken",
  any: "any record in the comparison window carrying these values",
};

const COMMON = "TestPit parameter — common cross-bus";
const BUS_SPECIFIC = "TestPit parameter — bus-specific";
const BUS_SPECIFIC_OUTPUT = "TestPit parameter — bus-specific, output";
const OUTPUT_ONLY = "TestPit parameter — output blocks only";

const PARAMETER_DOCS: Readonly<Record<string, ParameterDoc>> = {
  time: { summary: COMMON, notes: [NO_VALUE_CHECK] },
  period: { summary: COMMON, notes: [NO_VALUE_CHECK] },
  interval: { summary: COMMON, notes: [NO_VALUE_CHECK] },
  count: { summary: COMMON, notes: [NO_VALUE_CHECK] },
  occurrence: {
    summary: OUTPUT_ONLY,
    notes: [
      "Value: `ALL`, or a non-negative number with an optional `<` or `>` in front.",
      "TestPit refuses any other value instead of falling back to a default, so the extension reports one as an error. Case-sensitive.",
      MACRO_EXEMPT,
      OUTPUT_ONLY_NOTE,
    ],
  },
  [MATCH_FIELD]: {
    summary: `${OUTPUT_ONLY} (TestPit ≥ v1.3.6.15)`,
    notes: [
      "Picks which record of the comparison window may answer an expected block:",
      ...MATCH_VALUES.map(
        (v) => `\`${v}\` — ${MATCH_VALUE_DOCS[v] ?? "accepted value"}`
      ),
      "TestPit refuses any other value instead of falling back to the default, so the extension reports one as an error. Case-sensitive.",
      MACRO_EXEMPT,
      OUTPUT_ONLY_NOTE,
    ],
  },
  synchronize: { summary: OUTPUT_ONLY, notes: [OUTPUT_ONLY_NOTE, NO_VALUE_CHECK] },
  parity: { summary: BUS_SPECIFIC, notes: [NO_VALUE_CHECK] },
  duration: { summary: BUS_SPECIFIC, notes: [NO_VALUE_CHECK] },
  image: { summary: BUS_SPECIFIC, notes: [NO_VALUE_CHECK] },
  validity: { summary: BUS_SPECIFIC_OUTPUT, notes: [NO_VALUE_CHECK] },
  angle: { summary: BUS_SPECIFIC_OUTPUT, notes: [NO_VALUE_CHECK] },
};

/** Used for a PARAMETER_FIELDS entry added later without a doc of its own. */
const GENERIC_PARAMETER_DOC: ParameterDoc = {
  summary: "TestPit parameter",
  notes: [NO_VALUE_CHECK],
};

/** The doc for a parameter key, or undefined when `name` is not a parameter. */
export function parameterDoc(name: string): ParameterDoc | undefined {
  if (!PARAMETER_FIELDS.has(name)) {
    return undefined;
  }
  return PARAMETER_DOCS[name] ?? GENERIC_PARAMETER_DOC;
}

/** True when a parameter has an entry of its own (not the generic fallback). */
export function hasOwnParameterDoc(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PARAMETER_DOCS, name);
}

export function renderParameterDoc(name: string, doc: ParameterDoc): string {
  return [
    `**\`${name}\`** — ${doc.summary}`,
    "",
    ...doc.notes.map((n) => `- ${n}`),
  ].join("\n");
}

// ------------------------------------------------------------------ sections

export interface SectionDoc {
  /** How the tag is written, e.g. `[STEP <id>]`, `[STEP DUMP/]`. */
  title: string;
  /** One-line description (the tag-completion `detail`). */
  summary: string;
  notes: readonly string[];
}

const POSITION_LABEL: Readonly<Partial<Record<TagPosition, string>>> = {
  root: "the top level",
  testSteps: "`[TEST STEPS]`",
  step: "a `[STEP <id>]`",
  stepInputs: "`[STEP INPUTS]`",
  stepOutputs: "`[STEP OUTPUTS]`",
  include: "`[INCLUDE]`",
};

const STEP_ENTRY = "STEP";

// Facts beyond the one-line summary, each traceable to the repository:
// the extension's section templates (tagCompletion.ts STRUCTURAL_SECTIONS bodies: the keys), componentValidator.ts
// validateStructure (the nesting rules) and README.md (macros / includes).
const SECTION_NOTES: Readonly<Record<string, readonly string[]>> = {
  [SEC_VARIABLES]: ["A `%NAME% = value` line defines a macro."],
  [SEC_INCLUDE]: [
    "`include file = …` names the file.",
    "A `%NAME% = value` line here hands that macro to the included file.",
  ],
  [SEC_TEST_DEFINITION]: [
    "Keys in the extension's template: `Test Description`, `Test Configuration`, `Test Dependencies`.",
  ],
  [STEP_ENTRY]: [
    "The extension's \"STEP (full skeleton)\" completion gives a step a `[STEP DEFINITION]`, a `[STEP INPUTS]` and a `[STEP OUTPUTS]`.",
  ],
  [SEC_STEP_DEFINITION]: [
    "Keys in the extension's template: `Step Description`, `Step Requirements`, `Step Dependencies`, `Step Conditions`, `Step Expected Results`.",
  ],
  [SEC_STEP_INPUTS]: [
    "Output-only parameters (`occurrence`, `synchronize`, `match`) have no effect in a message here.",
    "An A708 message cannot be defined here (TestPit error).",
    "`[MANUAL_VERIFY]` / `[EXTERNAL_VERIFY]` are not valid here — they belong in `[STEP OUTPUTS]`.",
  ],
  [SEC_STEP_OUTPUTS]: [
    "`[MANUAL_VERIFY]` and `[EXTERNAL_VERIFY]` belong here.",
  ],
  [SEC_MANUAL_VERIFY]: [
    "Key in the extension's template: `text`.",
    "Not valid under `[STEP INPUTS]` (TestPit warning).",
  ],
  [SEC_EXTERNAL_VERIFY]: [
    "Key in the extension's template: `result file`.",
    "Not valid under `[STEP INPUTS]` (TestPit warning).",
  ],
  [SEC_STEP_DUMP]: [
    "Written `[STEP DUMP/]`: it opens and closes on one line and takes no `[/STEP DUMP]`.",
  ],
  CMD_EXECUTE: ["Keys in the extension's template: `system call`, `wait timeout`."],
};

/**
 * The doc for a NORMALIZED section name (as parseSectionTag.ts returns it):
 * one of the structural sections tag completion offers, or any `[STEP <id>]`.
 * Undefined for a component tag or any other name.
 */
export function sectionDoc(name: string): SectionDoc | undefined {
  let entry = STRUCTURAL_SECTIONS.find((s) => s.name === name);
  let title = name;
  if (!entry && isStepSectionName(name)) {
    entry = STRUCTURAL_SECTIONS.find((s) => s.name === STEP_ENTRY);
  } else if (entry?.name === STEP_ENTRY) {
    // A bare `[STEP]` is not a step: isStepSectionName needs an id.
    return undefined;
  }
  if (!entry) {
    return undefined;
  }
  if (entry.oneLiner) {
    title = `${name}/`;
  }
  const places = entry.validIn
    .map((p) => POSITION_LABEL[p])
    .filter((p): p is string => p !== undefined);
  const notes: string[] = [];
  if (places.length > 0) {
    notes.push(`Belongs in: ${places.join(", ")}.`);
  }
  notes.push(...(SECTION_NOTES[entry.name] ?? []));
  return { title: `[${title}]`, summary: entry.detail, notes };
}

export function renderSectionDoc(doc: SectionDoc): string {
  return [
    `**\`${doc.title}\`** — section`,
    "",
    doc.summary,
    "",
    ...doc.notes.map((n) => `- ${n}`),
  ].join("\n");
}

// --------------------------------------------------------------------- hover

export interface KeywordHover {
  kind: "parameter" | "section";
  /** The parameter key, or the normalized section name. */
  name: string;
  markdown: string;
  line: number;
  startCol: number;
  endCol: number;
}

export interface KeywordHoverOptions {
  /**
   * True when the message of component block `blockName` really has a field
   * called `key` (e.g. the synthesized `value` of a DIS_ message, or a config
   * that names a field `time`). The component hover answers there, so this
   * one stays silent. Omitted → no such field is assumed.
   */
  isRealField?: (blockName: string, key: string) => boolean;
}

/**
 * The keyword card for the cursor, if it is on a structural section tag or on
 * a parameter key of an assignment inside a component block.
 */
export function keywordHoverAt(
  documentText: string,
  lineIndex: number,
  character: number,
  options: KeywordHoverOptions = {}
): KeywordHover | undefined {
  const lines = documentText.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined;
  }
  const raw = lines[lineIndex];

  const tag = parseSectionTagLine(raw);
  if (tag) {
    if (tag.invalid || character < tag.startCol || character >= tag.endCol) {
      return undefined;
    }
    const doc = sectionDoc(tag.name);
    if (!doc) {
      return undefined;
    }
    return {
      kind: "section",
      name: tag.name,
      markdown: renderSectionDoc(doc),
      line: lineIndex,
      startCol: tag.startCol,
      endCol: tag.endCol,
    };
  }

  const assignment = ASSIGNMENT_RE.exec(raw);
  if (!assignment) {
    return undefined;
  }
  const key = assignment[2];
  const startCol = assignment[1].length;
  const endCol = startCol + key.length;
  if (character < startCol || character >= endCol) {
    return undefined;
  }
  const doc = parameterDoc(key);
  if (!doc) {
    return undefined;
  }
  // Parameters only exist inside a component block; elsewhere (prose of a
  // STEP DEFINITION, a VARIABLES line, …) the same word means nothing known.
  const ctx = resolveContext(documentText, lineIndex, startCol);
  if (ctx.kind !== "fieldName" || options.isRealField?.(ctx.messageName, key)) {
    return undefined;
  }
  return {
    kind: "parameter",
    name: key,
    markdown: renderParameterDoc(key, doc),
    line: lineIndex,
    startCol,
    endCol,
  };
}
