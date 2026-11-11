import * as vscode from "vscode";
import {
  InsertPlan,
  planConnectionInsert,
  planFieldInsert,
} from "../lib/componentInsert";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { XmlIndex } from "../lib/xmlIndex";

export const INSERT_COMPONENT_COMMAND = "extension.insertComponent";

/** What the component browser passes: a connection, or a field of one. */
export type InsertComponentArg =
  | { kind: "connection"; name: string }
  | { kind: "field"; name: string; connectionName?: string };

/**
 * "Insert Component at Cursor": writes a connection block (`[NAME]` …
 * `[/NAME]`) or a `field = ` line into the active `.esi` editor. Run by a
 * click in the component browser (views/componentBrowser.ts). Where and what
 * is decided in lib/componentInsert.ts.
 *
 * `getIndex` is only replaced in tests.
 */
export function registerInsertComponent(
  getIndex: () => XmlIndex | undefined = getActiveProjectIndex
): vscode.Disposable {
  return vscode.commands.registerCommand(
    INSERT_COMPONENT_COMMAND,
    async (arg?: InsertComponentArg) => {
      if (!arg || typeof arg.name !== "string") {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "esi") {
        void vscode.window.showInformationMessage(
          "Open a .esi file and place the cursor where the component should go."
        );
        return;
      }
      const text = editor.document.getText();
      const line = editor.selection.active.line;
      let plan: InsertPlan | undefined;
      if (arg.kind === "connection") {
        // Per request, never cached: only names the index still holds.
        if (!getIndex()?.connections.has(arg.name)) {
          return;
        }
        plan = planConnectionInsert(text, line, arg.name);
      } else if (arg.kind === "field") {
        plan = planFieldInsert(text, line, arg.name);
      }
      if (!plan) {
        return;
      }
      await editor.insertSnippet(
        new vscode.SnippetString(plan.snippet),
        new vscode.Range(plan.line, plan.startCol, plan.line, plan.endCol),
        // Indentation is spelled out in the snippet; don't re-indent.
        { undoStopBefore: true, undoStopAfter: true, keepWhitespace: true }
      );
      // Hand the keyboard back to the editor: the click left it in the view.
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
      });
    }
  );
}
