import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { XmlIndex } from "../lib/xmlIndex";

const TOKEN_TYPES = ["class", "property", "enumMember", "variable"] as const;
const TOKEN_MODIFIERS = ["defaultLibrary"] as const;

export const ESI_LEGEND = new vscode.SemanticTokensLegend(
  TOKEN_TYPES as unknown as string[],
  TOKEN_MODIFIERS as unknown as string[]
);

const TAG_RE = /\[(\/?)([A-Za-z0-9_]+)\]/g;
const VAR_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

const KNOWN_MODIFIER = 1 << 0;

export function registerEsiSemanticTokensProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentSemanticTokensProvider(
    "esi",
    {
      provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(ESI_LEGEND);
        const index = getActiveProjectIndex();
        const lines = document.getText().split("\n");

        // Track the enclosing component message as we walk down.
        const stack: string[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          // Tags first — also drive the stack.
          TAG_RE.lastIndex = 0;
          let tagMatch: RegExpExecArray | null;
          while ((tagMatch = TAG_RE.exec(line)) !== null) {
            const isClosing = tagMatch[1] === "/";
            const name = tagMatch[2];
            const tokenStart = tagMatch.index + 1 + (isClosing ? 1 : 0);
            const tokenLen = name.length;
            if (isComponentTag(name)) {
              const known = index?.connections.has(name) ?? false;
              builder.push(
                lineNum,
                tokenStart,
                tokenLen,
                tokenTypeIndex("class"),
                known ? KNOWN_MODIFIER : 0
              );
              if (!isClosing) {
                stack.push(name);
              } else if (stack[stack.length - 1] === name) {
                stack.pop();
              }
            } else if (!isClosing) {
              // Push non-component tags so depth tracking still pops correctly.
              stack.push(name);
            } else if (stack[stack.length - 1] === name) {
              stack.pop();
            }
          }

          // Field assignments inside an open component.
          const enclosing = topComponent(stack);
          const assignMatch = ASSIGNMENT_RE.exec(line);
          if (assignMatch && enclosing) {
            const fieldName = assignMatch[2];
            const fieldStart = assignMatch[1].length;
            const message = index?.resolveConnectionMessage(enclosing);
            const field = message?.fields.find((f) => f.name === fieldName);
            const fieldKnown =
              !!field || ["time", "delay"].includes(fieldName);
            builder.push(
              lineNum,
              fieldStart,
              fieldName.length,
              tokenTypeIndex("property"),
              fieldKnown ? KNOWN_MODIFIER : 0
            );

            // RHS — could be enum value(s).
            const eqIndex = line.indexOf("=");
            if (eqIndex !== -1 && field?.dataType === "Enum" && field.enums) {
              const rhsStart = eqIndex + 1;
              IDENT_RE.lastIndex = rhsStart;
              let identMatch: RegExpExecArray | null;
              while ((identMatch = IDENT_RE.exec(line)) !== null) {
                const ident = identMatch[0];
                const known = field.enums.some((e) => e.name === ident);
                builder.push(
                  lineNum,
                  identMatch.index,
                  ident.length,
                  tokenTypeIndex("enumMember"),
                  known ? KNOWN_MODIFIER : 0
                );
              }
            }
          }

          // Variable references %VAR%.
          VAR_RE.lastIndex = 0;
          let varMatch: RegExpExecArray | null;
          while ((varMatch = VAR_RE.exec(line)) !== null) {
            builder.push(
              lineNum,
              varMatch.index + 1,
              varMatch[1].length,
              tokenTypeIndex("variable"),
              0
            );
          }
        }
        return builder.build();
      },
    },
    ESI_LEGEND
  );
}

function isComponentTag(name: string): boolean {
  return /^(429|1553|Discrete|Mem)_/.test(name);
}

function topComponent(stack: string[]): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (isComponentTag(stack[i])) {
      return stack[i];
    }
  }
  return undefined;
}

function tokenTypeIndex(type: (typeof TOKEN_TYPES)[number]): number {
  return TOKEN_TYPES.indexOf(type);
}

// `XmlIndex` is referenced from typings only; keep the import alive.
export type { XmlIndex };
