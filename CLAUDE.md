# CLAUDE.md

Guidance for Claude Code sessions working on **esi Helper for TestPit**.

## What this is

A VS Code extension for editing TestPit `.esi` files — test scripts for avionics hardware testing (DO‑178C). The extension provides syntax highlighting, snippets, a goto‑step picker (Ctrl+G), live validity checking via the local `TestPit.exe`, ESI‑aware auto‑formatting, and a multi‑project model (built‑in RNE / VORILS profiles plus user‑extensible custom projects). Active project shows in a bottom‑left status‑bar item; click to switch.

TestPit only runs on Windows. Test scripts are the only language touched — the extension never auto‑activates on other file types.

## Code map

```
src/
├── extension.ts              # thin activate() — registers everything
├── constants.ts              # CONFIG_SECTION = "esihelper", OUTPUT_CHANNEL_NAME
├── projects.ts               # Project shape + buildBuiltInProject (RNE/VORILS arg templates)
│                             #   + buildValidityCommand / buildOpenCommand (templating + quoting)
├── diagnostics.ts            # onDidChangeTextDocument handler (runs TestPit on .esi files only)
├── statusBar.ts              # bottom‑left project picker item
├── formatter.ts              # registerEsiFormatter + registerFormatOnSave
├── commands/                 # one file per command, each exports register*(): Disposable
└── lib/                      # vscode‑free where possible — all unit‑tested
    ├── parseValidityOutput.ts   # TestPit stdout → ValidityIssue[]
    ├── renumberSteps.ts         # [STEP N] → [STEP 10] [STEP 20] …
    ├── refactorWhitespace.ts    # trailing trim + tabs → 4 spaces
    ├── formatEsi.ts             # depth‑based indenter (wraps refactorWhitespace)
    ├── findStepLine.ts          # locate [STEP N] line
    ├── outputChannel.ts         # singleton "esi Helper" channel (lazy require for mock‑require)
    ├── toDiagnostic.ts          # ValidityIssue → vscode.Diagnostic
    ├── testpitRunner.ts         # cp.exec / execSync wrappers, take a built command
    ├── withTempScript.ts        # write content → fn(tempPath) → cleanup
    └── projectRegistry.ts       # merge built‑ins + esihelper.customProjects;
                                 #   getActiveProject (silent), getOrPromptForProject (interactive)

test/setup.js                  # mock‑require fake `vscode`; loaded via mocha --require
icons/testpit.svg              # source for the status‑bar multimeter glyph
icons/testpit-icons.woff       # generated font; ships in the .vsix
scripts/build-icons.js         # SVG → SVG‑font → TTF → WOFF; behind `npm run build-icons`
```

## Build, lint, test, run

| Command | What it does |
|---|---|
| `npm run compile` | `tsc -p ./` → `out/` |
| `npm run lint` | ESLint (flat config in [eslint.config.cjs](eslint.config.cjs)) |
| `npm test` | runs `compile` then `mocha` (uses `out/test/unit/**/*.test.js` per [.mocharc.json](.mocharc.json)) |
| `npm run watch` | TS in watch mode |
| `npm run build-icons` | regenerate `icons/testpit-icons.woff` after editing `icons/testpit.svg` |
| F5 in VS Code | launch Extension Development Host |
| `npx @vscode/vsce package` | build the `.vsix` |

CI matrix on push to `main` / PRs: ubuntu / macos / windows × Node 22 → `npm ci` → lint → compile → test. Release job (on tag push) packages and uploads the `.vsix` as a GitHub release.

## Common tasks

### Add a built‑in project
1. Add the id to `BuiltInId` + `BUILT_IN_IDS` in [src/projects.ts](src/projects.ts).
2. Add a `case` in `buildBuiltInProject` with the project's `validityArgs` template (use `{scriptPath}` placeholder).
3. Add `esihelper.<id>.executablePath` + `esihelper.<id>.configFolderpath` to `contributes.configuration.properties` in [package.json](package.json).
4. Update [src/test/unit/projects.test.ts](src/test/unit/projects.test.ts) to assert the new arg shape (mirror the RNE/VORILS cases).

