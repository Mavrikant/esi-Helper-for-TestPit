import * as assert from "assert";
import {
  countSeverities,
  renderValidationStatus,
} from "../../lib/validationStatus";

describe("validationStatus", () => {
  it("counts errors and warnings, ignoring info and hints", () => {
    assert.deepStrictEqual(countSeverities([0, 1, 1, 2, 3, 0, 0]), {
      errors: 3,
      warnings: 2,
    });
    assert.deepStrictEqual(countSeverities([]), { errors: 0, warnings: 0 });
  });

  it("shows a spinner while TestPit runs, whatever the counts", () => {
    const s = renderValidationStatus({
      running: true,
      errors: 4,
      warnings: 2,
      liveCheck: "live",
    });
    assert.strictEqual(s.text, "$(sync~spin) validating…");
    assert.match(s.tooltip, /TestPit\.exe is checking/);
  });

  it("shows the counts otherwise", () => {
    const s = renderValidationStatus({
      running: false,
      errors: 1,
      warnings: 2,
      liveCheck: "live",
    });
    assert.strictEqual(s.text, "$(error) 1 $(warning) 2");
    assert.match(s.tooltip, /^1 error, 2 warnings reported/);
    assert.ok(!s.tooltip.includes("\n"));
  });

  it("never renders zero problems as a pass mark", () => {
    const s = renderValidationStatus({
      running: false,
      errors: 0,
      warnings: 0,
      liveCheck: "live",
    });
    assert.strictEqual(s.text, "$(error) 0 $(warning) 0");
    assert.ok(!/check|pass/i.test(s.text));
  });

  it("says when the TestPit part of the counts is missing or stale", () => {
    const off = renderValidationStatus({
      running: false,
      errors: 0,
      warnings: 0,
      liveCheck: "disabled",
    });
    assert.match(off.tooltip, /esihelper\.liveValidation/);
    const noExe = renderValidationStatus({
      running: false,
      errors: 0,
      warnings: 0,
      liveCheck: "no-exe",
    });
    assert.match(noExe.tooltip, /No TestPit executable/);
  });
});
