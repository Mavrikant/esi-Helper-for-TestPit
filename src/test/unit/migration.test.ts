import * as assert from "assert";
import { planMigration } from "../../lib/migration";

describe("planMigration", () => {
  it("short-circuits when migration has already been completed", () => {
    const actions = planMigration(
      { workspaceValue: "RNE", workspaceFolderValue: "VORILS", globalValue: "X" },
      true
    );
    assert.deepStrictEqual(actions, { clearScopes: [], markDone: false });
  });

  it("short-circuits when inspect is undefined", () => {
    const actions = planMigration(undefined, false);
    assert.deepStrictEqual(actions, { clearScopes: [], markDone: false });
  });

  it("returns no-op when inspect is empty", () => {
    const actions = planMigration({}, false);
    assert.deepStrictEqual(actions, { clearScopes: [], markDone: false });
  });

  it("migrates workspaceValue when only workspaceValue is set", () => {
    const actions = planMigration({ workspaceValue: "RNE" }, false);
    assert.deepStrictEqual(actions, {
      writeId: "RNE",
      clearScopes: ["workspace"],
      markDone: true,
    });
  });

  it("migrates workspaceFolderValue when only workspaceFolderValue is set", () => {
    const actions = planMigration({ workspaceFolderValue: "VORILS" }, false);
    assert.deepStrictEqual(actions, {
      writeId: "VORILS",
      clearScopes: ["workspaceFolder"],
      markDone: true,
    });
  });

  it("migrates globalValue when only globalValue is set", () => {
    const actions = planMigration({ globalValue: "CUSTOM" }, false);
    assert.deepStrictEqual(actions, {
      writeId: "CUSTOM",
      clearScopes: ["global"],
      markDone: true,
    });
  });

  it("prefers workspaceFolderValue over workspaceValue and globalValue", () => {
    const actions = planMigration(
      {
        workspaceFolderValue: "VORILS",
        workspaceValue: "RNE",
        globalValue: "CUSTOM",
      },
      false
    );
    assert.strictEqual(actions.writeId, "VORILS");
    assert.deepStrictEqual(actions.clearScopes.sort(), [
      "global",
      "workspace",
      "workspaceFolder",
    ]);
    assert.strictEqual(actions.markDone, true);
  });

  it("prefers workspaceValue over globalValue when workspaceFolderValue is unset", () => {
    const actions = planMigration(
      { workspaceValue: "RNE", globalValue: "CUSTOM" },
      false
    );
    assert.strictEqual(actions.writeId, "RNE");
    assert.deepStrictEqual(actions.clearScopes.sort(), ["global", "workspace"]);
    assert.strictEqual(actions.markDone, true);
  });

  it("treats empty string as no value but still records the scope as populated", () => {
    // VS Code's inspect can return an empty string distinct from undefined.
    // The user effectively has nothing meaningful to migrate, but we still
    // clear the scope so the property doesn't linger in settings.json.
    const actions = planMigration({ workspaceValue: "" }, false);
    assert.strictEqual(actions.writeId, undefined);
    assert.deepStrictEqual(actions.clearScopes, ["workspace"]);
    assert.strictEqual(actions.markDone, true);
  });

  it("clearScopes lists exactly the populated scopes in canonical order", () => {
    const actions = planMigration(
      { workspaceValue: "RNE", globalValue: "CUSTOM" },
      false
    );
    assert.deepStrictEqual(actions.clearScopes, ["workspace", "global"]);
  });

  it("does not include workspaceFolder in clearScopes when only workspaceValue is set", () => {
    const actions = planMigration({ workspaceValue: "RNE" }, false);
    assert.ok(!actions.clearScopes.includes("workspaceFolder"));
  });
});
