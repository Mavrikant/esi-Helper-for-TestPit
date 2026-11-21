import * as path from "path";

/** Just the `join` half of `path` / `path.win32` — injectable so the Windows
 *  shape is testable on any host. */
export interface PathJoiner {
  join(...parts: string[]): string;
}

/**
 * Where TestPit drops the macro-expanded copy of the last script it checked:
 * `<home>\Documents\Testpit\Preprocessed.esi`. `homeDir` is `os.homedir()` in
 * production (so a profile folder that differs from the login name, or one on
 * another drive, still resolves).
 */
export function preprocessedEsiPath(
  homeDir: string,
  joiner: PathJoiner = path
): string {
  return joiner.join(homeDir, "Documents", "Testpit", "Preprocessed.esi");
}

/** Error text for when the preprocessed file can't be opened: names the path
 *  that was tried and says how the file comes to exist. */
export function preprocessedOpenFailureMessage(filePath: string): string {
  return (
    `Could not open the preprocessed file: ${filePath}. ` +
    "TestPit writes it during a validity check — run a validity check first, then try again."
  );
}
