import type * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RegistryModel } from "./testpitRegistry";

/**
 * Plugin-owned persistence — a single JSON file in the extension's global
 * storage. Holds the user's TestPit.exe path, the active profile name, and the
 * cached registry model so we don't shell out to `reg export` every session.
 *
 * Replaces the old globalState-keyed "active project" store. The active-profile
 * change event lives here (a JSON file raises no onDidChangeConfiguration).
 */

export interface PluginState {
  /** Absolute path to the console TestPit.exe (picked once via a dialog). */
  testpitExe?: string;
  /** Currently selected registry profile name. */
  activeProfile?: string;
  /** Cached registry export (profiles + per-profile config paths). */
  registry?: RegistryModel;
}

const FILE_NAME = "testpit-settings.json";

let ctx: vscode.ExtensionContext | undefined;
let state: PluginState = {};
let emitter: vscode.EventEmitter<void> | undefined;

export function initPluginStore(context: vscode.ExtensionContext): void {
  const vsc: typeof vscode = require("vscode");
  ctx = context;
  if (!emitter) {
    emitter = new vsc.EventEmitter<void>();
    context.subscriptions.push(emitter);
  }
  state = readFile();
}

export function getState(): PluginState {
  return state;
}

export function getTestpitExe(): string | undefined {
  return nonEmpty(state.testpitExe);
}

export function setTestpitExe(p: string | undefined): void {
  state.testpitExe = p;
  writeFile();
}

export function getActiveProfileName(): string | undefined {
  return nonEmpty(state.activeProfile);
}

export function setActiveProfileName(name: string | undefined): void {
  state.activeProfile = name;
  writeFile();
  emitter?.fire();
}

/**
 * Fire the change event without mutating state — used after a registry reload
 * so subscribers re-read even when the active profile name didn't change.
 */
export function notifyActiveProfileChanged(): void {
  emitter?.fire();
}

export function getRegistryModel(): RegistryModel | undefined {
  return state.registry;
}

export function setRegistryModel(model: RegistryModel | undefined): void {
  state.registry = model;
  writeFile();
}

/**
 * Fires when the active profile changes. Subscribers (status bar, index cache,
 * component diagnostics) re-read on this. Pre-init it's a no-op disposable so
 * tests that skip initPluginStore don't crash.
 */
export const onActiveProfileChanged: vscode.Event<void> = (
  listener,
  thisArgs,
  disposables
) => {
  if (!emitter) {
    return { dispose: () => undefined };
  }
  return emitter.event(listener, thisArgs, disposables);
};

function storageDir(): string | undefined {
  return ctx?.globalStorageUri?.fsPath;
}

function filePath(): string | undefined {
  const dir = storageDir();
  return dir ? path.join(dir, FILE_NAME) : undefined;
}

function readFile(): PluginState {
  const fp = filePath();
  if (!fp) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as PluginState;
  } catch {
    // Missing / unreadable / malformed — start clean.
    return {};
  }
}

function writeFile(): void {
  const dir = storageDir();
  const fp = filePath();
  if (!dir || !fp) {
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn("esihelper: failed to persist plugin settings:", err);
  }
}

function nonEmpty(s: string | undefined): string | undefined {
  return s && s.length > 0 ? s : undefined;
}
