/**
 * Launcher for the extension-host integration suite (plain Node, no `vscode`).
 *
 *   npm run compile && node ./out/test/integration/runTest.js
 *   (Linux without a display: prefix with `xvfb-run -a`)
 *
 * Downloads VS Code through @vscode/test-electron (cached in `.vscode-test/`),
 * starts it with this repository as the extension under development and the
 * fixture folder as the workspace, and runs `suite/index.js` inside the real
 * extension host.
 *
 * The suite is independent of TestPit.exe and of the Windows registry: with
 * neither, the extension has no active profile and no XML index, which is the
 * state the assertions are written for. The profile is a throw-away
 * user-data dir, so nothing cached by a real installation (an exe path, a
 * registry snapshot) leaks in.
 *
 * Environment:
 *   VSCODE_TEST_VERSION  VS Code version to run ("stable" when unset).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  // out/test/integration/runTest.js → repository root.
  const repoRoot = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index");
  // Fixtures are not compiled; they are read from the source tree.
  const workspace = path.join(
    repoRoot,
    "src",
    "test",
    "integration",
    "fixtures",
    "workspace"
  );
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "esi-helper-it-"));

  const launchArgs = [
    workspace,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--user-data-dir",
    path.join(scratch, "user-data"),
    "--extensions-dir",
    path.join(scratch, "extensions"),
  ];
  // Chromium refuses to start sandboxed as root (containers, some CI images).
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    launchArgs.push("--no-sandbox");
  }

  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION || "stable",
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath,
      launchArgs,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Integration tests failed:", err);
  process.exit(1);
});
