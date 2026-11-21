import { parseSectionTagLine } from "./parseSectionTag";
import {
  RESERVED_STEP_SECTIONS,
  SEC_STEP_DEFINITION,
  STEP_PREFIX,
} from "./sectionNames";

/**
 * One `[STEP <id>]` block of a `.esi` script, as shown in the goto-step
 * picker. Kept vscode-free so it can be unit-tested directly.
 */
export interface StepInfo {
  /** What follows `STEP ` in the tag: `10`, `GET_DUMP`, … */
  number: string;
  /** The normalized tag name, e.g. `STEP 10`. */
  label: string;
  /** 0-indexed line of the opening tag. */
  line: number;
  /** 0-indexed line of the closing tag (or the last line seen if unclosed). */
  endLine: number;
  /** `Step Description` from the step's `[STEP DEFINITION]`, or "". */
  description: string;
  /** `Step Requirements` from the step's `[STEP DEFINITION]`, or "". */
  requirements: string;
}

const STEP_NAME_RE = /^STEP\s+(\S.*)$/;
const KEY_RE = /^\s*Step (Description|Requirements)\s*=\s*(.*)$/i;
const PRE_OPEN_RE = /^<pre>/i;
const PRE_CLOSE_RE = /<\/pre>/i;
const MAX_TEXT = 120;

function stepNumberOf(tagName: string): string | undefined {
  const m = STEP_NAME_RE.exec(tagName);
  if (!m) {
    return undefined;
  }
  const id = m[1].trim();
  // `STEP DEFINITION` / `INPUTS` / `OUTPUTS` / `DUMP` are parts of a step.
  return RESERVED_STEP_SECTIONS.has(STEP_PREFIX + id.toUpperCase())
    ? undefined
    : id;
}

/** Drop markup (`<br/>`, `<pre>`), collapse whitespace, cap the length. */
function tidy(text: string): string {
  const flat = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_TEXT ? flat.slice(0, MAX_TEXT - 1) + "…" : flat;
}

function stripComment(line: string): string {
  return line.split("#")[0];
}

/**
 * List every step of a script in document order.
 *
 * A step is a section whose name is `STEP <id>` (`[STEP 10]`, `[STEP
 * GET_DUMP]`, the one-liner `[STEP 10/]`), excluding the `STEP DEFINITION` /
 * `STEP INPUTS` / `STEP OUTPUTS` parts. Tag shapes come from
 * `parseSectionTagLine`, so the sloppy forms TestPit repairs are found too.
 */
export function listSteps(text: string): StepInfo[] {
  const lines = text.split(/\r?\n/);
  const steps: StepInfo[] = [];
  let current: StepInfo | undefined;
  let inDefinition = false;
  /** A `<pre>` value being collected: which key, and the text so far. */
  let pre: { key: "description" | "requirements"; text: string } | undefined;

  const finishPre = (): void => {
    if (pre && current) {
      current[pre.key] = tidy(pre.text);
    }
    pre = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const tag = parseSectionTagLine(lines[i]);

    if (tag && !tag.invalid) {
      finishPre();
      const number = stepNumberOf(tag.name);
      if (number !== undefined) {
        if (tag.kind === "close") {
          if (current && current.label === tag.name) {
            current.endLine = i;
            current = undefined;
            inDefinition = false;
          }
          continue;
        }
        const step: StepInfo = {
          number,
          label: tag.name,
          line: i,
          endLine: i,
          description: "",
          requirements: "",
        };
        steps.push(step);
        inDefinition = false;
        // A one-liner opens and closes on its own line: it has no body.
        current = tag.kind === "oneLiner" ? undefined : step;
        continue;
      }
      if (tag.name === SEC_STEP_DEFINITION) {
        inDefinition = tag.kind === "open" && current !== undefined;
      }
    }

    if (!current) {
      continue;
    }
    current.endLine = i;
    if (!inDefinition || tag) {
      continue;
    }

    const code = stripComment(lines[i]);
    if (pre) {
      const close = PRE_CLOSE_RE.exec(code);
      if (close) {
        pre.text += " " + code.slice(0, close.index);
        finishPre();
      } else {
        pre.text += " " + code;
      }
      continue;
    }

    const m = KEY_RE.exec(code);
    if (!m) {
      continue;
    }
    const key =
      m[1].toLowerCase() === "description" ? "description" : "requirements";
    const value = m[2].trim();
    if (PRE_OPEN_RE.test(value)) {
      const close = PRE_CLOSE_RE.exec(value);
      if (close) {
        current[key] = tidy(value.slice(0, close.index));
      } else {
        pre = { key, text: value };
      }
    } else {
      current[key] = tidy(value);
    }
  }
  finishPre();

  return steps;
}

/**
 * The step a typed query names exactly: `10`, or `STEP 10` (case-insensitive,
 * surrounding whitespace ignored). First match wins, like `findStepLine`.
 */
export function findStepByQuery(
  steps: readonly StepInfo[],
  query: string
): StepInfo | undefined {
  const q = query.trim().replace(/\s+/g, " ").toUpperCase();
  if (q === "") {
    return undefined;
  }
  return steps.find(
    (s) => s.number.toUpperCase() === q || s.label.toUpperCase() === q
  );
}

/** The step whose block contains `line` (0-indexed), if any. */
export function findStepAtLine(
  steps: readonly StepInfo[],
  line: number
): StepInfo | undefined {
  return steps.find((s) => line >= s.line && line <= s.endLine);
}
