// Test setup: provide a lightweight `vscode` mock for unit tests.
const mock = require('mock-require');

mock('vscode', {
  window: {
    createOutputChannel: function (name) {
      return {
        name,
        append: function () {},
        appendLine: function () {},
        show: function () {},
        clear: function () {},
        dispose: function () {},
      };
    },
  },
});
