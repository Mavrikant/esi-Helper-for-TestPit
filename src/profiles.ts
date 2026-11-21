import * as fs from "fs";
import * as path from "path";
import { ProfileConfigs } from "./lib/testpitRegistry";

/**
 * Builds the command lines for the console TestPit.exe.
 *
 * Validation is "preprocess only": `--sf` + the config files the active
 * profile actually has + `--validateScriptOnly=true`. We pass a `--xx=<path>`
 * flag only when that role's path is present AND the file exists on disk —
 * the registry's per-role MRU can hold stale paths for buses a profile no
 * longer uses, and TestPit ignores config types the script doesn't reference,
 * so omitting non-existent ones is safe and avoids file-open errors.
 */

/** role → CLI flag, in a stable emission order. */
const ROLE_FLAGS: ReadonlyArray<readonly [keyof ProfileConfigs, string]> = [
  ["cable", "--cf"],
  ["a429", "--ac"],
  ["m1553", "--mc"],
  ["discrete", "--dc"],
  ["partition", "--pc"],
  ["ed", "--edc"],
  ["vorils", "--vc"],
];

export type FileExists = (p: string) => boolean;

export function buildValidityArgs(
  scriptPath: string,
  configs: ProfileConfigs,
  exists: FileExists = fs.existsSync
): string[] {
  const args = [`--sf=${quote(scriptPath)}`];
  for (const [role, flag] of ROLE_FLAGS) {
    const value = configs[role];
    if (value && exists(value)) {
      args.push(`${flag}=${quote(value)}`);
    }
  }
  args.push("--validateScriptOnly=true");
  return args;
}

export function buildValidityCommand(
  executablePath: string,
  scriptPath: string,
  configs: ProfileConfigs,
  exists: FileExists = fs.existsSync
): string {
  return [
    quoteIfNeeded(executablePath),
    ...buildValidityArgs(scriptPath, configs, exists),
  ].join(" ");
}

/**
 * The console TestPit.exe can't "open" a script; the GUI TestPitw.exe (same
 * folder, by contract) does. Derive its path from the configured console exe.
 */
export function deriveGuiExecutable(consoleExe: string): string {
  const dir = path.dirname(consoleExe);
  const base = path.basename(consoleExe, path.extname(consoleExe)); // "TestPit"
  return path.join(dir, `${base}w.exe`); // "TestPitw.exe"
}

export function buildOpenCommand(consoleExe: string, filePath: string): string {
  return [
    quoteIfNeeded(deriveGuiExecutable(consoleExe)),
    `--ow=${quote(filePath)}`,
  ].join(" ");
}

/** Always wrap a substituted path in quotes (it may contain spaces). */
function quote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * Characters that make cmd.exe (which `exec` runs the command line through)
 * read a bare path as something else: whitespace and the ones `cmd /?` lists
 * as needing quotes, plus the pipe / redirection operators. `D:\R&D\…`
 * unquoted would run `D:\R` and then `D\…`.
 */
const CMD_NEEDS_QUOTES = /[\s&()[\]{}^=;!'+,`~|<>]/;

function quoteIfNeeded(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p;
  }
  return CMD_NEEDS_QUOTES.test(p) ? `"${p}"` : p;
}
