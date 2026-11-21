import * as vscode from "vscode";
import * as path from "path";
import { createCsvCellLookup } from "./lib/csv";
import { EsiIssue, collectEsiIssues, issueSeverity } from "./lib/workspaceValidation";
import {
  createMacroResolver,
  createOutsideIncludeWatchers,
  includeIdentity,
} from "./providers/macroResolver";
import { getActiveProjectIndex, onIndexChanged } from "./lib/projectIndexCache";
import { getOutputChannel } from "./lib/outputChannel";

const COLLECTION_NAME = "esi-components";
const ESI_GLOB = "**/*.esi";
/**
 * Quiet period before the scripts that include a changed file are checked
 * again (a trailing debounce): typing in an included file must not re-run all
 * of them per key, nor every few keys.
 */
export const INCLUDER_DELAY_MS = 300;

export function registerComponentDiagnostics(): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  // Per-document log throttling — only log to the output channel when the
  // warning count actually changes, otherwise typing in a 13k-line .esi
  // would flood the panel.
  const lastLoggedCount = new Map<string, number>();
  // Per open document (uri string): the files its last pass read through
  // `include file` (includeIdentity of each, read or not → its full path).
  // The %MACRO% checks of a root script depend on their text too.
  const includesOf = new Map<string, Map<string, string>>();

  const validateAndPublish = (document: vscode.TextDocument): void => {
    if (document.languageId !== "esi") {
      return;
    }
    const text = document.getText();
    // ONE pipeline, shared with the workspace-wide command
    // (lib/workspaceValidation.ts collectEsiIssues): structure, step and
    // %MACRO% checks need no config, so they run even with no active profile;
    // component validation only with an index.
    const index = getActiveProjectIndex();
    const includes = new Map<string, string>();
    const issues = collectEsiIssues(text, {
      index,
      // One lookup per pass: each referenced CSV is read (csv.ts, a real
      // RFC-4180 reader) at most once, relative to the .esi file's folder.
      csvLookup: index ? createCsvCellLookup(document.uri.fsPath) : undefined,
      macroResolver: createMacroResolver(document, (fullPath) =>
        includes.set(includeIdentity(fullPath), fullPath)
      ),
    });
    collection.set(document.uri, issues.map(toDiagnostic));
    const key = document.uri.toString();
    const before = includesOf.get(key);
    if (includes.size > 0) {
      includesOf.set(key, includes);
    } else {
      includesOf.delete(key);
    }
    if (!sameKeys(before, includes)) {
      watchOutside();
    }
    if (lastLoggedCount.get(key) !== issues.length) {
      const scope = index ? "" : " (structural only — no active project)";
      getOutputChannel().appendLine(
        `[validate] ${path.basename(document.uri.fsPath)}: ${issues.length} issue(s)${scope}`
      );
      lastLoggedCount.set(key, issues.length);
    }
  };

  // Files whose text changed (includeIdentity), waiting for the includer pass.
  const changedFiles = new Set<string>();
  let includerTimer: ReturnType<typeof setTimeout> | undefined;

  /** A file changed: re-validate (debounced) the open scripts including it. */
  const fileChanged = (uri: vscode.Uri): void => {
    if (uri.scheme !== "file" || includesOf.size === 0) {
      return;
    }
    changedFiles.add(includeIdentity(path.resolve(uri.fsPath)));
    if (includerTimer) {
      clearTimeout(includerTimer);
    }
    includerTimer = setTimeout(() => {
      includerTimer = undefined;
      const changed = Array.from(changedFiles);
      changedFiles.clear();
      for (const doc of vscode.workspace.textDocuments) {
        const includes = includesOf.get(doc.uri.toString());
        if (includes && changed.some((file) => includes.has(file))) {
          validateAndPublish(doc);
        }
      }
    }, INCLUDER_DELAY_MS);
  };

  const wire = (watcher: vscode.FileSystemWatcher): vscode.Disposable[] => [
    watcher.onDidChange(fileChanged),
    watcher.onDidCreate(fileChanged),
    watcher.onDidDelete(fileChanged),
  ];
  // Included files outside the workspace folders, which the `**/*.esi`
  // watcher below does not see.
  const outside = createOutsideIncludeWatchers(wire);
  const watchOutside = (): void =>
    outside.update(
      Array.from(includesOf.values()).flatMap((includes) => Array.from(includes.values()))
    );

  // Initial pass for any .esi files already open.
  for (const doc of vscode.workspace.textDocuments) {
    validateAndPublish(doc);
  }

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    validateAndPublish(event.document);
    // Read from this buffer by the scripts that include it.
    fileChanged(event.document.uri);
  });
  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    validateAndPublish(doc);
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    const key = doc.uri.toString();
    collection.delete(doc.uri);
    if (includesOf.delete(key)) {
      watchOutside();
    }
    lastLoggedCount.delete(key);
    // Unsaved edits are gone with it: the scripts including it read the
    // disk again.
    fileChanged(doc.uri);
  });
  // An included file that is not open is read from disk: follow it there.
  // A created one may resolve an include that could not be read before.
  const watcher = vscode.workspace.createFileSystemWatcher(ESI_GLOB);
  const onDisk = wire(watcher);

  // When the active profile changes (or the registry is reloaded), the index
  // reloads — re-validate every open .esi document so warnings catch up.
  const revalidateAll = (): void => {
    for (const doc of vscode.workspace.textDocuments) {
      validateAndPublish(doc);
    }
  };

  // onIndexChanged alone: projectIndexCache fires it after the index was
  // rebuilt for a profile switch / registry reload, and when a config XML is
  // edited on disk. Subscribing to onActiveProfileChanged as well would
  // re-validate every open document twice per switch.
  const onIndexChange = onIndexChanged(() => revalidateAll());
  // Which includes lie outside the workspace folders depends on them.
  const onFolders = vscode.workspace.onDidChangeWorkspaceFolders(() => watchOutside());

  return vscode.Disposable.from(
    collection,
    onChange,
    onOpen,
    onClose,
    watcher,
    ...onDisk,
    outside,
    onIndexChange,
    onFolders,
    {
      dispose: () => {
        if (includerTimer) {
          clearTimeout(includerTimer);
          includerTimer = undefined;
        }
      },
    }
  );
}

function sameKeys(a: ReadonlyMap<string, string> | undefined, b: ReadonlyMap<string, string>): boolean {
  if ((a?.size ?? 0) !== b.size) {
    return false;
  }
  for (const key of b.keys()) {
    if (!a?.has(key)) {
      return false;
    }
  }
  return true;
}

const SEVERITY: Record<ReturnType<typeof issueSeverity>, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

// The range and `code` are what providers/codeActions.ts uses to re-find the
// issue behind a diagnostic — keep both exactly as the issue reports them.
// Also used by commands/validateWorkspace.ts, so both collections agree.
export function toDiagnostic(issue: EsiIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.line,
    issue.startCol,
    issue.line,
    issue.endCol
  );
  const diag = new vscode.Diagnostic(
    range,
    issue.message,
    // A component issue without a severity is a warning.
    SEVERITY[issueSeverity(issue)]
  );
  diag.source = "esi Helper";
  diag.code = issue.kind;
  if ("unnecessary" in issue && issue.unnecessary) {
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
  }
  return diag;
}
