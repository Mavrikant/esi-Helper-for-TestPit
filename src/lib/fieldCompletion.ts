/**
 * Decision logic for FIELD-NAME completion inside a component block, and for
 * the key list of the "with fields" block variant. vscode-free; the provider
 * (providers/completion.ts) only maps the result onto CompletionItems.
 *
 * Nothing here says what a parameter MEANS. Which parameters exist, and which
 * are output-only, is taken from componentValidator.ts (its PARAMETER_FIELDS
 * list and the `outputFieldInInput` check) — see the notes on the lists below.
 */
import {
  ASSIGNMENT_RE,
  OUTPUT_ONLY_IN_INPUT,
  PARAMETER_FIELDS,
} from "./componentValidator";
import { findEnclosingBlock } from "./esiContext";
import { parseSectionTagLine } from "./parseSectionTag";
import { SEC_STEP_INPUTS, SEC_STEP_OUTPUTS } from "./sectionNames";
import { openSectionsBefore } from "./tagCompletion";
import { FieldDef, MessageDef } from "./xmlIndex";

/**
 * Parameters offered in every message block, input or output.
 *
 * componentValidator.PARAMETER_FIELDS holds more (parity, validity, angle,
 * duration, image), but those are bus-specific and the repo does not record
 * WHICH bus takes which, so they are not offered — typing one is still
 * accepted by the validator. The multi-word parameters (`end time`, `time
 * offset`, `clear time`, `frame count`, `return code`) are left out for the
 * same reason.
 */
export const COMMON_PARAMETERS: readonly string[] = [
  "time",
  "period",
  "interval",
  "count",
];

/**
 * Parameters that are output-only on EVERY bus (componentValidator's
 * OUTPUT_ONLY_IN_INPUT, which flags them inside [STEP INPUTS]). Offered
 * everywhere except in a block under [STEP INPUTS]. The validator's set is
 * the single source; a unit test (fieldCompletion.test.ts) also checks it
 * against what validateStructure really flags.
 */
export const OUTPUT_ONLY_PARAMETERS: readonly string[] =
  Array.from(OUTPUT_ONLY_IN_INPUT);

/** Which message section the block sits under, when the script shows it. */
export type BlockDirection = "input" | "output" | "unknown";

/** Direction of the block opened on / enclosing `lineIndex`. */
export function blockDirectionAt(
  lines: readonly string[],
  lineIndex: number
): BlockDirection {
  const stack = openSectionsBefore(lines, lineIndex);
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === SEC_STEP_INPUTS) {
      return "input";
    }
    if (stack[i].name === SEC_STEP_OUTPUTS) {
      return "output";
    }
  }
  return "unknown";
}

/**
 * Keys already assigned directly in the block opened on `openLine`,
 * lower-cased (TestPit's duplicate-key check is case-agnostic, per
 * componentValidator). `skipLine` — the cursor line — is not counted, so the
 * key being edited stays on offer. Lines of a nested section are not this
 * block's keys; a one-liner never nests.
 */
export function assignedKeysInBlock(
  lines: readonly string[],
  openLine: number,
  skipLine: number
): Set<string> {
  const keys = new Set<string>();
  let depth = 0;
  for (let i = openLine + 1; i < lines.length; i++) {
    const tag = parseSectionTagLine(lines[i]);
    if (tag) {
      if (tag.invalid || tag.kind === "oneLiner") {
        continue;
      }
      if (tag.kind === "open") {
        depth++;
      } else if (depth === 0) {
        break;
      } else {
        depth--;
      }
      continue;
    }
    if (depth > 0 || i === skipLine) {
      continue;
    }
    const m = ASSIGNMENT_RE.exec(lines[i].split("#")[0]);
    if (m) {
      keys.add(m[2].toLowerCase());
    }
  }
  return keys;
}

export interface FieldNameEntry {
  name: string;
  kind: "parameter" | "field";
  /** The message field, for `kind: "field"`. */
  field?: FieldDef;
  /** A field the config marks `Used=false` (reserved / spare / padding). */
  reserved: boolean;
  /** Parameters, then the message's fields in config order, reserved last. */
  sortText: string;
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * What to offer where a field name is being typed on `lineIndex`.
 *
 * - a key already assigned in the block is left out (a second one would be a
 *   duplicate key);
 * - the output-only parameters are left out of a block under [STEP INPUTS];
 * - reserved fields are still offered, but ranked last.
 *
 * `message` is the block's message from the XML index, if it resolved.
 */
export function computeFieldNameCompletions(
  lines: readonly string[],
  lineIndex: number,
  message: MessageDef | undefined
): FieldNameEntry[] {
  const block = findEnclosingBlock(lines, lineIndex);
  const assigned = block
    ? assignedKeysInBlock(lines, block.line, lineIndex)
    : new Set<string>();
  const direction = block ? blockDirectionAt(lines, block.line) : "unknown";

  const parameters = [
    ...COMMON_PARAMETERS,
    ...(direction === "input" ? [] : OUTPUT_ONLY_PARAMETERS),
  ].filter((name) => PARAMETER_FIELDS.has(name));

  const entries: FieldNameEntry[] = [];
  const seen = new Set<string>();
  const offer = (entry: FieldNameEntry): void => {
    const key = entry.name.toLowerCase();
    if (assigned.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  };

  // A message field wins over a parameter of the same name: it carries the
  // type and documentation.
  const fieldNames = new Set(
    (message?.fields ?? []).map((f) => f.name.toLowerCase())
  );
  parameters.forEach((name, i) => {
    if (!fieldNames.has(name)) {
      offer({ name, kind: "parameter", reserved: false, sortText: `0${pad(i)}` });
    }
  });
  (message?.fields ?? []).forEach((field, i) => {
    const reserved = field.used === false;
    offer({
      name: field.name,
      kind: "field",
      field,
      reserved,
      sortText: `${reserved ? "2" : "1"}${pad(i)}`,
    });
  });
  return entries;
}

/** How many message fields the "with fields" block variant lists at most. */
export const SKELETON_FIELD_LIMIT = 8;

/**
 * Keys of the "with fields" block variant: `time`, then the message's
 * non-reserved fields in config order, capped. `undefined` when the message
 * is unknown or has no such field — the plain tag is all there is to offer.
 */
export function skeletonKeys(
  message: MessageDef | undefined,
  limit = SKELETON_FIELD_LIMIT
): string[] | undefined {
  if (!message) {
    return undefined;
  }
  const fields = message.fields
    .filter((f) => f.used !== false && f.name.toLowerCase() !== "time")
    .slice(0, limit)
    .map((f) => f.name);
  return fields.length > 0 ? ["time", ...fields] : undefined;
}
