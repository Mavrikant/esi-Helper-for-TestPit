# CLAUDE.md

Guidance for Claude Code sessions working on **esi Helper for TestPit**.

## What this is

A VS Code extension for editing TestPit `.esi` files — test scripts for avionics hardware testing (DO‑178C). The extension provides syntax highlighting, snippets, a goto‑step picker (Ctrl+G), live validity checking via the local `TestPit.exe`, ESI‑aware auto‑formatting, and a multi‑project model (built‑in RNE / VORILS profiles plus user‑extensible custom projects). Active project shows in a right status‑bar item; click to switch.

TestPit only runs on Windows. Test scripts are the only language touched — the extension never auto‑activates on other file types.

## Code map

```
src/
├── extension.ts              # thin activate() — registers everything
├── constants.ts              # CONFIG_SECTION = "esihelper", OUTPUT_CHANNEL_NAME
├── projects.ts               # Project shape + buildBuiltInProject (RNE/VORILS arg templates)
│                             #   + buildValidityCommand / buildOpenCommand (templating + quoting)
├── diagnostics.ts            # onDidChangeTextDocument handler (runs TestPit on .esi files only)
├── statusBar.ts              # bottom‑right project picker item
├── formatter.ts              # registerEsiFormatter + registerFormatOnSave
├── commands/                 # one file per command, each exports register*(): Disposable
├── providers/                # IntelliSense providers wired in extension.ts
│   ├── completion.ts            # CompletionItemProvider — connections / fields / enums / vars
│   ├── hover.ts                 # HoverProvider — same lookups, MarkdownString output
│   └── semanticTokens.ts        # DocumentSemanticTokensProvider — known/unknown coloring
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
    ├── projectRegistry.ts       # merge built‑ins + esihelper.customProjects;
    │                            #   getActiveProject (silent), getOrPromptForProject (interactive)
    ├── xmlIndex.ts              # parses TestPit XMLs → connections / messages / fields / enums
    ├── projectIndexCache.ts     # per‑configFolderpath XmlIndex cache + FileSystemWatcher + config watcher
    ├── esiContext.ts            # cursor → EsiContext (tagName | fieldName | fieldValue | variableRef | other)
    └── renderComponent.ts       # MarkdownString rendering for hover + completion docs

test/setup.js                  # mock‑require fake `vscode`; loaded via mocha --require
src/test/fixtures/config/      # tiny XML fixtures used by xmlIndex.test.ts (path-resolved relative to out/test/unit)
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

### Index a new TestPit XML file type
1. Add an `ingestXxx` function in [src/lib/xmlIndex.ts](src/lib/xmlIndex.ts) that walks the file's structure and populates `index.connections` / `index.messages`.
2. Add a `lower.includes(...)` branch in `routeFile` to dispatch the new filename pattern to the new ingester.
3. Decide which `Bus` value (`429` / `1553` / `Discrete` / `Mem`) — extend the union if needed.
4. Add a fixture XML under `src/test/fixtures/config/` and an assertion in [src/test/unit/xmlIndex.test.ts](src/test/unit/xmlIndex.test.ts) covering at least one connection + one message + one enum from the new file.
5. The completion / hover / semantic-tokens providers automatically pick up the new connections — no provider changes needed if the data fits the existing `MessageDef` / `FieldDef` shape.

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
- **The XML index re-loads automatically** on `esihelper.activeProject` change, on `<id>.configFolderpath` change, and on any XML file change in the active config folder. Don't add a stateful in-provider cache — that would mask updates. Use `getActiveProjectIndex()` from [src/lib/projectIndexCache.ts](src/lib/projectIndexCache.ts) on every request.
- **Custom projects don't get the XML index** — the per-project `configFolderpath` setting is only declared for built-ins (RNE / VORILS). Custom projects bake their full file paths into `validityArgs`, so the index lookups don't apply. Completion / hover / semantic tokens silently no-op when a custom project is active.
- **Bus prefixes:** `.esi` references look like `[429_<connName>]` / `[1553_<connName>]` / `[Discrete_<signalName>]` / `[Mem_<portName>]`. The XML index assigns the prefix based on the source file: `MessageConfig` `<Device Type>`, the file containing the message, etc. Don't hardcode prefixes elsewhere — derive from `Bus`.

## Testing approach

Pure functions (no `vscode` import) are unit‑tested directly with Node's `assert`. vscode‑touching code uses the [test/setup.js](test/setup.js) mock — currently `window.createOutputChannel`, `Range`, `Diagnostic`, `DiagnosticSeverity`. Extend setup.js when you need more.

`projectRegistry.ts`, `statusBar.ts`, and `selectProject.ts` are deliberately untested — they're thin glue around `workspace.getConfiguration().update`, `createStatusBarItem`, and `showQuickPick`, all of which need a richer mock or an actual integration harness (`@vscode/test-electron`) to exercise meaningfully.

After any change, run `npm test` and `npm run lint`. Current count: 92 passing.

## Don't

- Don't put raster images in status‑bar text — generate a font glyph instead.
- Don't drop the `.esi` languageId check in `diagnostics.ts` — orphan `.temp` files will return.
- Don't restore verbatim `<pre>` pass‑through — see "Conventions" above.
- Don't operate inside `.claude/worktrees/...` — use the real repo at `D:\esi-Helper-for-TestPit\`.
- Don't push to `origin` unless asked. The maintainer pushes after review.
- Don't bump the version in package.json without coordinating — that doubles as the release trigger and the changelog cutover.
