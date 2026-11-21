import * as vscode from "vscode";
import { findConnectionByBareName } from "../lib/bareConnectionLookup";
import { keywordHoverAt } from "../lib/keywordDocs";
import { macroAt } from "../lib/macros";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { COMPONENT_TAG_PATTERN } from "../lib/xmlIndex";

// Same word shape providers/hover.ts looks a component up by.
const WORD_PATTERN = /[A-Za-z0-9_.]+/;

/**
 * Hover for TestPit parameter keys (`match`, `occurrence`, `time`, …) and
 * structural section tags (`[STEP INPUTS]`, `[VARIABLES]`, …) — the keywords
 * the XML index has no entry for. Separate from the component hover
 * (providers/hover.ts); VS Code shows every provider's card, so this one
 * stays silent wherever that one answers. Needs no profile.
 */
export function registerEsiKeywordHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider("esi", {
    provideHover(document, position) {
      // A %MACRO% (also one inside a tag name, `[STEP %N%]`) gets the macro
      // card from providers/hover.ts — not a second, section card beside it.
      if (macroAt(document.getText(), position.line, position.character)) {
        return undefined;
      }

      // Per request — never cached (the index reloads on profile switch).
      const index = getActiveProjectIndex();

      // The component hover answers for any word that names a connection,
      // with or without its bus prefix, before it looks at anything else.
      const wordRange = document.getWordRangeAtPosition(position, WORD_PATTERN);
      if (index && wordRange) {
        const word = document.getText(wordRange);
        if (
          index.connections.has(word) ||
          (COMPONENT_TAG_PATTERN.test(word) &&
            index.resolveConnectionMessage(word)) ||
          findConnectionByBareName(index.connections, word)
        ) {
          return undefined;
        }
      }

      const hover = keywordHoverAt(
        document.getText(),
        position.line,
        position.character,
        {
          // A real field of that name (the synthesized `value` of a DIS_
          // message, …) gets the component hover's field card instead.
          isRealField: (blockName, key) =>
            !!index
              ?.resolveConnectionMessage(blockName)
              ?.fields.some((f) => f.name === key),
        }
      );
      if (!hover) {
        return undefined;
      }
      return new vscode.Hover(
        new vscode.MarkdownString(hover.markdown),
        new vscode.Range(hover.line, hover.startCol, hover.line, hover.endCol)
      );
    },
  });
}
