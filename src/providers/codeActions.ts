import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import {
  FixContext,
  QuickFix,
  computeFixAll,
  computeQuickFixes,
  createFixContext,
  findIssues,
} from "../lib/quickFixes";

const SOURCE = "esi Helper";

/**
 * Quick fixes for the in-process ("esi Helper") diagnostics. All the logic is
 * in lib/quickFixes.ts; this only maps diagnostics to issues and plain edits
 * to CodeActions. Structural fixes need no index, so they work with no active
 * profile too.
 */
export function registerEsiCodeActionsProvider(): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    "esi",
    {
      provideCodeActions(document, _range, context) {
        const actions: vscode.CodeAction[] = [];
        const diagnostics = context.diagnostics.filter(
          (d) => d.source === SOURCE && typeof d.code === "string"
        );
        if (diagnostics.length === 0) {
          return actions;
        }
        // Built once per request, and only when there is something to fix.
        const ctx: FixContext = createFixContext(
          document.getText(),
          getActiveProjectIndex()
        );

        const toAction = (
          fix: QuickFix,
          diags: vscode.Diagnostic[]
        ): vscode.CodeAction => {
          const action = new vscode.CodeAction(
            fix.title,
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = diags;
          action.isPreferred = fix.preferred;
          action.edit = new vscode.WorkspaceEdit();
          for (const e of fix.edits) {
            action.edit.replace(
              document.uri,
              new vscode.Range(e.line, e.startCol, e.endLine, e.endCol),
              e.newText
            );
          }
          return action;
        };

        const kinds = new Map<string, vscode.Diagnostic[]>();
        for (const diag of diagnostics) {
          const kind = diag.code as string;
          const { start, end } = diag.range;
          const issues = findIssues(
            ctx,
            kind,
            start.line,
            start.character,
            end.character
          );
          for (const issue of issues) {
            for (const fix of computeQuickFixes(ctx, issue)) {
              actions.push(toAction(fix, [diag]));
            }
          }
          kinds.set(kind, (kinds.get(kind) ?? []).concat(diag));
        }

        for (const [kind, diags] of kinds) {
          const all = computeFixAll(ctx, kind);
          if (all) {
            actions.push(toAction(all, diags));
          }
        }
        return actions;
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );
}
