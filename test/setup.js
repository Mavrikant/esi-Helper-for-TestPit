// Test setup: provide a lightweight `vscode` mock for unit tests.
// Required by mocha (--require ./test/setup.js) before any test loads, so
// any `require('vscode')` (including those compiled from `import * as vscode`)
// resolves to the mock below.
const mock = require('mock-require');

class Range {
  constructor(startLine, startCol, endLine, endCol) {
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

mock('vscode', {
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
  },
  languages: {
    registerDocumentSemanticTokensProvider() { return { dispose() {} }; },
    registerCompletionItemProvider() { return { dispose() {} }; },
    registerHoverProvider() { return { dispose() {} }; },
    registerCodeActionsProvider() { return { dispose() {} }; },
    createDiagnosticCollection() { return { clear() {}, set() {}, delete() {}, dispose() {} }; },
    registerDocumentFormattingEditProvider() { return { dispose() {} }; },
  },
  commands: {
    registerCommand() { return { dispose() {} }; },
    registerTextEditorCommand() { return { dispose() {} }; },
  },
  Range,
  Diagnostic,
  DiagnosticSeverity,
  MarkdownString,
  SemanticTokensLegend,
  SemanticTokensBuilder,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  workspace: {
    textDocuments: [],
    onDidChangeConfiguration() { return { dispose() {} }; },
    onDidChangeTextDocument() { return { dispose() {} }; },
    onDidOpenTextDocument() { return { dispose() {} }; },
    onDidCloseTextDocument() { return { dispose() {} }; },
    onWillSaveTextDocument() { return { dispose() {} }; },
    onDidSaveTextDocument() { return { dispose() {} }; },
    getConfiguration() { return { get() { return undefined; }, update() { return Promise.resolve(); } }; },
  },
  Disposable: { from() { return { dispose() {} }; } },
  ConfigurationTarget: { Workspace: 1 },
  CodeAction: class CodeAction {
    constructor(title, kind) { this.title = title; this.kind = kind; this.diagnostics = []; this.edit = undefined; }
  },
  CodeActionKind: { QuickFix: { value: "quickfix" } },
  WorkspaceEdit: class WorkspaceEdit {
    constructor() { this._edits = []; }
    replace(uri, range, text) { this._edits.push({ uri, range, text }); }
  },
});
