import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CONFIG_SECTION } from "../constants";
import { getOutputChannel } from "../lib/outputChannel";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { getActiveProjectId, getActiveProject } from "../lib/projectRegistry";
import { CsvLookup, validateComponents } from "../lib/componentValidator";

export function registerShowValidationInfo(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.showValidationInfo",
    () => {
      const ch = getOutputChannel();
      ch.show(true);
      ch.appendLine("=== esi Helper: validation diagnostics ===");

      // Extension version + build identifier so the user can confirm which
      // build is actually loaded.
      const ext = vscode.extensions.getExtension("karamandev.esi-helper-for-testpit");
      const pkg = ext?.packageJSON ?? {};
      ch.appendLine(`Extension:    karamandev.esi-helper-for-testpit @ ${pkg.version ?? "<unknown>"}`);
      ch.appendLine(`Active:       ${ext?.isActive ? "yes" : "no"}`);
      ch.appendLine(`Install path: ${ext?.extensionPath ?? "<unknown>"}`);

      const editor = vscode.window.activeTextEditor;
      ch.appendLine(`Active editor: ${editor?.document.uri.fsPath ?? "<none>"}`);
      ch.appendLine(`Language id:   ${editor?.document.languageId ?? "<none>"}`);

      const projectId = getActiveProjectId();
      const project = getActiveProject();
      ch.appendLine(`Active project (globalState): ${projectId ?? "<unset>"}`);
      ch.appendLine(`Resolved project label:  ${project?.label ?? "<none>"}`);
      ch.appendLine(
        `Resolved configFolderpath: ${project?.configFolderpath ?? "<none>"}`
      );

      const index = getActiveProjectIndex();
      if (!index) {
        ch.appendLine(
          "XmlIndex: <empty> — no active project, or its configFolderpath is missing/unreadable. Pick a project from the status bar to enable validation."
        );
        return;
      }
      ch.appendLine(
        `XmlIndex: ${index.connections.size} connections, ${index.messages.size} messages`
      );

      // Sample a couple of expected names so the user can sanity-check the index loaded the right project.
      const sampleConns = Array.from(index.connections.keys()).slice(0, 5);
      ch.appendLine(`Sample connections: ${sampleConns.join(", ")}`);

      if (!editor || editor.document.languageId !== "esi") {
        ch.appendLine(
          "No active .esi editor — open a .esi file to validate it."
        );
        return;
      }

      // Use the same csvLookup that componentDiagnostics uses, so the
      // numbers in this report match what the user sees as live squiggles.
      const csvLookup = makeCsvLookup(editor.document.uri.fsPath);
      const issues = validateComponents(editor.document.getText(), index, csvLookup);
      ch.appendLine(`Validation result on this file: ${issues.length} issue(s).`);
      for (const issue of issues.slice(0, 20)) {
        ch.appendLine(
          `  line ${issue.line + 1}, col ${issue.startCol + 1}: ${issue.kind} — ${issue.message}`
        );
      }
      if (issues.length > 20) {
        ch.appendLine(`  … and ${issues.length - 20} more.`);
      }

      // Cross-check: the diagnostic collection should contain the same issues
      // VS Code is rendering. If it doesn't, the onDidChange listener didn't
      // run (extension might not have activated, or ${CONFIG_SECTION} setting
      // is wrong).
      const liveDiags = vscode.languages.getDiagnostics(editor.document.uri);
      const ours = liveDiags.filter((d) => d.source === "esi Helper");
      ch.appendLine(
        `Live diagnostics from "esi Helper" on this file: ${ours.length}.`
      );
      if (ours.length !== issues.length) {
        ch.appendLine(
          "  MISMATCH — extension's onDidChange listener may not have fired. Try editing one character and re-checking."
        );
      }
    }
  );
}

/** Same per-call CSV cache used by componentDiagnostics — duplicated here
 *  so the diagnostic command's report matches live squiggles for files
 *  that pull values from .csv fixtures. Trivial enough not to extract. */
function makeCsvLookup(esiFilePath: string): CsvLookup {
  const baseDir = path.dirname(esiFilePath);
  const cache = new Map<string, string[][] | undefined>();
  return (filename, line, col) => {
    const fullPath = path.resolve(baseDir, filename);
    if (!cache.has(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        cache.set(
          fullPath,
          content.split(/\r?\n/).map((row) =>
            row.split(",").map((cell) => {
              let s = cell.trim();
              if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
                s = s.slice(1, -1).replace(/""/g, '"');
              }
              return s;
            })
          )
        );
      } catch {
        cache.set(fullPath, undefined);
      }
    }
    const rows = cache.get(fullPath);
    return rows ? rows[line - 1]?.[col - 1] : undefined;
  };
}
