// Pure helpers around the result of a TestPit validity run. vscode-free.

import type { ValidityIssue } from "./parseValidityOutput";

/**
 * "Newest document version wins" guard for publishing results. A run that
 * validated version N may publish only if nothing for a version > N has been
 * published for the same key — so a slow, older run can never overwrite the
 * result of a newer one.
 */
export interface VersionGate<K> {
  /** Records `version` and returns true unless a newer one was accepted. */
  accept(key: K, version: number): boolean;
  /** Forget a key (document closed — versions restart on reopen). */
  forget(key: K): void;
}

export function createVersionGate<K>(): VersionGate<K> {
  const latest = new Map<K, number>();
  return {
    accept(key, version) {
      const seen = latest.get(key);
      if (seen !== undefined && version < seen) {
        return false;
      }
      latest.set(key, version);
      return true;
    },
    forget(key) {
      latest.delete(key);
    },
  };
}

/**
 * Which keys (documents) have a TestPit run in flight. `onChange` fires only
 * on a real transition (idle -> running, running -> idle), so a listener can
 * repaint without de-duplicating. Counted, so overlapping begin()s for one key
 * (not expected: the scheduler serializes runs per document) stay consistent.
 */
export interface RunTracker<K> {
  begin(key: K): void;
  end(key: K): void;
  isRunning(key: K): boolean;
  /** Forget everything without firing (teardown). */
  clear(): void;
}

export function createRunTracker<K>(
  onChange?: (key: K, running: boolean) => void
): RunTracker<K> {
  const counts = new Map<K, number>();
  return {
    begin(key) {
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      if (n === 0) {
        onChange?.(key, true);
      }
    },
    end(key) {
      const n = counts.get(key);
      if (n === undefined) {
        return;
      }
      if (n > 1) {
        counts.set(key, n - 1);
        return;
      }
      counts.delete(key);
      onChange?.(key, false);
    },
    isRunning(key) {
      return counts.has(key);
    },
    clear() {
      counts.clear();
    },
  };
}

export type ValidityOutcome = "clean" | "warnings" | "errors" | "no-log";

export interface ValiditySummary {
  outcome: ValidityOutcome;
  /** Issues placed on a line (these are the ones in the Problems panel). */
  errors: number;
  warnings: number;
  /**
   * [Error]/[Fatal]/[Warn.] log lines that carry no line number: they cannot
   * become diagnostics, so they are only visible in the output channel.
   */
  unlocated: number;
  /** One short sentence for a notification. */
  message: string;
}

const LOG_LINE = /\[(Info|Warn\.|Error|Fatal)\]/;
const PROBLEM_LINE = /\[(Warn\.|Error|Fatal)\]/;
const ERROR_LINE = /\[(Error|Fatal)\]/;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Sum up a run for the user. `output` is TestPit's raw stdout+stderr, `issues`
 * what parseValidityOutput made of it.
 *
 * "clean" is claimed only when TestPit actually produced a validation log: if
 * the executable could not be started the output holds a shell error (or
 * nothing) and no issues, which must not read as a pass.
 */
export function summarizeValidity(
  output: string,
  issues: readonly ValidityIssue[]
): ValiditySummary {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const lines = output.split(/\r?\n/);
  const problemLines = lines.filter((l) => PROBLEM_LINE.test(l)).length;
  const unlocated = Math.max(0, problemLines - issues.length);
  // An [Error]/[Fatal] TestPit could not tie to a line is still a failed run.
  const errorLines = lines.filter((l) => ERROR_LINE.test(l)).length;
  const unlocatedErrors = Math.min(unlocated, Math.max(0, errorLines - errors));
  const hasLog = lines.some((l) => LOG_LINE.test(l));

  if (!hasLog && issues.length === 0) {
    return {
      outcome: "no-log",
      errors,
      warnings,
      unlocated,
      message:
        "TestPit produced no validation log - the script was NOT checked. See the output channel (is the TestPit executable path correct?).",
    };
  }

  const outcome: ValidityOutcome =
    errors > 0 || unlocatedErrors > 0
      ? "errors"
      : warnings > 0 || unlocated > 0
        ? "warnings"
        : "clean";
  let message: string;
  if (issues.length === 0 && unlocated === 0) {
    message = "TestPit validity check: clean - no errors or warnings.";
  } else {
    const parts: string[] = [];
    if (errors > 0) {
      parts.push(plural(errors, "error"));
    }
    if (warnings > 0) {
      parts.push(plural(warnings, "warning"));
    }
    if (unlocatedErrors > 0) {
      parts.push(
        `${plural(unlocatedErrors, "error")} without a line number (output channel only)`
      );
    }
    if (unlocated > unlocatedErrors) {
      parts.push(
        `${plural(unlocated - unlocatedErrors, "message")} without a line number (output channel only)`
      );
    }
    message = `TestPit validity check: ${parts.join(", ")}.`;
  }
  return { outcome, errors, warnings, unlocated, message };
}
