import * as vscode from "vscode";
import * as fs from "fs";
import { createCsvCellLookup } from "../lib/csv";
import { findExistingFileRefs } from "../lib/fileRefs";

function isFile(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Makes file references in a `.esi` script clickable (Ctrl+click): CSV cell
 * refs, `include file` / `result file` values and other path-shaped value
 * tokens — see lib/fileRefs.ts for exactly what is detected. A link is only
 * offered when the target exists, resolved against the script's folder.
 */
export function registerEsiDocumentLinkProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentLinkProvider("esi", {
    provideDocumentLinks(document) {
      // Relative references need a script folder — nothing to resolve
      // against for an untitled / virtual document.
      if (document.uri.scheme !== "file") {
        return [];
      }
      const scriptPath = document.uri.fsPath;
      const csvLookup = createCsvCellLookup(scriptPath);
      return findExistingFileRefs(document.getText(), scriptPath, isFile).map((ref) => {
        let target = vscode.Uri.file(ref.target);
        if (ref.kind === "csvCell" && ref.csvLine !== undefined && ref.csvCol !== undefined) {
          // Open the CSV at the referenced cell when it can be located.
          const cell = csvLookup(ref.path, ref.csvLine, ref.csvCol);
          if (cell.status === "ok") {
            target = target.with({
              fragment: `L${cell.fileLine + 1},${cell.fileCharacter + 1}`,
            });
          }
        }
        const link = new vscode.DocumentLink(
          new vscode.Range(ref.lineNumber, ref.startCol, ref.lineNumber, ref.endCol),
          target
        );
        link.tooltip = ref.target;
        return link;
      });
    },
  });
}
