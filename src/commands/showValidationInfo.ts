import * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { getOutputChannel } from "../lib/outputChannel";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { getActiveProjectId, getActiveProject } from "../lib/projectRegistry";
import { validateComponents } from "../lib/componentValidator";

export function registerShowValidationInfo(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.showValidationInfo",
    () => {
      const ch = getOutputChannel();
      ch.show(true);
      ch.appendLine("=== esi Helper: validation diagnostics ===");

      const editor = vscode.window.activeTextEditor;
      ch.appendLine(`Active editor: ${editor?.document.uri.fsPath ?? "<none>"}`);
      ch.appendLine(`Language id:   ${editor?.document.languageId ?? "<none>"}`);

      const projectId = getActiveProjectId();
      const project = getActiveProject();
      ch.appendLine(`esihelper.activeProject: ${projectId ?? "<unset>"}`);
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

      const issues = validateComponents(editor.document.getText(), index);
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
