import * as vscode from "vscode";
import { runValidityCheckForDocument } from "../diagnostics";
import { getOutputChannel } from "../lib/outputChannel";
import { summarizeValidity } from "../lib/validityResults";
import { ensureTestpitExe, getActiveProfileName } from "../lib/profileRegistry";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.runValidityCheck",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const document = editor.document;
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
