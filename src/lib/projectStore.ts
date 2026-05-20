import type * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { InspectLike, Scope, planMigration } from "./migration";

// Persistence layer for the currently active TestPit project.
//
// Storage lives in `context.globalState` (machine-wide, per VS Code install)
// rather than workspace settings. The id is keyed by the first workspace
// folder's fsPath; single-file mode falls back to the NO_WORKSPACE sentinel.
//
// Subscribers react to changes via `onActiveProjectChanged` — globalState
// does NOT raise onDidChangeConfiguration, so we own the event bus.

const ACTIVE_PROJECT_KEY_PREFIX = "activeProject::";
const MIGRATION_DONE_KEY_PREFIX = "migration.activeProject.v1Done::";
const NO_WORKSPACE = "__no_workspace__";
// Legacy property name in workspace config; cleared by migration.
const LEGACY_CONFIG_KEY = "activeProject";

let ctx: vscode.ExtensionContext | undefined;
let emitter: vscode.EventEmitter<void> | undefined;

export function initProjectStore(context: vscode.ExtensionContext): void {
  const vsc: typeof vscode = require("vscode");
  ctx = context;
  if (!emitter) {
    emitter = new vsc.EventEmitter<void>();
    context.subscriptions.push(emitter);
  }
  runMigrationOnce();
}

export function getStoredProjectId(): string | undefined {
  if (!ctx) return undefined;
  const value = ctx.globalState.get<string>(idKey());
  return value && value.length > 0 ? value : undefined;
}

export async function setStoredProjectId(
  id: string | undefined
): Promise<void> {
  if (!ctx) return;
  await ctx.globalState.update(idKey(), id);
  emitter?.fire();
}

export const onActiveProjectChanged: vscode.Event<void> = (listener, thisArgs, disposables) => {
  if (!emitter) {
    // Pre-init: return a no-op disposable. In production initProjectStore
    // runs first in activate(), so this path is only hit by tests that
    // skip the init step.
    return { dispose: () => undefined };
  }
  return emitter.event(listener, thisArgs, disposables);
};

function idKey(): string {
  return `${ACTIVE_PROJECT_KEY_PREFIX}${currentWorkspaceKey()}`;
}

function migrationDoneKey(): string {
  return `${MIGRATION_DONE_KEY_PREFIX}${currentWorkspaceKey()}`;
}

function currentWorkspaceKey(): string {
  const vsc: typeof vscode = require("vscode");
  const folders: readonly vscode.WorkspaceFolder[] | undefined = vsc.workspace.workspaceFolders;
  const first = folders && folders[0];
  return first ? first.uri.fsPath : NO_WORKSPACE;
}

function runMigrationOnce(): void {
  if (!ctx) return;
  const vsc: typeof vscode = require("vscode");
  const folders = vsc.workspace.workspaceFolders;
  // Skip silently when no workspace is open — migration would have nothing
  // workspace-scoped to read anyway. Mark-done is also skipped so a real
  // workspace launch later still gets a clean migration pass.
  const alreadyDone = !!ctx.globalState.get<boolean>(migrationDoneKey());
  const config = vsc.workspace.getConfiguration(CONFIG_SECTION);
  const inspect = config.inspect<string>(LEGACY_CONFIG_KEY) as InspectLike | undefined;
  const actions = planMigration(inspect, alreadyDone);

  if (actions.writeId !== undefined) {
    void ctx.globalState.update(idKey(), actions.writeId);
  }
  for (const scope of actions.clearScopes) {
    void safeClear(config, LEGACY_CONFIG_KEY, scope);
  }
  if (actions.markDone && folders && folders.length > 0) {
    void ctx.globalState.update(migrationDoneKey(), true);
  }
}

function safeClear(
  config: vscode.WorkspaceConfiguration,
  key: string,
  scope: Scope
): Thenable<void> | undefined {
  const vsc: typeof vscode = require("vscode");
  const target =
    scope === "global"
      ? vsc.ConfigurationTarget.Global
      : scope === "workspace"
      ? vsc.ConfigurationTarget.Workspace
      : vsc.ConfigurationTarget.WorkspaceFolder;
  try {
    return config.update(key, undefined, target);
  } catch {
    // No workspace open, no workspace folder, or VS Code refused the scope.
    // Migration is best-effort; the property has already been removed from
    // package.json so leftover entries are harmless garbage.
    return undefined;
  }
}
