// Test setup: provide a lightweight `vscode` mock for unit tests.
// Required by mocha (--require ./test/setup.js) before any test loads, so
// any `require('vscode')` (including those compiled from `import * as vscode`)
// resolves to the mock below.
const mock = require('mock-require');

class Range {
  // Like the real one: (startLine, startCol, endLine, endCol) or (start, end).
  constructor(startLine, startCol, endLine, endCol) {
    if (typeof startLine === 'object') {
      this.start = { line: startLine.line, character: startLine.character };
      this.end = { line: startCol.line, character: startCol.character };
      return;
    }
    this.start = { line: startLine, character: startCol };
    this.end = { line: endLine, character: endCol };
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

class MarkdownString {
  constructor(value, supportThemeIcons) {
    this.value = value || '';
    this.supportThemeIcons = !!supportThemeIcons;
  }
  appendMarkdown(s) {
    this.value += s;
    return this;
  }
  appendText(s) {
    this.value += s;
    return this;
  }
  appendCodeblock(s, lang) {
    this.value += '\n```' + (lang || '') + '\n' + s + '\n```\n';
    return this;
  }
}

class SemanticTokensLegend {
  constructor(types, modifiers) {
    this.types = types;
    this.modifiers = modifiers;
  }
}

class SemanticTokensBuilder {
  constructor(legend) {
    this.legend = legend;
    this._tokens = [];
  }
  push(line, start, length, tokenType, tokenModifiers) {
    this._tokens.push({ line, start, length, tokenType, tokenModifiers });
  }
  build() {
    return { data: this._tokens };
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Selection {
  constructor(anchor, active) {
    this.anchor = anchor;
    this.active = active;
    this.start = anchor;
    this.end = active;
  }
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

class FoldingRange {
  constructor(start, end, kind) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value || '';
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      this._listeners.push(listener);
      return {
        dispose: () => {
          const i = this._listeners.indexOf(listener);
          if (i >= 0) this._listeners.splice(i, 1);
        },
      };
    };
  }
  fire(value) {
    for (const l of this._listeners.slice()) l(value);
  }
  dispose() {
    this._listeners.length = 0;
  }
}


// What the extension registered, keyed by kind / command id, so a test can
// call a provider or command the way VS Code would.
const registered = { providers: {}, commands: {} };
// Several providers of one kind may be registered (two hovers, two definition
// providers, ...): `providers[kind]` is the latest one, `all[kind]` every one
// in registration order (it grows on each activate()).
registered.all = {};
const keep = (kind) => (...args) => {
  const provider = args[args.length > 1 ? 1 : 0];
  (registered.all[kind] = registered.all[kind] || []).push(provider);
  registered.providers[kind] = provider;
  return { dispose() {} };
};

mock('vscode', {
  __registered: registered,
  window: {
    createOutputChannel(name) {
      return {
        name,
        append() {},
        appendLine() {},
        show() {},
        clear() {},
        dispose() {},
      };
    },
    createStatusBarItem(key, alignment, priority) {
      return {
        name: "",
        command: "",
        text: "",
        tooltip: "",
        backgroundColor: undefined,
        show() {},
        dispose() {},
      };
    },
    showOpenDialog() { return Promise.resolve(undefined); },
    showInformationMessage() { return Promise.resolve(undefined); },
    showWarningMessage() { return Promise.resolve(undefined); },
    showErrorMessage() { return Promise.resolve(undefined); },
    withProgress(_options, task) {
      return Promise.resolve(
        task(
          { report() {} },
          {
            isCancellationRequested: false,
            onCancellationRequested() { return { dispose() {} }; },
          }
        )
      );
    },
    createTextEditorDecorationType() { return { dispose() {} }; },
    createQuickPick() {
      const emitter = () => {
        const e = new EventEmitter();
        return e;
      };
      const active = emitter();
      const value = emitter();
      const accept = emitter();
      const hide = emitter();
      return {
        items: [],
        activeItems: [],
        selectedItems: [],
        value: "",
        title: undefined,
        placeholder: undefined,
        matchOnDescription: false,
        matchOnDetail: false,
        onDidChangeActive: active.event,
        onDidChangeValue: value.event,
        onDidAccept: accept.event,
        onDidHide: hide.event,
        // Test hooks: drive the picker the way a user would.
        _fireActive(items) { this.activeItems = items; active.fire(items); },
        _fireValue(v) { this.value = v; value.fire(v); },
        _fireAccept() { accept.fire(); },
        show() {},
        hide() { hide.fire(); },
        dispose() {},
      };
    },
    setStatusBarMessage() { return { dispose() {} }; },
    activeTextEditor: undefined,
  },
  languages: {
    registerDocumentSemanticTokensProvider() { return { dispose() {} }; },
    registerCompletionItemProvider() { return { dispose() {} }; },
    registerHoverProvider: keep('hover'),
    registerDefinitionProvider: keep('definition'),
    registerReferenceProvider: keep('reference'),
    registerRenameProvider: keep('rename'),
    registerDocumentHighlightProvider: keep('documentHighlight'),
    registerLinkedEditingRangeProvider: keep('linkedEditingRange'),
    registerDocumentLinkProvider: keep('documentLink'),
    registerCodeActionsProvider: keep('codeActions'),
    registerDocumentSymbolProvider: keep('documentSymbol'),
    registerFoldingRangeProvider: keep('foldingRange'),
    getDiagnostics() { return []; },
    createDiagnosticCollection() { return { clear() {}, set() {}, delete() {}, dispose() {} }; },
    registerDocumentFormattingEditProvider() { return { dispose() {} }; },
  },
  commands: {
    registerCommand(id, handler) {
      registered.commands[id] = handler;
      return { dispose() {} };
    },
    registerTextEditorCommand() { return { dispose() {} }; },
  },
  Range,
  Position,
  Selection,
  DocumentSymbol,
  FoldingRange,
  SnippetString,
  CompletionItem,
  // Values match the real vscode enums.
  SymbolKind: {
    File: 0, Module: 1, Namespace: 2, Interface: 10, Function: 11,
    Variable: 12, String: 14, Struct: 22,
  },
  FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  CompletionItemKind: {
    Field: 4, Variable: 5, Class: 6, Module: 8, Value: 11, Keyword: 13, EnumMember: 19,
  },
  Hover: class Hover { constructor(contents, range) { this.contents = contents; this.range = range; } },
  TextEdit: { replace(range, newText) { return { range, newText }; } },
  Diagnostic,
  DiagnosticSeverity,
  MarkdownString,
  SemanticTokensLegend,
  SemanticTokensBuilder,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  workspace: {
    textDocuments: [],
    workspaceFolders: undefined,
    onDidChangeConfiguration() { return { dispose() {} }; },
    onDidChangeTextDocument() { return { dispose() {} }; },
    onDidOpenTextDocument() { return { dispose() {} }; },
    onDidCloseTextDocument() { return { dispose() {} }; },
    onWillSaveTextDocument() { return { dispose() {} }; },
    onDidSaveTextDocument() { return { dispose() {} }; },
    getConfiguration() {
      return {
        get() { return undefined; },
        update() { return Promise.resolve(); },
        inspect() { return undefined; },
      };
    },
    createFileSystemWatcher() {
      return {
        onDidChange() { return { dispose() {} }; },
        onDidCreate() { return { dispose() {} }; },
        onDidDelete() { return { dispose() {} }; },
        dispose() {},
      };
    },
  },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) { this.base = base; this.pattern = pattern; }
  },
  Uri: {
    file(p) {
      const u = {
        scheme: 'file',
        fsPath: p,
        fragment: '',
        toString: () => p,
        with(change) { return Object.assign({}, u, change); },
      };
      return u;
    },
  },
  Disposable: class Disposable {
    constructor(fn) { this._fn = fn; }
    dispose() { if (this._fn) this._fn(); }
    static from(...items) {
      return new Disposable(() => items.forEach((d) => d && d.dispose && d.dispose()));
    }
  },
  Location: class Location { constructor(uri, range) { this.uri = uri; this.range = range; } },
  DocumentLink: class DocumentLink { constructor(range, target) { this.range = range; this.target = target; } },
  DocumentHighlight: class DocumentHighlight { constructor(range, kind) { this.range = range; this.kind = kind; } },
  DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
  LinkedEditingRanges: class LinkedEditingRanges {
    constructor(ranges, wordPattern) { this.ranges = ranges; this.wordPattern = wordPattern; }
  },
  DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  EventEmitter,
  CodeAction: class CodeAction {
    constructor(title, kind) { this.title = title; this.kind = kind; this.diagnostics = []; this.edit = undefined; }
  },
  CodeActionKind: { QuickFix: { value: "quickfix" } },
  WorkspaceEdit: class WorkspaceEdit {
    constructor() { this._edits = []; }
    replace(uri, range, text) { this._edits.push({ uri, range, text }); }
  },
});
