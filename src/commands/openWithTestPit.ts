import * as vscode from "vscode";
import { runCommandDetached } from "../lib/testpitRunner";
import { ensureTestpitExe } from "../lib/profileRegistry";
import { buildOpenCommand } from "../profiles";

export function registerOpenWithTestPit(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.openWithTestPit",
    // Menus (editor/title, explorer/context) pass the clicked resource; the
    // palette and the CodeLens pass nothing — then it is the active editor.
    async (uri?: vscode.Uri) => {
      const filePath =
        (isUri(uri) ? uri.fsPath : undefined) ??
        vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!filePath) {
        return;
      }
      const exe = await ensureTestpitExe();
      if (!exe) {
        return;
      }
      // The console TestPit.exe can't open a script; buildOpenCommand derives
      // the GUI TestPitw.exe (same folder) and launches it with --ow.
      runCommandDetached(buildOpenCommand(exe, filePath));
    }
  );
}

function isUri(value: unknown): value is vscode.Uri {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.Uri).fsPath === "string"
  );
}
