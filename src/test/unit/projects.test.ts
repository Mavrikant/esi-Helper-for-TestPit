import * as assert from "assert";
import {
  buildBuiltInProject,
  buildOpenCommand,
  buildValidityCommand,
  Project,
} from "../../projects";

const RNE_EXE = "C:\\Program Files (x86)\\TestPit\\Tools\\bin\\TestPit.exe";
const RNE_CFG = "D:\\RNE\\product_library\\tools\\TestPit\\Config\\";
const VORILS_CFG = "D:\\263_VORILS\\product_library\\tools\\TestPit\\Config\\";

describe("projects", () => {
  describe("buildBuiltInProject('RNE')", () => {
    const p = buildBuiltInProject("RNE", RNE_EXE, RNE_CFG);

    it("uses the executable path as id and 'RNE' as the label", () => {
      assert.strictEqual(p.id, RNE_EXE);
      assert.strictEqual(p.label, "RNE");
      assert.strictEqual(p.executablePath, RNE_EXE);
    });

    it("emits all the RNE-specific config flags", () => {
      assert.deepStrictEqual(p.validityArgs, [
        `--cf=${RNE_CFG}MessageConfig_RNESystemTestCable.xml`,
        `--ac=${RNE_CFG}A429MessageFields.xml`,
        `--mc=${RNE_CFG}1553MessageFields.xml`,
        `--dc=${RNE_CFG}DiscreteSignals.xml`,
        `--pc=${RNE_CFG}MemoryPorts.xml`,
        "--sf={scriptPath}",
        "--validateScriptOnly=true",
      ]);
    });

    it("does not emit any VORILS-specific flags", () => {
      const joined = p.validityArgs.join(" ");
      assert.ok(!joined.includes("--pt"));
      assert.ok(!joined.includes("--smf"));
      assert.ok(!joined.includes("--vc="));
    });

    it("defaults openArgs to ['--ow={filePath}']", () => {
      assert.deepStrictEqual(p.openArgs, ["--ow={filePath}"]);
    });
  });

  describe("buildBuiltInProject('VORILS')", () => {
    const p = buildBuiltInProject("VORILS", RNE_EXE, VORILS_CFG);

    it("uses the executable path as id and 'VORILS' as the label", () => {
      assert.strictEqual(p.id, RNE_EXE);
      assert.strictEqual(p.label, "VORILS");
      assert.strictEqual(p.executablePath, RNE_EXE);
    });

    it("matches the VORILS command shape from the project spec", () => {
      assert.deepStrictEqual(p.validityArgs, [
        "--sf={scriptPath}",
        "--pt=VORILS",
        `--cf=${VORILS_CFG}VORILS_Cable.xml`,
        `--dc=${VORILS_CFG}DiscreteSignals.xml`,
        `--pc=${VORILS_CFG}MemoryPorts.xml`,
        "--smf=true",
        `--vc=${VORILS_CFG}VORILSMessageFields.xml`,
        "--validateScriptOnly=true",
      ]);
    });

    it("does not emit any RNE-specific flags (--ac, --mc)", () => {
      const joined = p.validityArgs.join(" ");
      assert.ok(!joined.includes("--ac="));
      assert.ok(!joined.includes("--mc="));
    });
  });

  describe("buildValidityCommand", () => {
    it("substitutes {scriptPath} and double-quotes it", () => {
      const project = buildBuiltInProject("RNE", RNE_EXE, RNE_CFG);
      const cmd = buildValidityCommand(project, "C:\\scripts\\foo.esi");
      assert.ok(cmd.includes('--sf="C:\\scripts\\foo.esi"'));
    });

    it("quotes an executable path that contains spaces", () => {
      const project = buildBuiltInProject("RNE", RNE_EXE, RNE_CFG);
      const cmd = buildValidityCommand(project, "x.esi");
      assert.ok(cmd.startsWith(`"${RNE_EXE}" `));
    });

    it("does not double-quote an already-quoted executable", () => {
      const project: Project = {
        id: "X",
        label: "X",
        executablePath: `"${RNE_EXE}"`,
        validityArgs: ["--sf={scriptPath}"],
        openArgs: [],
      };
      const cmd = buildValidityCommand(project, "x.esi");
      assert.ok(cmd.startsWith(`"${RNE_EXE}" `));
      assert.ok(!cmd.startsWith(`""`));
    });

    it("does not quote an executable path without spaces", () => {
      const project: Project = {
        id: "X",
        label: "X",
        executablePath: "C:\\tools\\testpit.exe",
        validityArgs: ["--sf={scriptPath}"],
        openArgs: [],
      };
      const cmd = buildValidityCommand(project, "x.esi");
      assert.strictEqual(cmd, 'C:\\tools\\testpit.exe --sf="x.esi"');
    });

    it("renders a fully custom project verbatim with substitution", () => {
      const project: Project = {
        id: "MYPROJ",
        label: "My Project",
        executablePath: "C:\\Tools\\custom.exe",
        validityArgs: ["--cfg=foo", "--sf={scriptPath}", "--validate=true"],
        openArgs: [],
      };
      const cmd = buildValidityCommand(project, "x.esi");
      assert.strictEqual(
        cmd,
        'C:\\Tools\\custom.exe --cfg=foo --sf="x.esi" --validate=true'
      );
    });

    it("leaves args without a placeholder unchanged", () => {
      const project: Project = {
        id: "X",
        label: "X",
        executablePath: "te.exe",
        validityArgs: ["--literal=value"],
        openArgs: [],
      };
      assert.strictEqual(buildValidityCommand(project, "x"), "te.exe --literal=value");
    });
  });

  describe("buildOpenCommand", () => {
    it("substitutes {filePath} and double-quotes it", () => {
      const project = buildBuiltInProject("RNE", RNE_EXE, RNE_CFG);
      const cmd = buildOpenCommand(project, "C:\\scripts\\foo.esi");
      assert.ok(cmd.endsWith('--ow="C:\\scripts\\foo.esi"'));
    });

    it("falls back to the default open template when openArgs is empty", () => {
      const project: Project = {
        id: "X",
        label: "X",
        executablePath: "te.exe",
        validityArgs: [],
        openArgs: [],
      };
      const cmd = buildOpenCommand(project, "x.esi");
      assert.strictEqual(cmd, 'te.exe --ow="x.esi"');
    });

    it("respects a custom openArgs template", () => {
      const project: Project = {
        id: "X",
        label: "X",
        executablePath: "te.exe",
        validityArgs: [],
        openArgs: ["--open={filePath}", "--mode=read"],
      };
      const cmd = buildOpenCommand(project, "x.esi");
      assert.strictEqual(cmd, 'te.exe --open="x.esi" --mode=read');
    });
  });
});
