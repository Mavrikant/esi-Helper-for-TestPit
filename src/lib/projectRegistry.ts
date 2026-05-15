import type * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import {
  BUILT_IN_IDS,
  Project,
  buildBuiltInProject,
} from "../projects";

const ACTIVE_PROJECT_KEY = "activeProject";
const CUSTOM_PROJECTS_KEY = "customProjects";

export function loadProjects(): Project[] {
  const vsc: typeof vscode = require("vscode");
  const config = vsc.workspace.getConfiguration(CONFIG_SECTION);
  const merged = new Map<string, Project>();
  for (const id of BUILT_IN_IDS) {
    const exe = config.get<string>(`${id}.executablePath`) ?? "";
    const cfg = config.get<string>(`${id}.configFolderpath`) ?? "";
    merged.set(id, buildBuiltInProject(id, exe, cfg));
  }
  const custom = config.get<unknown[]>(CUSTOM_PROJECTS_KEY) ?? [];
  for (const entry of custom) {
    const project = validateCustomProject(entry);
    if (project) {
      merged.set(project.id, project);
    }
  }
  return Array.from(merged.values());
}

export function getActiveProjectId(): string | undefined {
  const vsc: typeof vscode = require("vscode");
  const value = vsc.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(ACTIVE_PROJECT_KEY);
  return value && value.length > 0 ? value : undefined;
}

export async function setActiveProjectId(id: string): Promise<void> {
  const vsc: typeof vscode = require("vscode");
  await vsc.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(ACTIVE_PROJECT_KEY, id, vsc.ConfigurationTarget.Workspace);
}

export function getActiveProject(): Project | undefined {
  const id = getActiveProjectId();
  if (!id) {
    return undefined;
  }
  return loadProjects().find((p) => p.id === id);
}

export async function getOrPromptForProject(): Promise<Project | undefined> {
  const existing = getActiveProject();
  if (existing) {
    return existing;
  }
  const vsc: typeof vscode = require("vscode");
  const projects = loadProjects();
  const pick = await vsc.window.showQuickPick(
    projects.map((p) => ({ label: p.label, description: p.id, id: p.id })),
    { placeHolder: "Select TestPit project" }
  );
  if (!pick) {
    return undefined;
  }
  await setActiveProjectId(pick.id);
  return projects.find((p) => p.id === pick.id);
}

function validateCustomProject(value: unknown): Project | undefined {
  if (!value || typeof value !== "object") {
    console.warn("esihelper: skipping custom project entry — not an object", value);
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const label = obj.label;
  const executablePath = obj.executablePath;
  const validityArgs = obj.validityArgs;
  const openArgs = obj.openArgs ?? ["--ow={filePath}"];
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof executablePath !== "string" ||
    !isStringArray(validityArgs) ||
    !isStringArray(openArgs)
  ) {
    console.warn("esihelper: skipping malformed custom project entry", value);
    return undefined;
  }
  return { id, label, executablePath, validityArgs, openArgs };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
