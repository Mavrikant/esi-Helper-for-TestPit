import * as assert from "assert";
import { parseRegExport, loadRegistryModel } from "../../lib/testpitRegistry";

const NUL = String.fromCharCode(0);

/** Encode strings as a REG_MULTI_SZ `hex(7):` value (UTF-16LE, NUL-separated). */
function multiSz(...values: string[]): string {
  const bytes: number[] = [];
  for (const v of values) {
    for (const b of Buffer.from(v + NUL, "utf16le")) {
      bytes.push(b);
    }
  }
  bytes.push(0, 0); // REG_MULTI_SZ list terminator
  return "hex(7):" + bytes.map((b) => b.toString(16).padStart(2, "0")).join(",");
}

/** Wrap a long value line the way `reg export` does: `\` + newline + indent. */
function wrap(line: string, width = 80): string {
  const eq = line.indexOf("=") + 1;
  const head = line.slice(0, eq);
  const body = line.slice(eq);
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += width) {
    chunks.push(body.slice(i, i + width));
  }
  return head + chunks.join("\\\r\n  ");
}

const ROOT = "HKEY_CURRENT_USER\\Software\\ESEN\\TestPit";

function buildReg(): string {
  return [
    "Windows Registry Editor Version 5.00",
    "",
    `[${ROOT}\\Settings]`,
    `"xAxis"=dword:000001de`,
    `"SettingPrefix"=${multiSz("NEOCASSIM", "VORILS", "RNE")}`,
    "",
    `[${ROOT}\\NEOCASSIM\\Executer]`,
    // First element is live; the second is stale MRU history and must be dropped.
    wrap(
      `"ConfigFile"=${multiSz(
        "C:\\NeoCAS\\Config\\MessageConfig_NeoCASSystemTestCable_HURJET.xml",
        "C:\\old\\stale.xml"
      )}`
    ),
    `"A429ConfigFile"=${multiSz("C:\\NeoCAS\\Config\\A429Messages_HURJET.xml")}`,
    `"PartitionConfigFile"=${multiSz("C:\\NeoCAS\\Config\\NeoCASPorts.xml")}`,
    `"EDConfigFile"=${multiSz("C:\\NeoCAS\\Config\\EDMessageFields.xml")}`,
    // A role present in the registry but empty must be ignored.
    `"1553ConfigFile"=${multiSz("")}`,
    "",
    `[${ROOT}\\VORILS\\Executer]`,
    `"ConfigFile"=${multiSz("D:\\VORILS\\Config\\VORILS_Cable.xml")}`,
    `"DiscreteConfigFile"=${multiSz("D:\\VORILS\\Config\\DiscreteSignals.xml")}`,
    `"PartitionConfigFile"=${multiSz("D:\\VORILS\\Config\\MemoryPorts.xml")}`,
    `"VORILSConfigFile"=${multiSz("D:\\VORILS\\Config\\VORILSMessageFields.xml")}`,
    "",
  ].join("\r\n");
}

describe("testpitRegistry.parseRegExport", () => {
  it("reads SettingPrefix order with [0] as the default profile", () => {
    const m = parseRegExport(buildReg());
    assert.deepStrictEqual(m.profiles, ["NEOCASSIM", "VORILS", "RNE"]);
    assert.strictEqual(m.defaultProfile, "NEOCASSIM");
  });

  it("maps each *ConfigFile value name to its role, taking element [0]", () => {
    const m = parseRegExport(buildReg());
    assert.deepStrictEqual(m.configs.NEOCASSIM, {
      cable: "C:\\NeoCAS\\Config\\MessageConfig_NeoCASSystemTestCable_HURJET.xml",
      a429: "C:\\NeoCAS\\Config\\A429Messages_HURJET.xml",
      partition: "C:\\NeoCAS\\Config\\NeoCASPorts.xml",
      ed: "C:\\NeoCAS\\Config\\EDMessageFields.xml",
    });
  });

  it("drops MRU history (only element [0] survives) and empty roles", () => {
    const m = parseRegExport(buildReg());
    assert.strictEqual(
      m.configs.NEOCASSIM.cable,
      "C:\\NeoCAS\\Config\\MessageConfig_NeoCASSystemTestCable_HURJET.xml"
    );
    assert.ok(!("m1553" in m.configs.NEOCASSIM), "empty 1553 role must be omitted");
  });

  it("parses the VORILS profile's roles independently", () => {
    const m = parseRegExport(buildReg());
    assert.deepStrictEqual(m.configs.VORILS, {
      cable: "D:\\VORILS\\Config\\VORILS_Cable.xml",
      discrete: "D:\\VORILS\\Config\\DiscreteSignals.xml",
      partition: "D:\\VORILS\\Config\\MemoryPorts.xml",
      vorils: "D:\\VORILS\\Config\\VORILSMessageFields.xml",
    });
  });

  it("tolerates a leading UTF-16 BOM", () => {
    const m = parseRegExport("﻿" + buildReg());
    assert.strictEqual(m.defaultProfile, "NEOCASSIM");
  });

  it("returns an empty model for unrelated text", () => {
    const m = parseRegExport("Windows Registry Editor Version 5.00\r\n");
    assert.deepStrictEqual(m.profiles, []);
    assert.deepStrictEqual(m.configs, {});
  });
});

describe("testpitRegistry.loadRegistryModel", () => {
  it("returns the parsed model from an injected exporter", () => {
    const m = loadRegistryModel(() => buildReg());
    assert.ok(m);
    assert.strictEqual(m?.defaultProfile, "NEOCASSIM");
  });

  it("returns undefined when no profiles are found", () => {
    const m = loadRegistryModel(() => "Windows Registry Editor Version 5.00\r\n");
    assert.strictEqual(m, undefined);
  });

  it("returns undefined when the exporter throws (key absent / non-Windows)", () => {
    const m = loadRegistryModel(() => {
      throw new Error("reg.exe: key not found");
    });
    assert.strictEqual(m, undefined);
  });
});
