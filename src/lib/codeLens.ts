/**
 * CodeLens model for `.esi`: what to show above which line, computed from the
 * document text plus the problems the editor already knows about.
 *
 *   - top of a ROOT script (one with `[TEST STEPS]` / `[TEST DEFINITION]`,
 *     the same rule lib/macros.ts uses): "Validate" and "Open with TestPit";
 *   - above each `[STEP <id>]`: how many blocks sit directly inside its
 *     `[STEP INPUTS]` / `[STEP OUTPUTS]`, and — only when there are any — how
 *     many errors / warnings are reported inside the step's line range.
 *
 * The counts are purely structural (sections found by esiOutline.ts, which
 * classifies tag lines only through parseSectionTag.ts). Nothing here judges
 * the script: problems are counted, never produced.
 *
 * Kept vscode-free so it can be unit-tested directly.
 */
import { buildOutline, OutlineNode } from "./esiOutline";
import {
  SEC_STEP_INPUTS,
  SEC_STEP_OUTPUTS,
  SEC_TEST_DEFINITION,
  SEC_TEST_STEPS,
} from "./sectionNames";

export type LensSeverity = "error" | "warning" | "info" | "hint";

/** One problem already reported on the document (any source). */
export interface LensProblem {
  /** 0-based line the problem starts on. */
  line: number;
  severity: LensSeverity;
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
}

/** What a click on the lens does; the provider maps this to a command. */
export type LensAction =
  | { type: "validate" }
  | { type: "openWithTestPit" }
  /** Fold / unfold the section that opens on `line`. */
  | { type: "toggleFold"; line: number }
  /** List the problems on lines `startLine`…`endLine` (inclusive). */
  | { type: "showProblems"; startLine: number; endLine: number };

export interface EsiLens {
  /** 0-based line the lens sits above. */
  line: number;
  startCol: number;
  endCol: number;
  title: string;
  tooltip: string;
  action: LensAction;
}

export const LENS_TITLE_VALIDATE = "$(check) Validate";
export const LENS_TITLE_OPEN = "$(link-external) Open with TestPit";

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** `2 inputs · 1 output` */
export function formatStepSummary(inputs: number, outputs: number): string {
  return `${plural(inputs, "input")} · ${plural(outputs, "output")}`;
}

/** `1 error, 2 warnings` — only the non-zero parts; "" when there are none. */
export function formatProblemCounts(counts: ProblemCounts): string {
  const parts: string[] = [];
  if (counts.errors > 0) {
    parts.push(plural(counts.errors, "error"));
  }
  if (counts.warnings > 0) {
    parts.push(plural(counts.warnings, "warning"));
  }
  return parts.join(", ");
}

/**
 * Errors and warnings starting on lines `startLine`…`endLine` (inclusive).
 * Info and hint problems are not counted.
 */
export function countProblems(
  problems: readonly LensProblem[],
  startLine: number,
  endLine: number
): ProblemCounts {
  const counts: ProblemCounts = { errors: 0, warnings: 0 };
  for (const p of problems) {
    if (p.line < startLine || p.line > endLine) {
      continue;
    }
    if (p.severity === "error") {
      counts.errors++;
    } else if (p.severity === "warning") {
      counts.warnings++;
    }
  }
  return counts;
}

/** Blocks directly inside every `[<sectionName>]` child of a step. */
function countBlocks(step: OutlineNode, sectionName: string): number {
  let n = 0;
  for (const child of step.children) {
    if (child.name === sectionName) {
      n += child.children.length;
    }
  }
  return n;
}

function walk(nodes: readonly OutlineNode[], visit: (n: OutlineNode) => void): void {
  for (const n of nodes) {
    visit(n);
    walk(n.children, visit);
  }
}

/**
 * Compute every lens of a document, in document order (the script-level
 * lenses first).
 */
export function computeCodeLenses(
  text: string,
  problems: readonly LensProblem[] = []
): EsiLens[] {
  const outline = buildOutline(text);
  const lenses: EsiLens[] = [];
  const steps: OutlineNode[] = [];
  let isRootScript = false;

  walk(outline, (n) => {
    if (n.name === SEC_TEST_STEPS || n.name === SEC_TEST_DEFINITION) {
      isRootScript = true;
    }
    if (n.kind === "step") {
      steps.push(n);
    }
  });

  if (isRootScript) {
    lenses.push(
      {
        line: 0,
        startCol: 0,
        endCol: 0,
        title: LENS_TITLE_VALIDATE,
        tooltip: "Run the TestPit validity check on this script",
        action: { type: "validate" },
      },
      {
        line: 0,
        startCol: 0,
        endCol: 0,
        title: LENS_TITLE_OPEN,
        tooltip: "Open this script in TestPit",
        action: { type: "openWithTestPit" },
      }
    );
  }

  for (const step of steps) {
    const at = {
      line: step.startLine,
      startCol: step.selectionStartCol,
      endCol: step.selectionEndCol,
    };
    const inputs = countBlocks(step, SEC_STEP_INPUTS);
    const outputs = countBlocks(step, SEC_STEP_OUTPUTS);
    lenses.push({
      ...at,
      title: formatStepSummary(inputs, outputs),
      tooltip:
        `[${step.name}]: ${plural(inputs, "block")} in [${SEC_STEP_INPUTS}], ` +
        `${plural(outputs, "block")} in [${SEC_STEP_OUTPUTS}]. ` +
        "Click to fold / unfold the step.",
      action: { type: "toggleFold", line: step.startLine },
    });

    const counts = countProblems(problems, step.startLine, step.endLine);
    const summary = formatProblemCounts(counts);
    if (summary !== "") {
      lenses.push({
        ...at,
        title: `${counts.errors > 0 ? "$(error)" : "$(warning)"} ${summary}`,
        tooltip: `${summary} reported in [${step.name}]. Click to list them.`,
        action: {
          type: "showProblems",
          startLine: step.startLine,
          endLine: step.endLine,
        },
      });
    }
  }

  return lenses;
}
