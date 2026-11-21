import * as vscode from "vscode";
import {
  InsertPlan,
  planConnectionInsert,
  planFieldInsert,
} from "../lib/componentInsert";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { XmlIndex } from "../lib/xmlIndex";

export const INSERT_COMPONENT_COMMAND = "extension.insertComponent";

/**
 * A double-click in a tree runs the item's command twice (once per click, the
 * second with `detail === 2`): the same component again within this window
 * is that second click, not a second insert.
 */
export const REPEAT_WINDOW_MS = 500;

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
  let last: { key: string; at: number } | undefined;
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
      // Identity fields only: the view's context menu passes the tree node
      // itself, whose fields carry whole message definitions (serializing
      // it costs O(fields²) and overflows on a large message).
      const key =
        arg.kind === "field"
          ? `field\u0000${arg.connectionName ?? ""}\u0000${arg.name}`
          : `${arg.kind}\u0000${arg.name}`;
      const now = Date.now();
      if (last && last.key === key && now - last.at < REPEAT_WINDOW_MS) {
        // The second click of a double-click took the focus back to the
        // view: give it to the editor again, insert nothing.
        await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          preserveFocus: false,
        });
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
      last = { key, at: now };
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
