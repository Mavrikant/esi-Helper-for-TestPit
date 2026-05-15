import * as assert from "assert";

describe("testpitRunner", () => {
  const childProcess = require("child_process");

  beforeEach(() => {
    childProcess.execSync = (cmd: string) => Buffer.from(`ran:${cmd}`);
    childProcess.exec = (cmd: string, cb?: (err: Error | null, res: { stdout: string }) => void) => {
      if (cb) {
        cb(null, { stdout: `ran:${cmd}` });
      }
    };
  });

  it("runValidityCheckSync returns the exec output for the given command", () => {
    const tr = require("../../lib/testpitRunner");
    const out = tr.runValidityCheckSync("foo --bar=baz");
    assert.strictEqual(out, "ran:foo --bar=baz");
  });

  it("runValidityCheckAsync returns the exec output for the given command", async () => {
    const tr = require("../../lib/testpitRunner");
    const out = await tr.runValidityCheckAsync("foo --bar=baz");
    assert.strictEqual(out, "ran:foo --bar=baz");
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
