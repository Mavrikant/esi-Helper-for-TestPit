import * as assert from "assert";
import {
  DEFAULT_LIVE_VALIDATION_DELAY_MS,
  MAX_LIVE_VALIDATION_DELAY_MS,
  MIN_LIVE_VALIDATION_DELAY_MS,
  normalizeLiveValidation,
  normalizeLiveValidationDelay,
} from "../../lib/liveValidationSettings";

describe("liveValidationSettings", () => {
  it("delay: unset or non-numeric falls back to the default", () => {
    for (const raw of [undefined, null, "600", NaN, Infinity, {}, true]) {
      assert.strictEqual(
        normalizeLiveValidationDelay(raw),
        DEFAULT_LIVE_VALIDATION_DELAY_MS
      );
    }
  });

  it("delay: clamps to the minimum and maximum, rounds fractions", () => {
    assert.strictEqual(normalizeLiveValidationDelay(0), MIN_LIVE_VALIDATION_DELAY_MS);
    assert.strictEqual(normalizeLiveValidationDelay(-5), MIN_LIVE_VALIDATION_DELAY_MS);
    assert.strictEqual(
      normalizeLiveValidationDelay(1e9),
      MAX_LIVE_VALIDATION_DELAY_MS
    );
    assert.strictEqual(normalizeLiveValidationDelay(1500), 1500);
    assert.strictEqual(normalizeLiveValidationDelay(750.6), 751);
  });

  it("the default lies inside the allowed range", () => {
    assert.ok(DEFAULT_LIVE_VALIDATION_DELAY_MS >= MIN_LIVE_VALIDATION_DELAY_MS);
    assert.ok(DEFAULT_LIVE_VALIDATION_DELAY_MS <= MAX_LIVE_VALIDATION_DELAY_MS);
  });

  it("liveValidation: only an explicit false turns it off", () => {
    assert.strictEqual(normalizeLiveValidation(undefined), true);
    assert.strictEqual(normalizeLiveValidation(true), true);
    assert.strictEqual(normalizeLiveValidation("false"), true);
    assert.strictEqual(normalizeLiveValidation(false), false);
  });
});
