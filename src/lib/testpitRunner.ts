import * as cp from "child_process";
import * as util from "util";
import { TESTPIT_EXECUTABLE } from "../constants";

const execAsync = util.promisify(cp.exec);

export function buildValidityCommand(
  configFolderpath: string,
  scriptFilePath: string
): string {
  return [
    TESTPIT_EXECUTABLE,
    `--cf=${configFolderpath}MessageConfig_RNESystemTestCable.xml`,
    `--ac=${configFolderpath}A429MessageFields.xml`,
    `--mc=${configFolderpath}1553MessageFields.xml`,
    `--dc=${configFolderpath}DiscreteSignals.xml`,
    `--pc=${configFolderpath}MemoryPorts.xml`,
    `--sf="${scriptFilePath}"`,
    "--validateScriptOnly=true",
  ].join(" ");
}

export function runValidityCheckSync(
  configFolderpath: string,
  scriptFilePath: string
): string {
  const command = buildValidityCommand(configFolderpath, scriptFilePath);
  return cp.execSync(command).toString();
}

export async function runValidityCheckAsync(
  configFolderpath: string,
  scriptFilePath: string
): Promise<string> {
  const command = buildValidityCommand(configFolderpath, scriptFilePath);
  const { stdout } = await execAsync(command);
  return stdout.toString();
}

export function openInTestPit(filePath: string): void {
  cp.exec(`${TESTPIT_EXECUTABLE} --ow=${filePath}`);
}
