import * as vscode from "vscode";
import { foldingRanges } from "../lib/esiOutline";

/** Tag-based folding for `.esi`: sections, `<pre>` bodies and `#` comment runs. */
export function registerEsiFoldingRangeProvider(): vscode.Disposable {
  return vscode.languages.registerFoldingRangeProvider("esi", {
    provideFoldingRanges(document) {
      return foldingRanges(document.getText()).map(
        (r) =>
          new vscode.FoldingRange(
            r.startLine,
            r.endLine,
            r.kind === "comment" ? vscode.FoldingRangeKind.Comment : undefined
          )
      );
    },
  });
}
