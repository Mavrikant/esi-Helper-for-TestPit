import type * as vscode from "vscode";
import { ConnectionDef, EnumDef, FieldDef, MessageDef, XmlIndex } from "./xmlIndex";

/**
 * MarkdownString rendering for connections / fields / enums. Used by both
 * the hover provider and the completion provider's `documentation` payload.
 *
 * Late-requires `vscode` so test/setup.js can register a mock first.
 */

export function renderConnection(
  conn: ConnectionDef,
  index: XmlIndex
): vscode.MarkdownString {
  const vsc: typeof vscode = require("vscode");
  const md = new vsc.MarkdownString(undefined, true);
  md.appendMarkdown(`**${conn.fullName}** _(${busLabel(conn.bus)} connection)_\n\n`);
  if (conn.label !== undefined) {
    md.appendMarkdown(`- Label: \`${conn.label}\`\n`);
  }
  if (conn.card || conn.channel || conn.speed) {
    md.appendMarkdown(`- Card / Channel / Speed: \`${conn.card ?? "?"}\` / \`${conn.channel ?? "?"}\` / \`${conn.speed ?? "?"}\`\n`);
  }
  const message = conn.messageName ? index.messages.get(conn.messageName) : undefined;
  if (message) {
    md.appendMarkdown(`- Message: \`${message.name}\``);
    if (message.type) {
      md.appendMarkdown(` (\`${message.type}\`)`);
    }
    md.appendMarkdown("\n\n");
    if (message.fields.length > 0) {
      md.appendMarkdown(`**Fields** (${message.fields.length}):\n`);
      for (const f of message.fields.slice(0, 12)) {
        md.appendMarkdown(`- \`${f.name}\`${f.dataType ? ` _(${f.dataType})_` : ""}\n`);
      }
      if (message.fields.length > 12) {
        md.appendMarkdown(`- … ${message.fields.length - 12} more\n`);
      }
    }
  }
  return md;
}

export function renderField(
  field: FieldDef,
  message?: MessageDef
): vscode.MarkdownString {
  const vsc: typeof vscode = require("vscode");
  const md = new vsc.MarkdownString(undefined, true);
  md.appendMarkdown(`**${field.name}**${field.dataType ? ` _(${field.dataType})_` : ""}\n\n`);
  const rangeBits: string[] = [];
  if (field.minValue !== undefined && field.minValue !== "-") {
    rangeBits.push(`min \`${field.minValue}\``);
  }
  if (field.maxValue !== undefined && field.maxValue !== "-") {
    rangeBits.push(`max \`${field.maxValue}\``);
  }
  if (field.resolution !== undefined && field.resolution !== "-") {
    rangeBits.push(`step \`${field.resolution}\``);
  }
  if (rangeBits.length > 0) {
    md.appendMarkdown(`- Range: ${rangeBits.join(", ")}\n`);
  }
  if (field.defaultValue !== undefined && field.defaultValue !== "") {
    md.appendMarkdown(`- Default: \`${field.defaultValue}\`\n`);
  }
  if (field.startBit !== undefined || field.size !== undefined) {
    md.appendMarkdown(`- Bits: start \`${field.startBit ?? "?"}\`, size \`${field.size ?? "?"}\`\n`);
  }
  if (field.unit && field.unit !== "-") {
    md.appendMarkdown(`- Unit: \`${field.unit}\`\n`);
  }
  if (field.vc !== undefined) {
    md.appendMarkdown(`- VC: \`${field.vc}\`\n`);
  }
  if (field.enums && field.enums.length > 0) {
    md.appendMarkdown(`\n**Enums** (${field.enums.length}):\n`);
    for (const e of field.enums) {
      md.appendMarkdown(`- \`${e.name}\` = \`${e.value}\`\n`);
    }
  }
  if (message) {
    md.appendMarkdown(`\n_From message_ \`${message.name}\``);
  }
  return md;
}

export function renderEnum(
  enumDef: EnumDef,
  field: FieldDef,
  message?: MessageDef
): vscode.MarkdownString {
  const vsc: typeof vscode = require("vscode");
  const md = new vsc.MarkdownString(undefined, true);
  md.appendMarkdown(`**${enumDef.name}** = \`${enumDef.value}\`\n\n`);
  md.appendMarkdown(`Enum value of \`${field.name}\``);
  if (message) {
    md.appendMarkdown(` (in \`${message.name}\`)`);
  }
  return md;
}

function busLabel(bus: ConnectionDef["bus"]): string {
  switch (bus) {
    case "429":
      return "ARINC 429";
    case "1553":
      return "MIL-STD-1553";
    case "DIS":
      return "DIS";
    case "Mem":
      return "Memory";
  }
}
