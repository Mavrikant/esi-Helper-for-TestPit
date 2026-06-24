import * as vscode from "vscode";
import { parseValidityOutput } from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";
import { toDiagnostic } from "./lib/toDiagnostic";
import { withTempScript } from "./lib/withTempScript";
import { getActiveConfigs, getTestpitExe } from "./lib/profileRegistry";
import { buildValidityCommand } from "./profiles";

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
    if (!editor || editor.document.languageId !== "esi") {
      return;
    }
    // Live (per-keystroke) path: never prompt for the exe — silently skip if
    // it isn't configured yet. The explicit "Run Validity Check" command
    // prompts via ensureTestpitExe instead.
    const exe = getTestpitExe();
    if (!exe) {
      return;
    }
    const uri = editor.document.uri;
    const collection = getOrCreateCollection(uri);
    collection.clear();

    const documentText = editor.document.getText();
    await withTempScript(editor.document.uri.fsPath, documentText, async (tempPath) => {
      const command = buildValidityCommand(exe, tempPath, getActiveConfigs());
      const output = await runValidityCheckAsync(command);
      const issues = parseValidityOutput(output, documentText.split(/\r?\n/));
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
