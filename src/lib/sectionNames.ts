/**
 * The structural (non-component) section names of a `.esi` script, in ONE
 * place. Shared by the validator, the outline/folding builder, tag completion
 * and the goto-step list, so they cannot drift apart on what counts as a step.
 * vscode-free. Names are as TestPit spells them (ParserCharacterDefinitions.h)
 * and are compared against the NORMALIZED name parseSectionTag.ts returns.
 */
export const SEC_VARIABLES = "VARIABLES";
export const SEC_INCLUDE = "INCLUDE";
export const SEC_TEST_DEFINITION = "TEST DEFINITION";
export const SEC_TEST_STEPS = "TEST STEPS";
export const SEC_STEP_DEFINITION = "STEP DEFINITION";
export const SEC_STEP_INPUTS = "STEP INPUTS";
export const SEC_STEP_OUTPUTS = "STEP OUTPUTS";
export const SEC_STEP_DUMP = "STEP DUMP";
export const SEC_MANUAL_VERIFY = "MANUAL_VERIFY";
export const SEC_EXTERNAL_VERIFY = "EXTERNAL_VERIFY";

/** `[STEP <id>]` opens a step — unless the name is one of the reserved sections. */
export const STEP_PREFIX = "STEP ";

/** `STEP …` names that are parts of a step, not steps themselves. */
export const RESERVED_STEP_SECTIONS: ReadonlySet<string> = new Set([
  SEC_STEP_DEFINITION,
  SEC_STEP_INPUTS,
  SEC_STEP_OUTPUTS,
  SEC_STEP_DUMP,
]);

/** True for `STEP 10`, `STEP GET_DUMP`, …; false for `STEP INPUTS` and the like. */
export function isStepSectionName(name: string): boolean {
  return name.startsWith(STEP_PREFIX) && !RESERVED_STEP_SECTIONS.has(name);
}

const TOP_LEVEL_SECTIONS: ReadonlySet<string> = new Set([
  SEC_VARIABLES,
  SEC_INCLUDE,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
  SEC_MANUAL_VERIFY,
  SEC_EXTERNAL_VERIFY,
]);

/** True for a fixed structural section name (not a step id, not a component). */
export function isKnownSectionName(name: string): boolean {
  return TOP_LEVEL_SECTIONS.has(name) || RESERVED_STEP_SECTIONS.has(name);
}
