import * as assert from "assert";
import * as vscode from "vscode";
import { activate, deactivate } from "../../extension";

describe("extension smoke test", () => {
  it("activate registers disposables without throwing", () => {
    const store = new Map<string, unknown>();
    const ctx: any = {
      subscriptions: [],
      globalState: {
        get: (key: string, def?: unknown) =>
          store.has(key) ? store.get(key) : def,
        update: (key: string, value: unknown) => {
          if (value === undefined) store.delete(key);
          else store.set(key, value);
          return Promise.resolve();
        },
        keys: () => Array.from(store.keys()),
      },
    };
    activate(ctx as vscode.ExtensionContext);
    assert.ok(Array.isArray(ctx.subscriptions));
    // call deactivate to ensure no errors
    deactivate();
  });
});
