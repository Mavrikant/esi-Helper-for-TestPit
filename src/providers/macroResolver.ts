import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveScriptRelative } from "../lib/fileRefs";
import { IncludedFile, MacroResolver } from "../lib/macros";

/**
 * The fs / editor side of lib/macros.ts: reads the file an
 * `include file = <path>` names.
 *
 * The path is taken relative to the folder of the file that holds the
 * `[INCLUDE]` (an absolute path is used as is). TestPit's own rule is not
 * known to this extension — when the file is not found there, the include
 * counts as unresolved and the macro checks stand down, so a wrong guess can
 * only silence a diagnostic, never raise one.
 *
 * An included file that is open in an editor is read from the editor (unsaved
 * edits count); otherwise from disk, cached by modification time.
 */
const diskCache = new Map<string, { mtimeMs: number; text: string }>();

function readText(fullPath: string): string | undefined {
  const lower = fullPath.toLowerCase();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.fsPath && doc.uri.fsPath.toLowerCase() === lower) {
      return doc.getText();
    }
  }
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return undefined;
    }
    const hit = diskCache.get(fullPath);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      return hit.text;
    }
    const text = fs.readFileSync(fullPath, "utf-8");
    diskCache.set(fullPath, { mtimeMs: stat.mtimeMs, text });
    return text;
  } catch {
    return undefined;
  }
}

export function createMacroResolver(document: vscode.TextDocument): MacroResolver {
  const selfPath = document.uri.fsPath;
  if (!selfPath) {
    // Untitled document: includes cannot be located, so they stay unresolved.
    return {};
  }
  const selfKey = path.resolve(selfPath);
  return {
    selfKey,
    readInclude(includePath, fromKey): IncludedFile | undefined {
      // The ONE resolve-relative-to-the-script rule (lib/fileRefs.ts), shared
      // with CSV refs and document links; it accepts both slash styles.
      const fullPath = resolveScriptRelative(fromKey ?? selfKey, includePath);
      if (fullPath === selfKey) {
        return { key: selfKey, text: document.getText() };
      }
      const text = readText(fullPath);
      return text === undefined ? undefined : { key: fullPath, text };
    },
  };
}

/** File name rather than a full path, for hover / completion. */
export function macroFileLabel(key: string): string {
  return path.basename(key);
}
