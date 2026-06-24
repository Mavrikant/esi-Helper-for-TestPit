import * as cp from "child_process";

// TestPit prints its validation log (timestamped [Info]/[Warn.]/[Error] lines)
// and may exit non-zero when it reports issues. We therefore:
//   - capture BOTH stdout and stderr (the log may land on either), and
//   - ignore the exit code (a non-zero exit is normal when issues are found;
//     the diagnostics come from parsing the output, not the exit status).
// A generous maxBuffer avoids truncating output for large scripts.
const MAX_BUFFER = 64 * 1024 * 1024;

export function runValidityCheckSync(command: string): string {
  const res = cp.spawnSync(command, {
    shell: true,
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
  });
  return `${res.stdout ?? ""}${res.stderr ?? ""}`;
}

export function runValidityCheckAsync(command: string): Promise<string> {
  return new Promise((resolve) => {
    cp.exec(command, { maxBuffer: MAX_BUFFER }, (_err, stdout, stderr) => {
      resolve(`${stdout ?? ""}${stderr ?? ""}`);
    });
  });
}

export function runCommandDetached(command: string): void {
  cp.exec(command);
}
