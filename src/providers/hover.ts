import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { resolveContext } from "../lib/esiContext";
import {
  renderConnection,
  renderEnum,
  renderField,
} from "../lib/renderComponent";

import { COMPONENT_TAG_PREFIXES } from "../lib/xmlIndex";

const WORD_PATTERN = /[A-Za-z0-9_]+/;
const BUS_PREFIXES = COMPONENT_TAG_PREFIXES;

export function registerEsiHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider("esi", {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, WORD_PATTERN);
      if (!range) {
        return undefined;
      }
      const word = document.getText(range);
      const index = getActiveProjectIndex();
      if (!index) {
        return undefined;
      }

      // 1. Direct connection name (already prefixed, e.g. "429_L100…")
      const directConn = index.connections.get(word);
      if (directConn) {
        return new vscode.Hover(renderConnection(directConn, index), range);
      }

      // 2. Connection name without prefix — try each bus prefix.
      for (const prefix of BUS_PREFIXES) {
        const prefixed = `${prefix}_${word}`;
        const conn = index.connections.get(prefixed);
        if (conn) {
          return new vscode.Hover(renderConnection(conn, index), range);
        }
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
          const field = message.fields.find((f) => f.name === word);
          if (field) {
            return new vscode.Hover(renderField(field, message), range);
          }
          for (const f of message.fields) {
            const enumVal = f.enums?.find((e) => e.name === word);
            if (enumVal) {
              return new vscode.Hover(renderEnum(enumVal, f, message), range);
            }
          }
        }
      }
      return undefined;
    },
  });
}
