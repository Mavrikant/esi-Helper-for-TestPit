// The two user settings of the live TestPit.exe check, normalized. vscode-free:
// the caller reads the raw values from the "esihelper" configuration section.

/** Setting keys, relative to the "esihelper" section. */
export const LIVE_VALIDATION_KEY = "liveValidation";
export const LIVE_VALIDATION_DELAY_KEY = "liveValidationDelay";

export const DEFAULT_LIVE_VALIDATION_DELAY_MS = 600;
/** Below this every short typing pause would start a TestPit.exe process. */
export const MIN_LIVE_VALIDATION_DELAY_MS = 200;
export const MAX_LIVE_VALIDATION_DELAY_MS = 10000;

/**
 * Quiet period (ms) before TestPit.exe starts. Anything that is not a finite
 * number falls back to the default; numbers are rounded and clamped to
 * [MIN, MAX] — settings.json can hold any value, whatever the schema says.
 */
export function normalizeLiveValidationDelay(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_LIVE_VALIDATION_DELAY_MS;
  }
  return Math.min(
    MAX_LIVE_VALIDATION_DELAY_MS,
    Math.max(MIN_LIVE_VALIDATION_DELAY_MS, Math.round(raw))
  );
}

/** On unless explicitly set to boolean `false` (the default is true). */
export function normalizeLiveValidation(raw: unknown): boolean {
  return raw !== false;
}
