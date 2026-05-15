import * as vscode from "vscode";
import { OUTPUT_CHANNEL_NAME } from "../constants";

let instance: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!instance) {
    instance = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return instance;
}
