import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Reads TestPit's per-profile configuration straight out of the Windows
 * registry, where the GUI tool (TestPitw.exe) keeps every "setting" / profile.
 *
 * Layout under HKEY_CURRENT_USER\Software\ESEN\TestPit:
 *   Settings\SettingPrefix          REG_MULTI_SZ — profile names; element [0]
 *                                    is the currently-selected profile, the
 *                                    rest are the other selectable profiles.
 *   <Profile>\Executer\<role>File   REG_MULTI_SZ — element [0] is the live
 *                                    config path; later elements are the GUI's
 *                                    most-recently-used history (ignored here).
 *
 * The console TestPit.exe — the one the plugin runs for validation — does NOT
 * read the registry; it takes config paths as parameters. So we read the
 * registry once (a single `reg export`), cache a slim JSON, and pass the
 * resolved paths on the command line. See pluginStore.ts for the cache.
 */

export const REG_ROOT = "HKEY_CURRENT_USER\\Software\\ESEN\\TestPit";

/** Resolved config-file paths for one profile, keyed by role. */
export interface ProfileConfigs {
  cable?: string; // ConfigFile         → --cf  (MessageConfig_* / *_Cable)
  a429?: string; // A429ConfigFile      → --ac
  m1553?: string; // 1553ConfigFile     → --mc
  discrete?: string; // DiscreteConfigFile  → --dc
  partition?: string; // PartitionConfigFile → --pc (MemoryPorts / NeoCASPorts / …)
  vorils?: string; // VORILSConfigFile   → --vc
  ed?: string; // EDConfigFile          → --edc (External Data)
}

export interface RegistryModel {
  /** Profile names in SettingPrefix order; [0] is the active/default profile. */
  profiles: string[];
  /** SettingPrefix[0] — the profile TestPit's GUI last selected. */
  defaultProfile?: string;
  /** Per-profile resolved config paths (element [0] of each *ConfigFile value). */
  configs: Record<string, ProfileConfigs>;
}

/** Maps a registry value name under <Profile>\Executer to a ProfileConfigs role. */
const VALUE_TO_ROLE: Record<string, keyof ProfileConfigs> = {
  ConfigFile: "cable",
  A429ConfigFile: "a429",
  "1553ConfigFile": "m1553",
  DiscreteConfigFile: "discrete",
  PartitionConfigFile: "partition",
  VORILSConfigFile: "vorils",
  EDConfigFile: "ed",
};

const SETTINGS_SUFFIX = "\\Settings";
const EXECUTER_SUFFIX = "\\Executer";

/**
 * Parse the body of a `reg export` (.reg, "Windows Registry Editor Version
 * 5.00") into the slim model we need. Pure — no fs / registry access — so it's
 * unit-testable against an embedded snippet.
 */
export function parseRegExport(text: string): RegistryModel {
  const model: RegistryModel = { profiles: [], configs: {} };
  // reg export is UTF-16LE with a BOM; readFileSync("utf16le") leaves a
  // leading U+FEFF.
  const clean = text.replace(/^﻿/, "");
  const lines = joinContinuations(clean.split(/\r?\n/));

  let section: string | undefined;
  for (const line of lines) {
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (!section) {
      continue;
    }
    const valueMatch = /^"([^"]+)"=(.+)$/.exec(line);
    if (!valueMatch) {
      continue;
    }
    const [, name, rawValue] = valueMatch;

    if (section.endsWith(SETTINGS_SUFFIX)) {
      if (name === "SettingPrefix") {
        model.profiles = parseValue(rawValue);
        model.defaultProfile = model.profiles[0];
      }
      continue;
    }

    if (section.endsWith(EXECUTER_SUFFIX)) {
      const role = VALUE_TO_ROLE[name];
      if (!role) {
        continue;
      }
      const profile = profileOf(section);
      if (!profile) {
        continue;
      }
      const first = parseValue(rawValue)[0];
      if (first && first.trim().length > 0) {
        (model.configs[profile] ??= {})[role] = first.trim();
      }
    }
  }

  return model;
}

/**
 * Export the TestPit registry subtree and parse it. Returns undefined on any
 * failure (non-Windows, key absent, reg.exe error) — callers treat that as
 * "no profiles available" and fall back to asking the user.
 *
 * `exportRunner` is injectable so tests can supply canned `.reg` text without
 * shelling out to reg.exe.
 */
export function loadRegistryModel(
  exportRunner: () => string = exportTestpitRegistry
): RegistryModel | undefined {
  try {
    const text = exportRunner();
    const model = parseRegExport(text);
    return model.profiles.length > 0 ? model : undefined;
  } catch {
    return undefined;
  }
}

/** Default exporter: `reg export <root> <tmp> /y`, read the UTF-16 file back. */
function exportTestpitRegistry(): string {
  const tmp = path.join(os.tmpdir(), `testpit-reg-${process.pid}.reg`);
  try {
    cp.execFileSync("reg", ["export", REG_ROOT, tmp, "/y"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return fs.readFileSync(tmp, "utf16le");
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup; a stray temp file is harmless.
    }
  }
}

/**
 * Join registry continuation lines. A REG_MULTI_SZ/hex value wraps across
 * lines with a trailing backslash; continuation lines are indented and their
 * leading whitespace is not part of the data.
 */
function joinContinuations(lines: string[]): string[] {
  const out: string[] = [];
  let acc: string | undefined;
  for (const raw of lines) {
    const piece = acc === undefined ? raw : raw.trimStart();
    acc = acc === undefined ? piece : acc + piece;
    if (acc.trimEnd().endsWith("\\")) {
      acc = acc.trimEnd().slice(0, -1);
    } else {
      out.push(acc);
      acc = undefined;
    }
  }
  if (acc !== undefined) {
    out.push(acc);
  }
  return out;
}

/**
 * Decode a registry value's right-hand side into its string element(s).
 * Handles `hex(7):` (REG_MULTI_SZ, UTF-16LE bytes, NUL-separated) and plain
 * quoted REG_SZ. Anything else (dword:, hex:, …) yields an empty list.
 */
function parseValue(rawValue: string): string[] {
  const v = rawValue.trim();
  if (v.startsWith("hex(7):")) {
    return decodeMultiSz(v.slice("hex(7):".length));
  }
  if (v.startsWith('"') && v.endsWith('"')) {
    // REG_SZ: unescape \\ and \" .
    return [v.slice(1, -1).replace(/\\(["\\])/g, "$1")];
  }
  return [];
}

function decodeMultiSz(hexPart: string): string[] {
  const bytes = hexPart
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) => parseInt(b, 16));
  const buf = Buffer.from(bytes);
  const text = buf.toString("utf16le");
  // REG_MULTI_SZ strings are NUL-separated (00,00 in UTF-16LE -> U+0000); the
  // list is terminated by a double NUL, which split + drop-empty discards.
  return text.split(String.fromCharCode(0)).filter((s) => s.length > 0);
}

/** Extract <Profile> from `…\TestPit\<Profile>\Executer`. */
function profileOf(section: string): string | undefined {
  const m = /\\TestPit\\([^\\]+)\\Executer$/.exec(section);
  return m ? m[1] : undefined;
}
