import * as assert from "assert";

describe("outputChannel", () => {
  const vscode = require("vscode");

  beforeEach(() => {
    // stub createOutputChannel
    vscode.window = vscode.window || {};
    vscode.window.createOutputChannel = (name: string) => ({
      name,
      append: () => {},
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {},
    });
    // remove module cache for the target module so it picks up the stub
    delete require.cache[require.resolve("../../lib/outputChannel")];
  });

  it("returns a singleton output channel instance", () => {
    const oc = require("../../lib/outputChannel");
    const a = oc.getOutputChannel();
    const b = oc.getOutputChannel();
    assert.strictEqual(a, b);
  });
});
