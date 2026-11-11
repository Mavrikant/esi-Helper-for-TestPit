import * as vscode from "vscode";
import { getActiveProjectIndex, onIndexChanged } from "../lib/projectIndexCache";
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  computeSemanticTokens,
  encodeSemanticTokenModifiers,
  semanticTokenTypeIndex,
} from "../lib/semanticTokens";

// Thin glue: the token logic (types, modifiers, the document walk) is the pure
// lib/semanticTokens.ts. Colours and font styles for the legend below live in
// package.json `contributes.configurationDefaults`.
export const ESI_LEGEND = new vscode.SemanticTokensLegend(
  [...SEMANTIC_TOKEN_TYPES],
  [...SEMANTIC_TOKEN_MODIFIERS]
);

export function registerEsiSemanticTokensProvider(): vscode.Disposable {
  // Known / unknown / reserved styling comes from the index, so the editor
  // has to ask again when it reloads.
  const changed = new vscode.EventEmitter<void>();
  const onIndexChange = onIndexChanged(() => changed.fire());
  const registration = vscode.languages.registerDocumentSemanticTokensProvider(
    "esi",
    {
      onDidChangeSemanticTokens: changed.event,
      provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(ESI_LEGEND);
        // Fetched per request — the index reloads on profile / config changes.
        const index = getActiveProjectIndex();
        for (const token of computeSemanticTokens(document.getText(), index)) {
          builder.push(
            token.line,
            token.start,
            token.length,
            semanticTokenTypeIndex(token.type),
            encodeSemanticTokenModifiers(token.modifiers)
          );
        }
        return builder.build();
      },
    },
    ESI_LEGEND
  );
  return vscode.Disposable.from(registration, onIndexChange, changed);
}
