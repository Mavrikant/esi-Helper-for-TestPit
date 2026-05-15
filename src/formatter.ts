import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { formatEsi } from "./lib/formatEsi";

const ESI_LANGUAGE = "esi";

export function registerEsiFormatter(): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(ESI_LANGUAGE, {
    provideDocumentFormattingEdits(document) {
      return computeFormatEdits(document);
    },
  });
}

export function registerFormatOnSave(): vscode.Disposable {
  return vscode.workspace.onWillSaveTextDocument((event) => {
    if (event.document.languageId !== ESI_LANGUAGE) {
      return;
    }
    const enabled = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("refactorDocumentOnSave");
    if (!enabled) {
      return;
    }
    const edits = computeFormatEdits(event.document);
    if (edits.length > 0) {
      event.waitUntil(Promise.resolve(edits));
    }
  });
}

function computeFormatEdits(document: vscode.TextDocument): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = formatEsi(original);
  if (formatted === original) {
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length)
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}
