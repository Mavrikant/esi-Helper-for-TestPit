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
import {
  computeMacroQuickFixes,
  findMacroIssue,
  isMacroIssueKind,
  validateMacros,
} from "../lib/macros";
import { computeRenumberStepsFix, isStepIssueKind } from "../lib/stepChecks";
import { createMacroResolver } from "./macroResolver";

const SOURCE = "esi Helper";

/**
 * Quick fixes for the in-process ("esi Helper") diagnostics. All the logic is
 * in lib/ (quickFixes.ts, macros.ts, stepChecks.ts); this only maps
 * diagnostics to issues and plain edits to CodeActions. Structural, macro and
 * step fixes need no index, so they work with no active profile too.
 *
 * This is the ONE code-action provider for `esi`: the diagnostic `code`
 * decides which library answers, so no fix is ever offered twice.
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
        const text = document.getText();

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

        // Step numbers: one whole-file "Renumber steps" for all of them.
        const stepDiags = diagnostics.filter((d) => isStepIssueKind(d.code));
        if (stepDiags.length > 0) {
          const fix = computeRenumberStepsFix(text);
          if (fix) {
            actions.push(toAction(fix, stepDiags));
          }
        }

        // %MACRO% checks (lib/macros.ts) — re-validated only when needed.
        const macroDiags = diagnostics.filter((d) => isMacroIssueKind(d.code));
        if (macroDiags.length > 0) {
          const issues = validateMacros(text, createMacroResolver(document));
          for (const diag of macroDiags) {
            const issue = findMacroIssue(
              issues,
              diag.code as string,
              diag.range.start.line,
              diag.range.start.character,
              diag.range.end.character
            );
            if (issue) {
              for (const fix of computeMacroQuickFixes(text, issue)) {
                actions.push(toAction(fix, [diag]));
              }
            }
          }
        }

        const componentDiags = diagnostics.filter(
          (d) => !isStepIssueKind(d.code) && !isMacroIssueKind(d.code)
        );
        if (componentDiags.length === 0) {
          return actions;
        }
        // Built once per request, and only when there is something to fix.
        const ctx: FixContext = createFixContext(text, getActiveProjectIndex());
        const kinds = new Map<string, vscode.Diagnostic[]>();
        for (const diag of componentDiags) {
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
