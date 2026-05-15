import * as cp from "child_process";
import * as util from "util";

const execAsync = util.promisify(cp.exec);

export function runValidityCheckSync(command: string): string {
  return cp.execSync(command).toString();
}

export async function runValidityCheckAsync(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.toString();
}

export function runCommandDetached(command: string): void {
  cp.exec(command);
}
