import * as vscode from "vscode";
import { runValidityCheckForDocument } from "../diagnostics";
import { getOutputChannel } from "../lib/outputChannel";
import { summarizeValidity } from "../lib/validityResults";
import { ensureTestpitExe, getActiveProfileName } from "../lib/profileRegistry";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.runValidityCheck",
    // Menus (editor/title, editor/context) pass the resource they were
    // invoked on — the title button of an unfocused editor group must check
    // THAT file. The palette and the CodeLens pass nothing: active editor.
    async (uri?: vscode.Uri) => {
      const document = await resolveDocument(uri);
      if (!document) {
        return;
      }
      const exe = await ensureTestpitExe();
      if (!exe) {
        return;
      }
      const channel = getOutputChannel();
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Running TestPit validity check…",
          cancellable: false,
        },
        () =>
          runValidityCheckForDocument(document, exe, {
            onCommand: (command) => {
              channel.clear();
              channel.appendLine(`[profile]   ${getActiveProfileName() ?? "<none>"}`);
              channel.appendLine(`[script]    ${document.uri.fsPath}`);
              channel.appendLine(
                "[temp copy] validated against a temp copy of the current buffer (see --sf below)"
              );
              channel.appendLine(`[command]   ${command}`);
              channel.appendLine("");
              channel.appendLine("--- TestPit output ---");
            },
          })
      );
      channel.appendLine(result.output);
      channel.show(true);

      const summary = summarizeValidity(result.output, result.issues);
      if (summary.outcome === "clean") {
        void vscode.window.showInformationMessage(summary.message);
      } else if (summary.outcome === "warnings") {
        void vscode.window.showWarningMessage(summary.message);
      } else {
        void vscode.window.showErrorMessage(summary.message);
      }
    }
  );
}

async function resolveDocument(
  uri: vscode.Uri | undefined
): Promise<vscode.TextDocument | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (
    typeof uri !== "object" ||
    uri === null ||
    typeof uri.fsPath !== "string" ||
    uri.toString() === active?.uri.toString()
  ) {
    return active;
  }
  // Already-open buffer (unsaved edits included) or, failing that, from disk.
  return vscode.workspace.openTextDocument(uri);
}
