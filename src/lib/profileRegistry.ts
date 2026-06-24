import type * as vscode from "vscode";
import {
  ProfileConfigs,
  RegistryModel,
  loadRegistryModel,
} from "./testpitRegistry";
import * as store from "./pluginStore";

/**
 * The profile/exe model that replaces the old built-in "projects".
 *
 * - Profiles + their config-file paths come from the Windows registry
 *   (TestPit's GUI settings), cached in pluginStore so we read the registry
 *   at most once per session (plus on explicit reload).
 * - The console TestPit.exe path is NOT in the registry — it's a plugin-owned
 *   setting the user picks once via a dialog.
 */

export const onActiveProfileChanged: vscode.Event<void> =
  store.onActiveProfileChanged;

/** First-run load: populate the cache from the registry if it's empty. */
export function ensureRegistryLoaded(): void {
  if (!store.getRegistryModel()) {
    reloadRegistry();
  }
}

/** Re-export the registry, refresh the cache, and notify subscribers. */
export function reloadRegistry(): RegistryModel | undefined {
  const model = loadRegistryModel();
  store.setRegistryModel(model);
  const active = store.getActiveProfileName();
  if (model && (!active || !model.profiles.includes(active))) {
    // No (or stale) selection → adopt the registry's currently-selected one.
    store.setActiveProfileName(model.defaultProfile); // fires the change event
  } else {
    store.notifyActiveProfileChanged(); // same profile, but paths may have moved
  }
  return model;
}

export function getProfiles(): string[] {
  return store.getRegistryModel()?.profiles ?? [];
}

/** The active profile, falling back to the registry's default when unset/stale. */
export function getActiveProfileName(): string | undefined {
  const model = store.getRegistryModel();
  const stored = store.getActiveProfileName();
  if (stored && (!model || model.profiles.includes(stored))) {
    return stored;
  }
  return model?.defaultProfile;
}

export async function setActiveProfile(name: string): Promise<void> {
  await store.setActiveProfileName(name);
}

/** Resolved config-file paths for the active profile (empty if none). */
export function getActiveConfigs(): ProfileConfigs {
  const model = store.getRegistryModel();
  const name = getActiveProfileName();
  if (!model || !name) {
    return {};
  }
  return model.configs[name] ?? {};
}

export function getTestpitExe(): string | undefined {
  return store.getTestpitExe();
}

/**
 * Return the configured TestPit.exe, prompting once via a file dialog if it
 * hasn't been picked yet. Use this from explicit user commands — NOT from the
 * live (per-keystroke) diagnostics path, which must never pop a dialog.
 */
export async function ensureTestpitExe(): Promise<string | undefined> {
  const existing = store.getTestpitExe();
  if (existing) {
    return existing;
  }
  return pickTestpitExe();
}

/**
 * On activation, if no TestPit.exe is configured, nudge the user to pick one —
 * .esi validation is disabled until then. Non-blocking; the button opens the
 * same dialog as the "Pick TestPit Executable" command. Stops appearing once
 * an exe is set.
 */
export async function promptForExeIfUnset(): Promise<void> {
  if (store.getTestpitExe()) {
    return;
  }
  const vsc: typeof vscode = require("vscode");
  const choice = await vsc.window.showWarningMessage(
    "TestPit.exe is not set — .esi script validation is disabled until you select it.",
    "Select TestPit.exe"
  );
  if (choice === "Select TestPit.exe") {
    await pickTestpitExe();
  }
}

/** Always prompt for the TestPit.exe (used to repoint it) and persist. */
export async function pickTestpitExe(): Promise<string | undefined> {
  const vsc: typeof vscode = require("vscode");
  const picks = await vsc.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Select TestPit.exe",
    title: "Select the console TestPit.exe used for script validation",
    filters: { Executable: ["exe"] },
  });
  const picked = picks?.[0]?.fsPath;
  if (picked) {
    store.setTestpitExe(picked);
  }
  return picked;
}
