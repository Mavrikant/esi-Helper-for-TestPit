import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";
import {
  COMPONENT_TAG_PATTERN,
  ConnectionDef,
} from "../lib/xmlIndex";

import { findConnectionByBareName } from "../lib/bareConnectionLookup";
import { buildMacroModel, macroAt, renderMacroHover } from "../lib/macros";
import { createMacroResolver, macroFileLabel } from "./macroResolver";
import { csvCellRefAt } from "../lib/fileRefs";
import { DefinitionTarget, definitionLinkMarkdown } from "../lib/xmlLocate";

/** Append an "Open definition" link into the config XML, when one is known. */
function withDefinitionLink(
  md: vscode.MarkdownString,
  target: DefinitionTarget
): vscode.MarkdownString {
  const link = definitionLinkMarkdown(target);
  if (link) {
    md.appendMarkdown(`\n\n${link}`);
  }
  return md;
}

const WORD_PATTERN = /[A-Za-z0-9_.]+/;

export function registerEsiHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider("esi", {
    provideHover(document, position) {
      // 0. %MACRO% — needs no index, and the wordPattern excludes `%`, so the
      //    token is located by lib/macros.ts rather than word-at-position.
      const macro = macroAt(
        document.getText(),
        position.line,
        position.character
      );
      if (macro) {
        const model = buildMacroModel(
          document.getText(),
          createMacroResolver(document)
        );
        return new vscode.Hover(
          new vscode.MarkdownString(
            renderMacroHover(model, macro.name, macroFileLabel)
          ),
          new vscode.Range(
            macro.line,
            macro.startCol,
            macro.line,
            macro.endCol
          )
        );
      }

      // A `file.csv line:N col:M` reference belongs to providers/csvHover.ts.
      // VS Code shows every provider's hover, so this one must stay silent
      // there or a file name / cell word that happens to match a component
      // would add a second, unrelated card.
      if (csvCellRefAt(document.lineAt(position.line).text, position.character)) {
        return undefined;
      }

      const range = document.getWordRangeAtPosition(position, WORD_PATTERN);
      if (!range) {
        return undefined;
      }
      const word = document.getText(range);
      const index = getActiveProjectIndex();
      if (!index) {
        return undefined;
      }

      // 1. Direct connection name (already prefixed, e.g. "429_L100…",
      //    "VORILS1_VORILSDataMsg"). Falls back to resolveConnectionMessage
      //    for forms not registered as canonical (e.g. VORILS2_…), which
      //    strips the unit number and looks up the message directly.
      let synthetic: DefinitionTarget | undefined;
      let conn: ConnectionDef | undefined = index.connections.get(word);
      if (!conn && COMPONENT_TAG_PATTERN.test(word)) {
        const msg = index.resolveConnectionMessage(word);
        if (msg) {
          // Synthetic connection (no sourceFile): link to the message instead.
          synthetic = { kind: "message", message: msg };
          conn = {
            fullName: word,
            bus: msg.bus,
            rawName: word.split("_").slice(1).join("_"),
            messageName: msg.name,
          };
        }
      }
      if (conn) {
        return new vscode.Hover(
          withDefinitionLink(
            renderConnection(conn, index),
            synthetic ?? { kind: "connection", conn }
          ),
          range
        );
      }

      // 2. Connection name without its prefix — any prefix the index
      //    registers (429_, 1553_, DIS_, Mem_, VORILS<N>_, ED_,
      //    PART_<partition>_), derived from COMPONENT_TAG_PREFIXES.
      const bare = findConnectionByBareName(index.connections, word);
      if (bare) {
        return new vscode.Hover(
          withDefinitionLink(renderConnection(bare, index), {
            kind: "connection",
            conn: bare,
          }),
          range
        );
      }

      // 3. Field or enum: use the enclosing context to figure out the message.
      const ctx = resolveContext(
        document.getText(),
        position.line,
        position.character
      );
      if (ctx.kind === "fieldName" || ctx.kind === "fieldValue") {
        const message = index.resolveConnectionMessage(ctx.messageName);
        if (message) {
          // Passing the connection selects the right partition's port for a
          // PART_<partition>_<port> block.
          const owner = index.connections.get(ctx.messageName);
          const field = message.fields.find((f) => f.name === word);
          if (field) {
            return new vscode.Hover(
              withDefinitionLink(renderField(field, message), {
                kind: "field",
                message,
                field,
                conn: owner,
              }),
              range
            );
          }
          for (const f of message.fields) {
            const enumVal = f.enums?.find((e) => e.name === word);
            if (enumVal) {
              return new vscode.Hover(
                withDefinitionLink(renderEnum(enumVal, f, message), {
                  kind: "enum",
                  message,
                  field: f,
                  enumName: enumVal.name,
                  conn: owner,
                }),
                range
              );
            }
          }
        }
      }
      return undefined;
    },
  });
}
