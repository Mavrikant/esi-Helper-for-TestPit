import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants";
import { formatEsi } from "./lib/formatEsi";
import {
  computeLineEdits,
  selectionToLineSpan,
  type LineSpan,
} from "./lib/lineEdits";
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

/**
 * Format Selection. The formatter's decisions (depth, `=` alignment groups,
 * column-anchored `<pre>`) need the whole document, so the full result is
 * computed and only the lines inside the selection (expanded to whole lines)
 * are edited. Everything outside the selection is left byte-identical.
 */
export function registerEsiRangeFormatter(): vscode.Disposable {
  return vscode.languages.registerDocumentRangeFormattingEditProvider(
    ESI_LANGUAGE,
    {
      provideDocumentRangeFormattingEdits(document, range) {
        return computeFormatEdits(
          document,
          (t) => formatEsi(t, { alignScope: getAlignScope() }),
          selectionToLineSpan(
            range.start.line,
            range.end.line,
            range.end.character
          )
        );
      },
    }
  );
}

/**
 * Edits turning the document into `transform(document)`, as minimal per-line
 * replacements (line terminators are never touched, so CRLF is preserved and
 * cursor/fold state survives). With `span`, only lines inside it are edited.
 */
function computeFormatEdits(
  document: vscode.TextDocument,
  transform: (text: string) => string = formatEsi,
  span?: LineSpan
): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = transform(original);
  if (formatted === original) {
    return [];
  }
  const lineEdits = computeLineEdits(original, formatted, span);
  // The line-by-line mapping only holds when our line split agrees with the
  // editor's (it would not for a lone `\r`) and the transform kept the count.
  const sameLines =
    typeof document.lineCount !== "number" ||
    document.lineCount === original.split(/\r?\n/).length;
  if (lineEdits !== null && sameLines) {
    return lineEdits.map((e) =>
      vscode.TextEdit.replace(
        new vscode.Range(e.line, e.startCol, e.line, e.endCol),
        e.newText
      )
    );
  }
  if (span) {
    // Cannot confine a whole-text replacement to the selection — do nothing
    // rather than touch lines outside it.
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length)
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}
