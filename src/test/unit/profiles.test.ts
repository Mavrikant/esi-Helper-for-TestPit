import * as assert from "assert";
import {
  buildValidityArgs,
  buildValidityCommand,
  buildOpenCommand,
  deriveGuiExecutable,
} from "../../profiles";
import { ProfileConfigs } from "../../lib/testpitRegistry";

const allExist = () => true;

describe("profiles.buildValidityArgs", () => {
  it("emits --sf, role flags, and the validate flag in order", () => {
    const cfg: ProfileConfigs = {
      cable: "C:\\cfg\\cable.xml",
      a429: "C:\\cfg\\a429.xml",
      discrete: "C:\\cfg\\dis.xml",
      partition: "C:\\cfg\\ports.xml",
      vorils: "C:\\cfg\\vorils.xml",
    };
    const args = buildValidityArgs("C:\\s\\test.esi", cfg, allExist);
    assert.deepStrictEqual(args, [
      '--sf="C:\\s\\test.esi"',
      '--cf="C:\\cfg\\cable.xml"',
      '--ac="C:\\cfg\\a429.xml"',
      '--dc="C:\\cfg\\dis.xml"',
      '--pc="C:\\cfg\\ports.xml"',
      '--vc="C:\\cfg\\vorils.xml"',
      "--validateScriptOnly=true",
    ]);
  });

  it("maps ed role to --edc and m1553 to --mc", () => {
    const cfg: ProfileConfigs = { m1553: "C:\\m.xml", ed: "C:\\e.xml" };
    const args = buildValidityArgs("s.esi", cfg, allExist);
    assert.ok(args.includes('--mc="C:\\m.xml"'));
    assert.ok(args.includes('--edc="C:\\e.xml"'));
  });

  it("omits roles whose file does not exist on disk", () => {
    const cfg: ProfileConfigs = {
      cable: "C:\\real.xml",
      a429: "C:\\stale.xml",
    };
    const exists = (p: string) => p === "C:\\real.xml";
    const args = buildValidityArgs("s.esi", cfg, exists);
    assert.ok(args.includes('--cf="C:\\real.xml"'));
    assert.ok(!args.some((a) => a.startsWith("--ac=")), "stale a429 must be omitted");
  });

  it("emits only --sf and the validate flag when no configs resolve", () => {
    const args = buildValidityArgs("s.esi", {}, allExist);
    assert.deepStrictEqual(args, ['--sf="s.esi"', "--validateScriptOnly=true"]);
  });
});

describe("profiles.buildValidityCommand", () => {
  it("quotes an executable path containing spaces", () => {
    const cmd = buildValidityCommand(
      "C:\\Program Files\\TestPit\\TestPit.exe",
      "s.esi",
      {},
      allExist
    );
    assert.ok(cmd.startsWith('"C:\\Program Files\\TestPit\\TestPit.exe" --sf="s.esi"'));
  });

  it("leaves a space-free executable unquoted", () => {
    const cmd = buildValidityCommand("C:\\t\\TestPit.exe", "s.esi", {}, allExist);
    assert.ok(cmd.startsWith("C:\\t\\TestPit.exe --sf="));
  });
});

describe("profiles.deriveGuiExecutable", () => {
  it("maps TestPit.exe to TestPitw.exe in the same folder", () => {
    assert.strictEqual(
      deriveGuiExecutable("C:\\tools\\Bin\\x64\\TestPit.exe"),
      "C:\\tools\\Bin\\x64\\TestPitw.exe"
    );
  });
});

describe("profiles.buildOpenCommand", () => {
  it("launches the derived GUI exe with --ow", () => {
    const cmd = buildOpenCommand("C:\\t\\TestPit.exe", "C:\\s\\test.esi");
    assert.strictEqual(cmd, 'C:\\t\\TestPitw.exe --ow="C:\\s\\test.esi"');
  });
});
