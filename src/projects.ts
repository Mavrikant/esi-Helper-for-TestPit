export interface Project {
  id: string;
  label: string;
  executablePath: string;
  validityArgs: string[];
  openArgs: string[];
}

export type BuiltInId = "RNE" | "VORILS";
export const BUILT_IN_IDS: BuiltInId[] = ["RNE", "VORILS"];

const DEFAULT_OPEN_ARGS = ["--ow={filePath}"];

export function buildBuiltInProject(
  id: BuiltInId,
  executablePath: string,
  configFolderpath: string
): Project {
  switch (id) {
    case "RNE":
      return {
        id: executablePath,
        label: "RNE",
        executablePath,
        validityArgs: [
          `--cf=${configFolderpath}MessageConfig_RNESystemTestCable.xml`,
          `--ac=${configFolderpath}A429MessageFields.xml`,
          `--mc=${configFolderpath}1553MessageFields.xml`,
          `--dc=${configFolderpath}DiscreteSignals.xml`,
          `--pc=${configFolderpath}MemoryPorts.xml`,
          "--sf={scriptPath}",
          "--validateScriptOnly=true",
        ],
        openArgs: [...DEFAULT_OPEN_ARGS],
      };
    case "VORILS":
      return {
        id: executablePath,
        label: "VORILS",
        executablePath,
        validityArgs: [
          "--sf={scriptPath}",
          "--pt=VORILS",
          `--cf=${configFolderpath}VORILS_Cable.xml`,
          `--dc=${configFolderpath}DiscreteSignals.xml`,
          `--pc=${configFolderpath}MemoryPorts.xml`,
          "--smf=true",
          `--vc=${configFolderpath}VORILSMessageFields.xml`,
          "--validateScriptOnly=true",
        ],
        openArgs: [...DEFAULT_OPEN_ARGS],
      };
  }
}

export function buildValidityCommand(project: Project, scriptPath: string): string {
  return joinCommand(
    project.executablePath,
    project.validityArgs.map((arg) => substitute(arg, "{scriptPath}", scriptPath))
  );
}

export function buildOpenCommand(project: Project, filePath: string): string {
  const args = project.openArgs.length > 0 ? project.openArgs : DEFAULT_OPEN_ARGS;
  return joinCommand(
    project.executablePath,
    args.map((arg) => substitute(arg, "{filePath}", filePath))
  );
}

function joinCommand(executablePath: string, args: string[]): string {
  return [quoteIfNeeded(executablePath), ...args].join(" ");
}

function substitute(template: string, placeholder: string, value: string): string {
  if (!template.includes(placeholder)) {
    return template;
  }
  // Always wrap substituted paths in quotes — they may contain spaces.
  const quoted = `"${value.replace(/"/g, "")}"`;
  return template.split(placeholder).join(quoted);
}

function quoteIfNeeded(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p;
  }
  return p.includes(" ") ? `"${p}"` : p;
}
