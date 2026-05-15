import { OUTPUT_CHANNEL_NAME } from "../constants";

let instance: any;

export function getOutputChannel(): any {
  if (!instance) {
    // require vscode lazily so tests can stub or mock the module
    // without failing at module import time
    const vscode = require("vscode");
    instance = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return instance;
}
