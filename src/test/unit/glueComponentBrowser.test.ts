import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  INSERT_COMPONENT_COMMAND,
  registerInsertComponent,
} from "../../commands/insertComponent";
import { ComponentNode } from "../../lib/componentTree";
import { XmlIndex, parseConfigFolder } from "../../lib/xmlIndex";
import {
  CLEAR_FILTER_COMMAND,
  COMPONENT_BROWSER_VIEW,
  FILTER_COMMAND,
  GOTO_DEFINITION_COMMAND,
  registerComponentBrowser,
} from "../../views/componentBrowser";

// Glue for the component browser view and its insert command, driven through
// the vscode mock (test/setup.js). The model and the insertion text are tested
// in componentTree.test.ts / componentInsert.test.ts; these guard the wiring.
// What the shared mock does not have yet is added here for the duration of the
// suite and removed again.

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "src", "test", "fixtures");
const RNE = parseConfigFolder(path.join(FIXTURES, "config"));

// The module object itself (not the import namespace, which only mirrors the
// members the mock had when this file was loaded).
const mock = require("vscode");
const commands = mock.__registered.commands as Record<
  string,
  (...args: unknown[]) => unknown
>;

interface FakeView {
  id: string;
  provider: vscode.TreeDataProvider<ComponentNode>;
  description?: string;
  dispose(): void;
}

