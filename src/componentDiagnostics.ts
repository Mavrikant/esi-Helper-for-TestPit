import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { BUILT_IN_IDS } from "./projects";
import {
  ComponentIssue,
  validateComponents,
} from "./lib/componentValidator";
import { getActiveProjectIndex } from "./lib/projectIndexCache";

const COLLECTION_NAME = "esi-components";

export function registerComponentDiagnostics(): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);

  const validateAndPublish = (document: vscode.TextDocument): void => {
    if (document.languageId !== "esi") {
      return;
    }
    const index = getActiveProjectIndex();
    if (!index) {
      collection.delete(document.uri);
      return;
    }
    const issues = validateComponents(document.getText(), index);
    collection.set(document.uri, issues.map(toDiagnostic));
  };

  // Initial pass for any .esi files already open.
  for (const doc of vscode.workspace.textDocuments) {
    validateAndPublish(doc);
  }

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    validateAndPublish(event.document);
  });
  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    validateAndPublish(doc);
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    collection.delete(doc.uri);
  });

  // When the active project / configFolderpath / customProjects changes, the
  // index reloads — re-validate every open .esi document so warnings catch up.
  const watchedKeys = [
    `${CONFIG_SECTION}.activeProject`,
    `${CONFIG_SECTION}.customProjects`,
    ...BUILT_IN_IDS.flatMap((id) => [
      `${CONFIG_SECTION}.${id}.executablePath`,
      `${CONFIG_SECTION}.${id}.configFolderpath`,
    ]),
  ];
  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!watchedKeys.some((key) => event.affectsConfiguration(key))) {
      return;
    }
    for (const doc of vscode.workspace.textDocuments) {
      validateAndPublish(doc);
    }
  });

  return vscode.Disposable.from(
    collection,
    onChange,
    onOpen,
    onClose,
    onConfigChange
  );
}

function toDiagnostic(issue: ComponentIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.line,
    issue.startCol,
    issue.line,
    issue.endCol
  );
  const diag = new vscode.Diagnostic(
    range,
    issue.message,
    vscode.DiagnosticSeverity.Warning
  );
  diag.source = "esi Helper";
  diag.code = issue.kind;
  return diag;
}
