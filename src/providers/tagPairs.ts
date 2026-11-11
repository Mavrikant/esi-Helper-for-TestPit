import * as vscode from "vscode";
import {
  findTagPair,
  TAG_NAME_WORD_PATTERN,
  TagNameRange,
} from "../lib/tagPairs";
import { macroAt } from "../lib/macros";

function nameRange(r: TagNameRange): vscode.Range {
  return new vscode.Range(r.line, r.startCol, r.line, r.endCol);
}

function tagRange(r: TagNameRange): vscode.Range {
  return new vscode.Range(r.line, r.tagStartCol, r.line, r.tagEndCol);
}

/**
 * Section-tag pairing for `.esi`:
 *   - cursor on `[NAME]` or `[/NAME]` highlights both tags;
 *   - with `editor.linkedEditing` on, editing one name edits the other.
 *
 * Linked editing is only offered while the cursor is inside the name itself,
 * because VS Code drops ranges that do not contain the cursor.
 */
export function registerEsiTagPairProviders(): vscode.Disposable {
  const highlights = vscode.languages.registerDocumentHighlightProvider("esi", {
    provideDocumentHighlights(document, position) {
      // VS Code shows the highlights of ONE provider (the first non-empty
      // answer), it does not merge. On a `%MACRO%` inside a tag name the macro
      // provider (macroNavigation.ts) answers, so this one stands down.
      if (macroAt(document.getText(), position.line, position.character)) {
        return undefined;
      }
      const pair = findTagPair(
        document.getText(),
        position.line,
        position.character
      );
      if (!pair) {
        return undefined;
      }
      return [
        new vscode.DocumentHighlight(
          tagRange(pair.open),
          vscode.DocumentHighlightKind.Text
        ),
        new vscode.DocumentHighlight(
          tagRange(pair.close),
          vscode.DocumentHighlightKind.Text
        ),
      ];
    },
  });

  const linked = vscode.languages.registerLinkedEditingRangeProvider("esi", {
    provideLinkedEditingRanges(document, position) {
      const pair = findTagPair(
        document.getText(),
        position.line,
        position.character
      );
      if (!pair || !pair.inName) {
        return undefined;
      }
      return new vscode.LinkedEditingRanges(
        [nameRange(pair.open), nameRange(pair.close)],
        TAG_NAME_WORD_PATTERN
      );
    },
  });

  return vscode.Disposable.from(highlights, linked);
}
