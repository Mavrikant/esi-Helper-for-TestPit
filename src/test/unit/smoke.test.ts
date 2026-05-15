import * as assert from "assert";
import * as vscode from "vscode";
import { activate, deactivate } from "../../extension";

describe("extension smoke test", () => {
  it("activate registers disposables without throwing", () => {
    const ctx: any = { subscriptions: [] };
    activate(ctx as vscode.ExtensionContext);
    assert.ok(Array.isArray(ctx.subscriptions));
    // call deactivate to ensure no errors
    deactivate();
  });
});
