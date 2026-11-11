import type * as vscode from "vscode";
import {
  INSERT_COMPONENT_COMMAND,
  InsertComponentArg,
} from "../commands/insertComponent";
import {
  ComponentNode,
  ComponentTree,
  buildComponentTree,
  childrenOf,
  filterTerms,
  nodeId,
  treeState,
} from "../lib/componentTree";
import { onActiveProfileChanged } from "../lib/profileRegistry";
import { getActiveProjectIndex, onIndexChanged } from "../lib/projectIndexCache";
import { renderConnection, renderField } from "../lib/renderComponent";
import { XmlIndex } from "../lib/xmlIndex";
import { DefinitionTarget, resolveDefinition } from "../lib/xmlLocate";

export const COMPONENT_BROWSER_VIEW = "esihelper.componentBrowser";
export const FILTER_COMMAND = "extension.componentBrowser.filter";
export const CLEAR_FILTER_COMMAND = "extension.componentBrowser.clearFilter";
export const GOTO_DEFINITION_COMMAND = "extension.componentBrowser.gotoDefinition";

/** Context keys the package.json `when` clauses read. */
const STATE_KEY = "esihelper.componentBrowser.state";
const FILTERED_KEY = "esihelper.componentBrowser.filtered";

/** `viewItem` values; ` hasDefinition` is appended when a source file is known. */
const CONTEXT_CONNECTION = "esiConnection";
const CONTEXT_FIELD = "esiField";
const HAS_DEFINITION = " hasDefinition";

/**
 * The definition a node stands for, looked up in `index` by name — a node may
 * be older than the index (the view refreshes on a change, but a menu can
 * still be open over the old one).
 */
function definitionTargetsOf(
  index: XmlIndex,
  node: ComponentNode
): DefinitionTarget[] {
  if (node.kind === "connection") {
    const conn = index.connections.get(node.name);
    if (!conn) {
      return [];
    }
    const targets: DefinitionTarget[] = [{ kind: "connection", conn }];
    const message = index.resolveConnectionMessage(node.name);
    if (message) {
      targets.push({ kind: "message", message, conn });
    }
    return targets;
  }
  if (node.kind === "field") {
    const conn = index.connections.get(node.connectionName);
    const message = index.resolveConnectionMessage(node.connectionName);
    const field = message?.fields.find((f) => f.name === node.name);
    return message && field ? [{ kind: "field", message, field, conn }] : [];
  }
  return [];
}

/**
 * The component browser: a tree of the active profile's bus → connection →
 * fields. A click on a connection or field inserts it into the active `.esi`
 * editor (commands/insertComponent.ts); the title bar has a filter.
 *
 * The model is lib/componentTree.ts. The XML index is asked for on every
 * request (it reloads on a profile switch and when a config file changes);
 * only the tree derived from it is kept, against that very index object and
 * filter, so a new index always gives a new tree.
 *
 * `getIndex` is only replaced in tests. Late-requires `vscode`, as
 * renderComponent.ts does, so the test mock is read when the view is
 * registered rather than when this module is loaded.
 */
