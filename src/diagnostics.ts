import * as vscode from "vscode";
import { parseValidityOutput } from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";
import { toDiagnostic } from "./lib/toDiagnostic";
import { withTempScript } from "./lib/withTempScript";
import { getActiveProject } from "./lib/projectRegistry";
import { buildValidityCommand } from "./projects";

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
    const project = getActiveProject();
    if (!project) {
      return;
    }
    const uri = editor.document.uri;
    const collection = getOrCreateCollection(uri);
    collection.clear();

    const documentText = editor.document.getText();
    await withTempScript(editor.document.uri.fsPath, documentText, async (tempPath) => {
      const command = buildValidityCommand(project, tempPath);
      const output = await runValidityCheckAsync(command);
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
