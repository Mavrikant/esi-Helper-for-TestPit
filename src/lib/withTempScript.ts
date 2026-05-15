import * as fs from "fs";

export async function withTempScript<T>(
  baseFilePath: string,
  content: string,
  fn: (tempPath: string) => T | Promise<T>
): Promise<T> {
  const tempPath = `${baseFilePath}.temp`;
  fs.writeFileSync(tempPath, content);
  try {
    return await fn(tempPath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore — file may have already been removed
    }
  }
}