export function registerComponentBrowser(
  getIndex: () => XmlIndex | undefined = getActiveProjectIndex
): vscode.Disposable {
  const vsc: typeof vscode = require("vscode");
  let filter = "";
  let built: { index: XmlIndex; filter: string; tree: ComponentTree } | undefined;

  const currentTree = (): ComponentTree | undefined => {
    const index = getIndex();
    if (!index) {
      built = undefined;
      return undefined;
    }
    if (!built || built.index !== index || built.filter !== filter) {
      built = { index, filter, tree: buildComponentTree(index, filter) };
    }
    return built.tree;
  };

  const changed = new vsc.EventEmitter<ComponentNode | undefined | void>();

  const provider: vscode.TreeDataProvider<ComponentNode> = {
    onDidChangeTreeData: changed.event,

    getChildren(node?: ComponentNode): ComponentNode[] {
      if (node) {
        // A node carries its own children (see componentTree.ts).
        return childrenOf(node);
      }
      return currentTree()?.buses ?? [];
    },

    getTreeItem(node: ComponentNode): vscode.TreeItem {
      const filtering = filterTerms(filter).length > 0;
      // A filtered tree is a different tree: separate ids, so it opens
      // expanded and the unfiltered one keeps its own expansion state.
      const id = (filtering ? "f|" : "") + nodeId(node);
      if (node.kind === "bus") {
        const item = new vsc.TreeItem(
          node.label,
          filtering
            ? vsc.TreeItemCollapsibleState.Expanded
            : vsc.TreeItemCollapsibleState.Collapsed
        );
        item.id = id;
        item.description = String(node.connections.length);
        item.iconPath = new vsc.ThemeIcon("symbol-namespace");
        item.contextValue = "esiBus";
        return item;
      }
      if (node.kind === "connection") {
        // Under a filter, open the connections that are shown for their fields.
        const narrowed = filtering && node.fields.length < node.fieldCount;
        const item = new vsc.TreeItem(
          node.name,
          node.fields.length === 0
            ? vsc.TreeItemCollapsibleState.None
            : narrowed
              ? vsc.TreeItemCollapsibleState.Expanded
              : vsc.TreeItemCollapsibleState.Collapsed
        );
        item.id = id;
        item.description = node.description;
        item.iconPath = new vsc.ThemeIcon("plug");
        item.contextValue =
          CONTEXT_CONNECTION +
          (node.connection.sourceFile || node.message?.sourceFile ? HAS_DEFINITION : "");
        const arg: InsertComponentArg = { kind: "connection", name: node.name };
        item.command = {
          command: INSERT_COMPONENT_COMMAND,
          title: "Insert at Cursor",
          arguments: [arg],
        };
        return item;
      }
      const item = new vsc.TreeItem(
        node.name,
        vsc.TreeItemCollapsibleState.None
      );
      item.id = id;
      item.description = node.description;
      item.iconPath = new vsc.ThemeIcon(
        (node.field.enums?.length ?? 0) > 0 ? "symbol-enum" : "symbol-field"
      );
      item.contextValue =
        CONTEXT_FIELD + (node.message.sourceFile ? HAS_DEFINITION : "");
      const arg: InsertComponentArg = {
        kind: "field",
        name: node.name,
        connectionName: node.connectionName,
      };
      item.command = {
        command: INSERT_COMPONENT_COMMAND,
        title: "Insert at Cursor",
        arguments: [arg],
      };
      return item;
    },

    // Tooltips are the hover cards; built only for the item pointed at.
    resolveTreeItem(item: vscode.TreeItem, node: ComponentNode): vscode.TreeItem {
      if (node.kind === "connection") {
        const index = getIndex();
        if (index) {
          item.tooltip = renderConnection(node.connection, index);
        }
      } else if (node.kind === "field") {
        item.tooltip = renderField(node.field, node.message);
      }
      return item;
    },
  };

  const view = vsc.window.createTreeView(COMPONENT_BROWSER_VIEW, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  /** Title-bar text and the context keys behind the welcome texts / buttons. */
  const sync = (): void => {
    const tree = currentTree();
    const filtering = filterTerms(filter).length > 0;
    view.description =
      tree && filtering
        ? `"${filter.trim()}" — ${tree.connectionCount} of ${tree.totalConnections}`
        : undefined;
    void vsc.commands.executeCommand("setContext", STATE_KEY, treeState(tree));
    void vsc.commands.executeCommand("setContext", FILTERED_KEY, filtering);
  };

  const refresh = (): void => {
    built = undefined;
    sync();
    changed.fire();
  };

  sync();

  return vsc.Disposable.from(
    view,
    changed,
    // A config file changed on disk, or the index was rebuilt for a profile.
    onIndexChanged(refresh),
    // Also the switch itself: covers a profile that has no config files.
    onActiveProfileChanged(refresh),

    vsc.commands.registerCommand(FILTER_COMMAND, async () => {
      const value = await vsc.window.showInputBox({
        title: "Filter Components",
        prompt:
          "Connection, message, field or enum value name. Several words must all match. Empty clears the filter.",
        placeHolder: "e.g. 429 course",
        value: filter,
      });
      if (value === undefined) {
        return; // cancelled
      }
      filter = value.trim();
      refresh();
    }),

    vsc.commands.registerCommand(CLEAR_FILTER_COMMAND, () => {
      if (filter !== "") {
        filter = "";
        refresh();
      }
    }),

    vsc.commands.registerCommand(
      GOTO_DEFINITION_COMMAND,
      async (node?: ComponentNode) => {
        const index = getIndex();
        if (!index || !node) {
          return;
        }
        // First target with a readable source file: a connection's own
        // element, else its message.
        for (const target of definitionTargetsOf(index, node)) {
          const loc = resolveDefinition(target);
          if (!loc) {
            continue;
          }
          await vsc.window.showTextDocument(vsc.Uri.file(loc.file), {
            selection: new vsc.Range(
              loc.line,
              loc.character,
              loc.line,
              loc.character + loc.length
            ),
          });
          return;
        }
        void vsc.window.showInformationMessage(
          "The config file this component was read from could not be opened."
        );
      }
    )
  );
}
