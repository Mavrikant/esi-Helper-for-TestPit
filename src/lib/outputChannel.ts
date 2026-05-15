import type * as vscode from "vscode";
import { OUTPUT_CHANNEL_NAME } from "../constants";

let instance: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!instance) {
    // Late require so tests can stub or mock the 'vscode' module
    // before this code runs.
    const vsc: typeof vscode = require("vscode");
    instance = vsc.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return instance;
}
