import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { parseValidityOutput } from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";
import { toDiagnostic } from "./lib/toDiagnostic";
import { withTempScript } from "./lib/withTempScript";

const diagnosticCollections = new Map<string, vscode.DiagnosticCollection>();
let isUpdating = false;

export function registerLiveDiagnostics(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument(handleDocumentChange);
}

async function handleDocumentChange(): Promise<void> {
  if (isUpdating) {
    return;
  }
  isUpdating = true;
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const uri = editor.document.uri;
    const collection = getOrCreateCollection(uri);
    collection.clear();

    const configFolderpath = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>("testpitConfigFolderpath");
    if (!configFolderpath) {
      return;
    }

    const documentText = editor.document.getText();
    await withTempScript(editor.document.uri.fsPath, documentText, async (tempPath) => {
      const output = await runValidityCheckAsync(configFolderpath, tempPath);
      const issues = parseValidityOutput(output, documentText.split("\n"));
      collection.set(uri, issues.map(toDiagnostic));
    });
  } catch (error) {
    console.error("Error in onDidChangeTextDocument:", error);
  } finally {
    isUpdating = false;
  }
}

function getOrCreateCollection(uri: vscode.Uri): vscode.DiagnosticCollection {
  const key = uri.toString();
  let collection = diagnosticCollections.get(key);
  if (!collection) {
    collection = vscode.languages.createDiagnosticCollection(key);
    diagnosticCollections.set(key, collection);
  }
  return collection;
}