describe("component browser glue", () => {
  const saved: Record<string, unknown> = {};
  const savedWindow: Record<string, unknown> = {};
  let view: FakeView | undefined;
  let context: Record<string, unknown>;
  let inputAnswer: string | undefined;
  let shown: { target: any; options: any }[];
  let infos: string[];

  before(() => {
    for (const key of ["TreeItem", "ThemeIcon", "TreeItemCollapsibleState"]) {
      saved[key] = mock[key];
    }
    for (const key of [
      "createTreeView",
      "showInputBox",
      "showTextDocument",
      "showInformationMessage",
      "activeTextEditor",
    ]) {
      savedWindow[key] = mock.window[key];
    }
    saved.executeCommand = mock.commands.executeCommand;

    mock.TreeItem = class TreeItem {
      constructor(public label: string, public collapsibleState: number) {}
    };
    mock.ThemeIcon = class ThemeIcon {
      constructor(public id: string) {}
    };
    mock.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
    mock.window.createTreeView = (id: string, options: any): FakeView =>
      (view = { id, provider: options.treeDataProvider, dispose() {} });
    mock.window.showInputBox = () => Promise.resolve(inputAnswer);
    mock.window.showTextDocument = (target: any, options: any) => {
      shown.push({ target, options });
      return Promise.resolve(undefined);
    };
    mock.window.showInformationMessage = (message: string) => {
      infos.push(message);
      return Promise.resolve(undefined);
    };
    mock.commands.executeCommand = (id: string, key: string, value: unknown) => {
      if (id === "setContext") {
        context[key] = value;
      }
      return Promise.resolve(undefined);
    };
  });

  after(() => {
    for (const key of Object.keys(savedWindow)) {
      mock.window[key] = savedWindow[key];
    }
    mock.commands.executeCommand = saved.executeCommand;
    for (const key of ["TreeItem", "ThemeIcon", "TreeItemCollapsibleState"]) {
      mock[key] = saved[key];
    }
  });

  beforeEach(() => {
    view = undefined;
    context = {};
    inputAnswer = undefined;
    shown = [];
    infos = [];
    mock.window.activeTextEditor = undefined;
  });

  function open(index: XmlIndex | undefined): {
    view: FakeView;
    roots: () => ComponentNode[];
    kids: (n: ComponentNode) => ComponentNode[];
    item: (n: ComponentNode) => any;
    setIndex: (next: XmlIndex | undefined) => void;
    disposable: vscode.Disposable;
  } {
    let current = index;
    const disposable = registerComponentBrowser(() => current);
    assert.ok(view);
    const v = view;
    const p = v.provider;
    return {
      view: v,
      roots: () => p.getChildren() as ComponentNode[],
      kids: (n) => p.getChildren(n) as ComponentNode[],
      item: (n) => p.getTreeItem(n),
      setIndex: (next) => (current = next),
      disposable,
    };
  }

  it("registers the view and shows the no-config state without an index", () => {
    const b = open(undefined);
    assert.strictEqual(b.view.id, COMPONENT_BROWSER_VIEW);
    assert.deepStrictEqual(b.roots(), []);
    assert.strictEqual(context["esihelper.componentBrowser.state"], "noConfig");
    assert.strictEqual(context["esihelper.componentBrowser.filtered"], false);
    b.disposable.dispose();
  });

  it("serves bus → connection → field items", () => {
    const b = open(RNE);
    assert.strictEqual(context["esihelper.componentBrowser.state"], "ok");
    const buses = b.roots();
    assert.deepStrictEqual(
      buses.map((n) => b.item(n).label),
      ["ARINC 429", "MIL-STD-1553", "Discrete", "Memory", "VORILS"]
    );
    const busItem = b.item(buses[0]);
    assert.strictEqual(busItem.collapsibleState, 1);
    assert.strictEqual(busItem.command, undefined);
    assert.strictEqual(busItem.description, "2");

    const conn = b.kids(buses[0])[0];
    const connItem = b.item(conn);
    assert.strictEqual(connItem.label, "429_L100SelectedCourseBNR_input1");
    assert.strictEqual(connItem.description, "SelectedCourseBNR · 5 fields");
    assert.strictEqual(connItem.collapsibleState, 1);
    assert.strictEqual(connItem.contextValue, "esiConnection hasDefinition");
    assert.deepStrictEqual(connItem.command, {
      command: INSERT_COMPONENT_COMMAND,
      title: "Insert at Cursor",
      arguments: [{ kind: "connection", name: "429_L100SelectedCourseBNR_input1" }],
    });

    const sdi = b.kids(conn).find((n) => b.item(n).label === "SDI");
    assert.ok(sdi);
    const fieldItem = b.item(sdi);
    assert.strictEqual(fieldItem.collapsibleState, 0);
    assert.strictEqual(fieldItem.description, "Enum · 2 enum values");
    assert.strictEqual(fieldItem.iconPath.id, "symbol-enum");
    assert.strictEqual(fieldItem.contextValue, "esiField hasDefinition");
    assert.deepStrictEqual(fieldItem.command.arguments, [
      { kind: "field", name: "SDI", connectionName: "429_L100SelectedCourseBNR_input1" },
    ]);
    assert.deepStrictEqual(b.kids(sdi), []);
    b.disposable.dispose();
  });

  it("gives every item of the tree a distinct id", () => {
    const b = open(RNE);
    const ids: string[] = [];
    const walk = (nodes: ComponentNode[]): void => {
      for (const n of nodes) {
        ids.push(b.item(n).id);
        walk(b.kids(n));
      }
    };
    walk(b.roots());
    assert.strictEqual(new Set(ids).size, ids.length);
    b.disposable.dispose();
  });

  it("offers no definition action when the index recorded no source file", () => {
    const index = parseConfigFolder(path.join(FIXTURES, "config"));
    for (const c of index.connections.values()) {
      delete c.sourceFile;
    }
    for (const m of index.messagesByBus.values()) {
      delete m.sourceFile;
    }
    const b = open(index);
    const conn = b.kids(b.roots()[0])[0];
    assert.strictEqual(b.item(conn).contextValue, "esiConnection");
    assert.strictEqual(b.item(b.kids(conn)[0]).contextValue, "esiField");
    b.disposable.dispose();
  });

  it("uses the hover cards as tooltips", () => {
    const b = open(RNE);
    const conn = b.kids(b.roots()[0])[0];
    const resolve = b.view.provider.resolveTreeItem!.bind(b.view.provider);
    const connItem = resolve(b.item(conn), conn, undefined as any) as any;
    assert.ok(connItem.tooltip.value.includes("429_L100SelectedCourseBNR_input1"));
    const field = b.kids(conn)[0];
    const fieldItem = resolve(b.item(field), field, undefined as any) as any;
    assert.ok(fieldItem.tooltip.value.includes(b.item(field).label));
    b.disposable.dispose();
  });

  it("filters through the input box, shows the count, and clears", async () => {
    const b = open(RNE);
    let fired = 0;
    b.view.provider.onDidChangeTreeData!(() => fired++);

    inputAnswer = "  RangeValid ";
    await commands[FILTER_COMMAND]();
    assert.strictEqual(fired, 1);
    assert.strictEqual(context["esihelper.componentBrowser.filtered"], true);
    assert.strictEqual(context["esihelper.componentBrowser.state"], "ok");
    assert.strictEqual(b.view.description, `"RangeValid" — 2 of ${RNE.connections.size}`);
    const buses = b.roots();
    assert.deepStrictEqual(buses.map((n) => b.item(n).label), ["MIL-STD-1553"]);
    assert.strictEqual(b.item(buses[0]).collapsibleState, 2);
    const conn = b.kids(buses[0])[0];
    assert.strictEqual(b.item(conn).collapsibleState, 2);
    assert.deepStrictEqual(
      b.kids(conn).map((n) => b.item(n).label),
      ["DataValidity.RangeValid"]
    );
    assert.ok(String(b.item(conn).id).startsWith("f|"));

    inputAnswer = "nothing-matches-this";
    await commands[FILTER_COMMAND]();
    assert.strictEqual(context["esihelper.componentBrowser.state"], "noMatch");
    assert.deepStrictEqual(b.roots(), []);

    // Cancelling the input box changes nothing.
    inputAnswer = undefined;
    await commands[FILTER_COMMAND]();
    assert.strictEqual(fired, 2);
    assert.strictEqual(context["esihelper.componentBrowser.filtered"], true);

    await commands[CLEAR_FILTER_COMMAND]();
    assert.strictEqual(fired, 3);
    assert.strictEqual(context["esihelper.componentBrowser.filtered"], false);
    assert.strictEqual(context["esihelper.componentBrowser.state"], "ok");
    assert.strictEqual(b.view.description, undefined);
    assert.strictEqual(b.roots().length, 5);
    b.disposable.dispose();
  });

  it("builds a new tree when the index object changes", () => {
    const b = open(RNE);
    assert.strictEqual(b.roots().length, 5);
    b.setIndex(parseConfigFolder(path.join(FIXTURES, "config", "neocas")));
    assert.deepStrictEqual(
      b.roots().map((n) => b.item(n).label),
      ["ARINC 429", "Memory", "External Data"]
    );
    b.setIndex(undefined);
    assert.deepStrictEqual(b.roots(), []);
    b.disposable.dispose();
  });

  it("opens the XML definition of a connection and of a field", async () => {
    const b = open(RNE);
    const conn = b.kids(b.roots()[0])[0];
    await commands[GOTO_DEFINITION_COMMAND](conn);
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(path.basename(shown[0].target.fsPath), "MessageConfig_Test.xml");
    assert.ok(shown[0].options.selection.start.line > 0);

    const sdi = b.kids(conn).find((n) => b.item(n).label === "SDI");
    await commands[GOTO_DEFINITION_COMMAND](sdi);
    assert.strictEqual(shown.length, 2);
    assert.strictEqual(path.basename(shown[1].target.fsPath), "A429MessageFields.xml");
    const sel = shown[1].options.selection;
    assert.strictEqual(sel.end.character - sel.start.character, "SDI".length);

    // No node (palette), a bus: nothing opens.
    await commands[GOTO_DEFINITION_COMMAND]();
    assert.strictEqual(shown.length, 2);
    await commands[GOTO_DEFINITION_COMMAND](b.roots()[0]);
    assert.strictEqual(shown.length, 2);
    assert.strictEqual(infos.length, 1);
    b.disposable.dispose();
  });

  describe("insert command", () => {
    function fakeEditor(text: string, line: number, languageId = "esi"): any {
      const calls: { snippet: string; range: vscode.Range; options: any }[] = [];
      return {
        calls,
        viewColumn: 1,
        document: { languageId, getText: () => text },
        selection: { active: new vscode.Position(line, 0) },
        insertSnippet(snippet: vscode.SnippetString, range: vscode.Range, options: any) {
          calls.push({ snippet: snippet.value, range, options });
          return Promise.resolve(true);
        },
      };
    }

    it("inserts a connection block as a whitespace-keeping snippet and refocuses the editor", async () => {
      registerInsertComponent(() => RNE);
      const editor = fakeEditor("[STEP INPUTS]\r\n\r\n[/STEP INPUTS]", 1);
      mock.window.activeTextEditor = editor;
      await commands[INSERT_COMPONENT_COMMAND]({ kind: "connection", name: "DIS_PowerOnOff" });
      assert.strictEqual(editor.calls.length, 1);
      const call = editor.calls[0];
      assert.strictEqual(
        call.snippet,
        "    [DIS_PowerOnOff]\n        $0\n    [/DIS_PowerOnOff]"
      );
      assert.deepStrictEqual(
        [call.range.start.line, call.range.start.character, call.range.end.line, call.range.end.character],
        [1, 0, 1, 0]
      );
      assert.strictEqual(call.options.keepWhitespace, true);
      assert.strictEqual(shown.length, 1);
      assert.strictEqual(shown[0].target, editor.document);
    });

    it("inserts 'field = ' below the cursor line", async () => {
      registerInsertComponent(() => RNE);
      const editor = fakeEditor("    [DIS_PowerOnOff]\n    [/DIS_PowerOnOff]", 0);
      mock.window.activeTextEditor = editor;
      await commands[INSERT_COMPONENT_COMMAND]({
        kind: "field",
        name: "value",
        connectionName: "DIS_PowerOnOff",
      });
      assert.strictEqual(editor.calls[0].snippet, "\n        value = $0");
      assert.strictEqual(editor.calls[0].range.start.character, "    [DIS_PowerOnOff]".length);
    });

    it("does nothing but say so without an .esi editor", async () => {
      registerInsertComponent(() => RNE);
      await commands[INSERT_COMPONENT_COMMAND]({ kind: "connection", name: "DIS_PowerOnOff" });
      assert.strictEqual(infos.length, 1);
      const editor = fakeEditor("", 0, "xml");
      mock.window.activeTextEditor = editor;
      await commands[INSERT_COMPONENT_COMMAND]({ kind: "connection", name: "DIS_PowerOnOff" });
      assert.strictEqual(editor.calls.length, 0);
      assert.strictEqual(infos.length, 2);
    });

    it("ignores a missing argument and a connection the index no longer holds", async () => {
      registerInsertComponent(() => RNE);
      const editor = fakeEditor("", 0);
      mock.window.activeTextEditor = editor;
      await commands[INSERT_COMPONENT_COMMAND]();
      await commands[INSERT_COMPONENT_COMMAND]({ kind: "connection", name: "429_Gone" });
      registerInsertComponent(() => undefined);
      await commands[INSERT_COMPONENT_COMMAND]({ kind: "connection", name: "DIS_PowerOnOff" });
      assert.strictEqual(editor.calls.length, 0);
      assert.strictEqual(infos.length, 0);
    });
  });
});
