import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { formatEsi } from "./lib/formatEsi";
import { refactorWhitespace } from "./lib/refactorWhitespace";

const ESI_LANGUAGE = "esi";

function getAlignScope(): "section" | "tier" {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>("alignmentScope") === "tier"
    ? "tier"
    : "section";
}

export function registerEsiFormatter(): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(ESI_LANGUAGE, {
    provideDocumentFormattingEdits(document) {
      return computeFormatEdits(document, (t) =>
        formatEsi(t, { alignScope: getAlignScope() })
      );
    },
  });
}

export function registerFormatOnSave(): vscode.Disposable {
  return vscode.workspace.onWillSaveTextDocument((event) => {
    if (event.document.languageId !== ESI_LANGUAGE) {
      return;
    }
    // Tabs → 4 spaces (and trailing-whitespace trim) is forced on every save.
    // The full ESI reformat (re-indent + `=` alignment) only runs when the
    // user has opted in via esihelper.refactorDocumentOnSave.
    const fullFormat = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("refactorDocumentOnSave");
    const transform = fullFormat
      ? (t: string) => formatEsi(t, { alignScope: getAlignScope() })
      : refactorWhitespace;
    const edits = computeFormatEdits(event.document, transform);
    if (edits.length > 0) {
      event.waitUntil(Promise.resolve(edits));
    }
  });
}

function computeFormatEdits(
  document: vscode.TextDocument,
  transform: (text: string) => string = formatEsi
): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = transform(original);
  if (formatted === original) {
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length)
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}
