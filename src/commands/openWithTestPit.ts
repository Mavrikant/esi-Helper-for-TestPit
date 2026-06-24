import * as vscode from "vscode";
import { runCommandDetached } from "../lib/testpitRunner";
import { ensureTestpitExe } from "../lib/profileRegistry";
import { buildOpenCommand } from "../profiles";

export function registerOpenWithTestPit(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "extension.openWithTestPit",
    async () => {
      const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
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
