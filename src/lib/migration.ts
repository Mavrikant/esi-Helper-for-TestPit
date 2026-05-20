// Pure planning helper for the one-time migration of `esihelper.activeProject`
// from workspace/user configuration into `context.globalState`.
//
// Kept vscode-free so the algorithm can be unit-tested directly with Node's
// assert. The VS Code side (reading inspect(), writing globalState, clearing
// config scopes) lives in src/lib/projectStore.ts and consumes MigrationActions.

export interface InspectLike {
  workspaceValue?: string;
  workspaceFolderValue?: string;
  globalValue?: string;
}

export type Scope = "workspace" | "workspaceFolder" | "global";

export interface MigrationActions {
  writeId?: string;
  clearScopes: Scope[];
  markDone: boolean;
}

export function planMigration(
  inspect: InspectLike | undefined,
  alreadyDone: boolean
): MigrationActions {
  if (alreadyDone) {
    return { clearScopes: [], markDone: false };
  }
  if (!inspect) {
    return { clearScopes: [], markDone: false };
  }
  const { workspaceFolderValue, workspaceValue, globalValue } = inspect;
  const writeId = pickFirstNonEmpty(
    workspaceFolderValue,
    workspaceValue,
    globalValue
  );
  const clearScopes: Scope[] = [];
  if (workspaceFolderValue !== undefined) {
    clearScopes.push("workspaceFolder");
  }
  if (workspaceValue !== undefined) {
    clearScopes.push("workspace");
  }
  if (globalValue !== undefined) {
    clearScopes.push("global");
  }
  if (writeId === undefined && clearScopes.length === 0) {
    return { clearScopes: [], markDone: false };
  }
  return { writeId, clearScopes, markDone: true };
}

function pickFirstNonEmpty(
  ...candidates: (string | undefined)[]
): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      return c;
    }
  }
  return undefined;
}
