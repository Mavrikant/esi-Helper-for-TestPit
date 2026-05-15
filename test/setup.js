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
  },
  Range,
  Diagnostic,
  DiagnosticSeverity,
  MarkdownString,
});