### Add a custom project (user‑side, no code change)
Edit `esihelper.customProjects` in `.vscode/settings.json`:
```json
[{
  "id": "MYPROJ",
  "label": "My Project",
  "executablePath": "C:\\Tools\\custom.exe",
  "validityArgs": ["--cfg=foo", "--sf={scriptPath}", "--validate=true"],
  "openArgs": ["--ow={filePath}"]
}]
```
A custom entry whose `id` matches a built‑in (`RNE` / `VORILS`) overrides the built‑in.

### Add a new command
1. Create `src/commands/myCommand.ts` exporting `registerMyCommand(): vscode.Disposable`.
2. Push `registerMyCommand()` into `context.subscriptions` in [src/extension.ts](src/extension.ts).
3. Declare the command in `contributes.commands` and add `onCommand:extension.myCommand` to `activationEvents` in [package.json](package.json).

## Conventions & gotchas

- **`<pre>…</pre>` blocks are depth‑affecting** in the formatter (since 0.3.1). A line ending with `<pre>` increments depth; a whole‑line `</pre>` decrements. **Don't restore verbatim pass‑through** — it shipped in 0.3.0 and produced misaligned output when surrounding tag depth shifted.
- **Tag‑line regexes allow a trailing `# comment`** — see `OPENING_TAG_LINE` / `CLOSING_TAG_LINE` in [src/lib/formatEsi.ts](src/lib/formatEsi.ts). Real ESI files commonly have `[429_FOO_input1]   # Scenario 1`.
- **Live diagnostics are scoped to `.esi` only** (`languageId === "esi"` check in [src/diagnostics.ts](src/diagnostics.ts)). Removing the guard causes orphan `.temp` files when editing TS / JSON / etc.
- **Status‑bar text only renders Codicons or registered icon‑font glyphs** — raster images (`.ico`, `.png`) can't appear there. The TestPit multimeter lives in [icons/testpit-icons.woff](icons/testpit-icons.woff), registered via `contributes.icons` in package.json. Reference as `$(testpit)` in `StatusBarItem.text`.
- **Project `id` for built‑ins is the `executablePath` string**, not the `BuiltInId` literal — see `buildBuiltInProject` in [src/projects.ts](src/projects.ts). The dedup map key in `loadProjects()` is still the `BuiltInId`, so custom entries with `id: "RNE"` still override the built‑in.
- **`vscode` imports are intercepted by `mock-require` during tests.** Lazy `require("vscode")` in modules like `outputChannel.ts` and `toDiagnostic.ts` defers module load until after [test/setup.js](test/setup.js) registers the mock — top‑level `import * as vscode from "vscode"` also works once the mock is up.
- **`refactorDocument` command intentionally uses `refactorWhitespace`, not `formatEsi`** — it's language‑agnostic, runs on whatever's open. The full ESI indenter is reachable only through the formatter provider (Shift+Alt+F / format‑on‑save).
- **`package.json` `overrides` block** is for security pins. The historical `minimatch: 3.0.5` pin broke modern mocha — don't add it back without verifying the test runner.
- **Worktree at `.claude/worktrees/confident-swanson-81eac4/` is an unregistered orphan** the Claude Code harness keeps locking as CWD. Operate on `D:\esi-Helper-for-TestPit\` via absolute paths and `git -C` / PowerShell `Set-Location`. Don't `npm install` inside the orphan dir.

## Testing approach

Pure functions (no `vscode` import) are unit‑tested directly with Node's `assert`. vscode‑touching code uses the [test/setup.js](test/setup.js) mock — currently `window.createOutputChannel`, `Range`, `Diagnostic`, `DiagnosticSeverity`. Extend setup.js when you need more.

`projectRegistry.ts`, `statusBar.ts`, and `selectProject.ts` are deliberately untested — they're thin glue around `workspace.getConfiguration().update`, `createStatusBarItem`, and `showQuickPick`, all of which need a richer mock or an actual integration harness (`@vscode/test-electron`) to exercise meaningfully.

After any change, run `npm test` and `npm run lint`. Current count: 71 passing.

## Don't

- Don't put raster images in status‑bar text — generate a font glyph instead.
- Don't drop the `.esi` languageId check in `diagnostics.ts` — orphan `.temp` files will return.
- Don't restore verbatim `<pre>` pass‑through — see "Conventions" above.
- Don't operate inside `.claude/worktrees/...` — use the real repo at `D:\esi-Helper-for-TestPit\`.
- Don't push to `origin` unless asked. The maintainer pushes after review.
- Don't bump the version in package.json without coordinating — that doubles as the release trigger and the changelog cutover.
