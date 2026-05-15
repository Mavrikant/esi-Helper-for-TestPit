import * as assert from "assert";
import { toDiagnostic } from "../../lib/toDiagnostic";
import type { ValidityIssue } from "../../lib/parseValidityOutput";

describe("toDiagnostic", () => {
  const baseIssue: ValidityIssue = {
    lineNumber: 5,
    startCol: 2,
    endCol: 20,
    severity: "error",
    message: "something is wrong",
  };

  it("constructs a Range covering the full issue extent", () => {
    const d = toDiagnostic(baseIssue) as any;
    assert.strictEqual(d.range.start.line, 5);
    assert.strictEqual(d.range.start.character, 2);
    assert.strictEqual(d.range.end.line, 5);
    assert.strictEqual(d.range.end.character, 20);
  });

  it("preserves the message verbatim", () => {
    const d = toDiagnostic(baseIssue) as any;
    assert.strictEqual(d.message, "something is wrong");
  });

  it("maps 'error' severity to DiagnosticSeverity.Error (0)", () => {
    const d = toDiagnostic(baseIssue) as any;
    assert.strictEqual(d.severity, 0);
  });

  it("maps 'warning' severity to DiagnosticSeverity.Warning (1)", () => {
    const d = toDiagnostic({ ...baseIssue, severity: "warning" }) as any;
    assert.strictEqual(d.severity, 1);
  });
});
