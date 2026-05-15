import * as vscode from "vscode";
import * as fs from "fs";
import { CONFIG_SECTION } from "../constants";
import { runValidityCheckSync } from "../lib/testpitRunner";
import { getOutputChannel } from "../lib/outputChannel";

export function registerRunValidityCheck(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.runValidityCheck", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const tempFilePath = editor.document.uri.fsPath + ".temp";
    fs.writeFileSync(tempFilePath, editor.document.getText());

    const configFolderpath =
      vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>("testpitConfigFolderpath") ?? "";

    try {
      const output = runValidityCheckSync(configFolderpath, tempFilePath);
      const channel = getOutputChannel();
      channel.clear();
      channel.appendLine(output);
      channel.show(true);
    } finally {
      fs.unlinkSync(tempFilePath);
    }
  });
}
