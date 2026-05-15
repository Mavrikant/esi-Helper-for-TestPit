import * as assert from "assert";

describe("testpitRunner", () => {
  const childProcess = require("child_process");

  beforeEach(() => {
    childProcess._lastCmd = undefined;
    childProcess.execSync = (cmd: string) => Buffer.from(`ran:${cmd}`);
    childProcess.exec = (cmd: string, cb: any) => cb(null, { stdout: `ran:${cmd}` });
  });

  it("buildValidityCommand includes expected flags", () => {
    const tr = require("../../lib/testpitRunner");
    const cmd = tr.buildValidityCommand("C:\\cfg\\", "script.esi");
    assert.ok(cmd.includes("--cf=C:\\cfg\\MessageConfig_RNESystemTestCable.xml"));
    assert.ok(cmd.includes('--sf="script.esi"'));
  });

  it("runValidityCheckSync returns exec output", () => {
    const tr = require("../../lib/testpitRunner");
    const out = tr.runValidityCheckSync("C:\\cfg\\", "script.esi");
    assert.ok(out.startsWith("ran:"));
  });

  it("runValidityCheckAsync returns exec output", async () => {
    const tr = require("../../lib/testpitRunner");
    const out = await tr.runValidityCheckAsync("C:\\cfg\\", "script.esi");
    assert.ok(out.startsWith("ran:"));
  });

  it("openInTestPit calls exec with --ow=", () => {
    let calledCmd = "";
    childProcess.exec = (cmd: string) => {
      calledCmd = cmd;
    };
    const tr = require("../../lib/testpitRunner");
    tr.openInTestPit("somefile.esi");
    assert.ok(calledCmd.includes("--ow=somefile.esi"));
  });
});
