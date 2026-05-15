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

const WORD_PATTERN = /[A-Za-z0-9_.]+/;
// Literal canonical prefixes for the bare-word lookup. VORILS uses the
// canonical "1" unit number; users hovering on an explicit `VORILS2_…`
// token hit path 1 (direct + fallback via resolveConnectionMessage).
const BUS_PREFIXES = ["429", "1553", "DIS", "Mem", "VORILS1"];

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

      // 1. Direct connection name (already prefixed, e.g. "429_L100…",
      //    "VORILS1_VORILSDataMsg"). Falls back to resolveConnectionMessage
      //    for forms not registered as canonical (e.g. VORILS2_…), which
      //    strips the unit number and looks up the message directly.
      let conn: ConnectionDef | undefined = index.connections.get(word);
      if (!conn && COMPONENT_TAG_PATTERN.test(word)) {
        const msg = index.resolveConnectionMessage(word);
        if (msg) {
          conn = {
            fullName: word,
            bus: msg.bus,
            rawName: word.split("_").slice(1).join("_"),
            messageName: msg.name,
          };
        }
      }
      if (conn) {
        return new vscode.Hover(renderConnection(conn, index), range);
      }

      // 2. Connection name without prefix — try each bus prefix.
      for (const prefix of BUS_PREFIXES) {
        const prefixed = `${prefix}_${word}`;
        const c = index.connections.get(prefixed);
        if (c) {
          return new vscode.Hover(renderConnection(c, index), range);
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
