import * as vscode from "vscode";
import * as fs from "fs";
import { CONFIG_SECTION } from "./constants";
import {
  ValidityIssue,
  parseValidityOutput,
} from "./lib/parseValidityOutput";
import { runValidityCheckAsync } from "./lib/testpitRunner";

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

    const tempFilePath = editor.document.uri.fsPath + ".temp";
    fs.writeFileSync(tempFilePath, editor.document.getText());
    try {
      const output = await runValidityCheckAsync(configFolderpath, tempFilePath);
      const issues = parseValidityOutput(output, editor.document.getText().split("\n"));
      collection.set(uri, issues.map(toDiagnostic));
    } finally {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // ignore
      }
    }
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

function toDiagnostic(issue: ValidityIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.lineNumber,
    issue.startCol,
    issue.lineNumber,
    issue.endCol
  );
  const severity =
    issue.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error;
  return new vscode.Diagnostic(range, issue.message, severity);
}
