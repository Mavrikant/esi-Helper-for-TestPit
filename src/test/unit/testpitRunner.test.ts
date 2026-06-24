import * as assert from "assert";

describe("testpitRunner", () => {
  const childProcess = require("child_process");

  beforeEach(() => {
    // spawnSync returns {stdout, stderr}; the runner concatenates them.
    childProcess.spawnSync = (cmd: string) => ({
      stdout: `out:${cmd}`,
      stderr: `err:${cmd}`,
      status: 1, // non-zero: must NOT be treated as failure
    });
    // exec may be called as exec(cmd, cb) or exec(cmd, opts, cb); the runner
    // uses the (cmd, opts, cb) form and reads (err, stdout, stderr).
    childProcess.exec = (cmd: string, optsOrCb?: unknown, cb?: unknown) => {
      const callback = (typeof optsOrCb === "function" ? optsOrCb : cb) as
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      if (callback) {
        callback(new Error("exit 1"), `out:${cmd}`, `err:${cmd}`);
      }
    };
  });

  it("runValidityCheckSync returns stdout+stderr and ignores a non-zero exit", () => {
    delete require.cache[require.resolve("../../lib/testpitRunner")];
    const tr = require("../../lib/testpitRunner");
    const out = tr.runValidityCheckSync("foo --bar=baz");
    assert.strictEqual(out, "out:foo --bar=bazerr:foo --bar=baz");
  });

  it("runValidityCheckAsync returns stdout+stderr even when exec errors", async () => {
    // Clear module cache to ensure the module picks up our overridden exec
    delete require.cache[require.resolve("../../lib/testpitRunner")];
    const tr = require("../../lib/testpitRunner");
    const out = await tr.runValidityCheckAsync("foo --bar=baz");
    assert.strictEqual(out, "out:foo --bar=bazerr:foo --bar=baz");
  });

  it("runCommandDetached calls exec with the verbatim command and does not block", () => {
    let observed = "";
    childProcess.exec = (cmd: string) => {
      observed = cmd;
    };
    const tr = require("../../lib/testpitRunner");
    tr.runCommandDetached("te.exe --ow=somefile.esi");
    assert.strictEqual(observed, "te.exe --ow=somefile.esi");
  });
});
