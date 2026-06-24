import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import {
  COMPONENT_TAG_PATTERN,
  XmlIndex,
  isKnownComponent,
} from "../lib/xmlIndex";

// Token types (index-aware colouring layered over the TextMate grammar):
//   class      — component connection names ([429_…], [ED_…], …)
//   property   — message field names (SDI, Course, flight_id, …) → orange
//   enumMember — enum literal values on the RHS of `=`            → yellow
//   keyword    — built-in timing keys (time/interval/…)           → light blue
// Macros (%VAR%) are intentionally NOT emitted here — the grammar colours them
// (red) so they stay consistent and never leak into comments.
const TOKEN_TYPES = ["class", "property", "enumMember", "keyword"] as const;
const TOKEN_MODIFIERS = ["defaultLibrary"] as const;

export const ESI_LEGEND = new vscode.SemanticTokensLegend(
  TOKEN_TYPES as unknown as string[],
  TOKEN_MODIFIERS as unknown as string[]
);

const TAG_RE = /\[(\/?)([A-Za-z0-9_]+)\]/g;
// Field name may include dots (1553 `Mode.SelectedCourse`).
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;
const FIRST_IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/;
// `<file>.csv line:N col:M` — a CSV cell reference, not an enum literal; must
// not be coloured as an enum value.
const CSV_REF_RE = /^[A-Za-z0-9_.\-]+\.csv\s+line\s*:\s*\d+\s+col\s*:\s*\d+/i;
const TIMING_FIELDS = ["time", "interval", "occurrence", "period"];

const KNOWN_MODIFIER = 1 << 0;

/** Drop the `# comment` tail so no token is emitted inside a comment. */
function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

export function registerEsiSemanticTokensProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentSemanticTokensProvider(
    "esi",
    {
      provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(ESI_LEGEND);
        const index = getActiveProjectIndex();
        const lines = document.getText().split(/\r?\n/);

        // Track the enclosing component message as we walk down.
        const stack: string[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          // Comment-stripped view: tokens are never emitted inside `# …`.
          const line = stripComment(lines[lineNum]);

          // Tags drive the component stack and colour component connections.
          TAG_RE.lastIndex = 0;
          let tagMatch: RegExpExecArray | null;
          while ((tagMatch = TAG_RE.exec(line)) !== null) {
            const isClosing = tagMatch[1] === "/";
            const name = tagMatch[2];
            if (isComponentTag(name)) {
              const tokenStart = tagMatch.index + 1 + (isClosing ? 1 : 0);
              const known = index ? isKnownComponent(index, name) : false;
              builder.push(
                lineNum,
                tokenStart,
                name.length,
                tokenTypeIndex("class"),
                known ? KNOWN_MODIFIER : 0
              );
            }
            if (!isClosing) {
              stack.push(name);
            } else if (stack[stack.length - 1] === name) {
              stack.pop();
            }
          }

          // Field assignment inside an open component block.
          const enclosing = topComponent(stack);
          const assignMatch = ASSIGNMENT_RE.exec(line);
          if (!assignMatch || !enclosing) {
            continue;
          }
          const fieldName = assignMatch[2];
          const fieldStart = assignMatch[1].length;
          const message = index?.resolveConnectionMessage(enclosing);
          const field = message?.fields.find((f) => f.name === fieldName);

          if (TIMING_FIELDS.includes(fieldName)) {
            // Built-in timing key → keyword (always known).
            builder.push(
              lineNum,
              fieldStart,
              fieldName.length,
              tokenTypeIndex("keyword"),
              KNOWN_MODIFIER
            );
          } else {
            // Message field name → property; dimmed when not in the message.
            builder.push(
              lineNum,
              fieldStart,
              fieldName.length,
              tokenTypeIndex("property"),
              field ? KNOWN_MODIFIER : 0
            );
          }

          // RHS enum literal — only for enum-typed fields, and never for CSV
          // references or macros (the grammar colours those).
          if (!field?.enums || field.enums.length === 0) {
            continue;
          }
          const eqIndex = line.indexOf("=");
          if (eqIndex === -1) {
            continue;
          }
          const rhs = line.slice(eqIndex + 1);
          const rhsTrimmed = rhs.trimStart();
          if (rhsTrimmed.startsWith("%") || CSV_REF_RE.test(rhsTrimmed)) {
            continue;
          }
          const valueMatch = FIRST_IDENT_RE.exec(rhs);
          if (!valueMatch) {
            continue;
          }
          const valStart = eqIndex + 1 + valueMatch.index;
          const known = field.enums.some((e) => e.name === valueMatch[0]);
          builder.push(
            lineNum,
            valStart,
            valueMatch[0].length,
            tokenTypeIndex("enumMember"),
            known ? KNOWN_MODIFIER : 0
          );
        }
        return builder.build();
      },
    },
    ESI_LEGEND
  );
}

function isComponentTag(name: string): boolean {
  return COMPONENT_TAG_PATTERN.test(name);
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
