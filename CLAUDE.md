# CLAUDE.md

Guidance for Claude Code sessions working on **esi Helper for TestPit**.

## What this is

A VS Code extension for editing TestPit `.esi` files — test scripts for avionics hardware testing (DO‑178C). It provides syntax highlighting, snippets, a goto‑step picker (Ctrl+G), live validity checking via the local `TestPit.exe`, ESI‑aware auto‑formatting (indentation + `=` alignment), and component IntelliSense / validation driven by the project's TestPit XML configs.

TestPit only runs on Windows. The `esi` language is the only one touched — the extension never auto‑activates on other file types.

**Configuration is registry-driven.** Profiles and their config-file paths come from TestPit's own settings in the Windows registry (`HKEY_CURRENT_USER\Software\ESEN\TestPit`) — there are no hardcoded projects. The active profile shows in a right status‑bar item; click to switch. The `TestPit.exe` path is the one thing not in the registry, so it's picked once via a dialog and cached.

## Configuration model (read this first)

- `Settings\SettingPrefix` (REG_MULTI_SZ) lists profile names; element **[0]** is the default/active one.
- Each profile is a subkey `…\TestPit\<Profile>\Executer`; its `*ConfigFile` values (REG_MULTI_SZ, element **[0]** is the live file) give config paths by **role**:
  `ConfigFile`→cable/message-config, `A429ConfigFile`, `1553ConfigFile`, `DiscreteConfigFile`, `PartitionConfigFile` (memory/SW ports), `VORILSConfigFile`, `EDConfigFile` (External Data).
- The registry is read **once** via `reg export` ([testpitRegistry.ts](src/lib/testpitRegistry.ts)), parsed, and cached as a slim JSON in the extension's global storage ([pluginStore.ts](src/lib/pluginStore.ts), file `testpit-settings.json`). Switching profiles reads the cache; the **Reload TestPit Settings** command re-exports.
- Config files are routed to ingesters **by role, not filename** — so non-standard names (`A429Messages_HURJET.xml`, `NeoCASPorts.xml`, …) work.

## Code map

```
src/
├── extension.ts              # activate(): initPluginStore → ensureRegistryLoaded → register*() → promptForExeIfUnset
├── constants.ts              # CONFIG_SECTION = "esihelper", OUTPUT_CHANNEL_NAME
├── profiles.ts               # buildValidityArgs/buildValidityCommand (role→flag), buildOpenCommand, deriveGuiExecutable (TestPit.exe → TestPitw.exe)
├── diagnostics.ts            # live validity check: onDidChangeTextDocument → TestPit.exe (heavy). Skips silently if no exe.
├── componentDiagnostics.ts   # "esi-components" DiagnosticCollection; in-process XML-index validation + CSV-cell lookup
├── statusBar.ts              # bottom-right profile item (shows active profile; click → picker)
├── formatter.ts              # registerEsiFormatter (Shift+Alt+F) + registerFormatOnSave (tabs→spaces always; full format when refactorDocumentOnSave)
├── commands/                 # one file per command, each exports register*(): Disposable
│   ├── selectProfile.ts         # QuickPick of registry profiles (+ "Change TestPit executable…")
│   ├── reloadRegistry.ts        # re-export the registry
│   ├── pickExecutable.ts        # file dialog → store TestPit.exe
│   ├── runValidityCheck.ts / openWithTestPit.ts / showValidationInfo.ts / showProcessedFile.ts
│   └── updateStepNumbers.ts / gotoStep.ts / refactorDocument.ts
├── providers/                # IntelliSense, wired in extension.ts
│   ├── completion.ts / hover.ts / semanticTokens.ts / codeActions.ts
└── lib/                      # vscode-free where possible — unit-tested
    ├── testpitRegistry.ts       # reg export → RegistryModel { defaultProfile, profiles[], configs: {<profile>: {cable,a429,m1553,discrete,partition,vorils,ed}} }
    ├── pluginStore.ts           # globalStorage JSON: testpitExe, activeProfile, cached registry; owns onActiveProfileChanged
    ├── profileRegistry.ts       # orchestration: ensureRegistryLoaded/reloadRegistry, getProfiles/getActiveProfileName/setActiveProfile, getActiveConfigs, getTestpitExe/ensureTestpitExe/pickTestpitExe, promptForExeIfUnset
    ├── projectIndexCache.ts     # XmlIndex for the active profile via parseConfigFiles; FileSystemWatcher on each resolved config file; getActiveProjectIndex()/registerIndexLifecycle()
    ├── xmlIndex.ts              # parseConfigFiles(configs) [route-by-role] + parseConfigFolder(dir) [filename, tests]; Ref resolution; ingesters; COMPONENT_TAG_PREFIXES
    ├── esiContext.ts           # cursor → EsiContext (tagName | fieldName | fieldValue | variableRef | other)
    ├── componentValidator.ts   # pure: text + index → ComponentIssue[]; optional CsvLookup
    ├── renderComponent.ts      # MarkdownString rendering for hover + completion
    ├── parseValidityOutput.ts  # TestPit stdout/stderr → ValidityIssue[]
    ├── testpitRunner.ts        # spawnSync / exec wrappers — capture stdout+stderr, ignore exit code
    ├── formatEsi.ts            # depth indenter + `=` alignment (section/tier scope) + column-anchored <pre>
    ├── refactorWhitespace.ts   # trailing trim + tabs → 4 spaces
    ├── renumberSteps.ts / findStepLine.ts / toDiagnostic.ts / withTempScript.ts / outputChannel.ts

test/setup.js                  # mock-require fake `vscode`; loaded via mocha --require
src/test/fixtures/config/      # XML fixtures for xmlIndex tests (RNE-style at root; neocas/ for Ref/ED/ports)
```

## Build, lint, test, run

| Command | What it does |
|---|---|
| `npm run compile` | `tsc -p ./` → `out/` |
| `npm test` | `compile` then `mocha` (`out/test/unit/**/*.test.js`) — 177 passing |
| `npm run coverage` | `c8 npm test` (config in [.c8rc.json](.c8rc.json); vscode-touching glue excluded) |
| `npm run lint` | ESLint (flat config) — needs Node ≥ 20.19 / 22 |
| F5 | Extension Development Host (uses [.vscode/launch.json](.vscode/launch.json); run `npm run watch` alongside) |
| `npx @vscode/vsce package` | build the `.vsix` |

`tsc` does not prune stale outputs — after deleting/renaming a source file, wipe `out/` or you'll run/ship stale `.js` (and old tests will appear to still pass).

## Common tasks

### Index a new TestPit XML file type
1. Add an `ingestXxx(root, index)` in [xmlIndex.ts](src/lib/xmlIndex.ts) (defensive: `asArray`/`str`; resolve `Ref` via the `Common`/`References` helpers if needed).
2. Map a registry **role** to it in `parseConfigFiles` (and a filename branch in `routeFile` for folder-mode/tests).
3. Pick a `Bus` value (`429`/`1553`/`DIS`/`Mem`/`VORILS`/`ED`); extend the union + `PREFIXES_BY_BUS` + `COMPONENT_TAG_PREFIXES` if it's a new tag prefix.
4. Add a fixture under `src/test/fixtures/config/` and a test (mirror `xmlIndex_neocas.test.ts`).

### Add a new command
1. `src/commands/myCommand.ts` exporting `registerMyCommand(): vscode.Disposable`.
2. Push it into `context.subscriptions` in [extension.ts](src/extension.ts).
3. Declare it in `contributes.commands` + add `onCommand:extension.myCommand` to `activationEvents` in [package.json](package.json).

### Change syntax colours
Two places, both in `package.json` `contributes.configurationDefaults`: `editor.semanticTokenColorCustomizations.rules` (`class`/`property`/`enumMember`/`keyword` for `esi`) and `editor.tokenColorCustomizations.textMateRules` (scopes from [syntaxes/esi.json](syntaxes/esi.json): `comment.line.number-sign.esi`, `entity.name.tag.esi`, `keyword.other.field.esi`, `variable.other.macro.esi`, `string.other.path.esi`, `string.quoted.double.esi`, `constant.language.esi`, `constant.numeric.esi`, `source.esi`). Some elements appear in both layers (semantic wins) — change both to recolour consistently.

## Conventions & gotchas

- **Registry is read once, then cached.** `ensureRegistryLoaded()` only exports if the cache is empty. Profile switches read the cache; `reloadRegistry()` re-exports. Don't add per-request `reg` calls. The exe path is NOT in the registry — it's a plugin-owned setting (`pickTestpitExe`).
- **The XML index re-loads on `onActiveProfileChanged`** (fired by profile switch and registry reload) and on any change to a resolved config file (per-file `FileSystemWatcher`). Always call `getActiveProjectIndex()` from [projectIndexCache.ts](src/lib/projectIndexCache.ts) per request; don't cache the index in a provider.
- **`onActiveProfileChanged` lives in [pluginStore.ts](src/lib/pluginStore.ts)** (a JSON file raises no `onDidChangeConfiguration`). `reloadRegistry` fires it even when the profile name is unchanged so subscribers refresh.
- **Live diagnostics ([diagnostics.ts](src/diagnostics.ts)) never prompt** — if `getTestpitExe()` is unset they skip silently (the activation nudge / commands prompt instead). Component (XML-index) diagnostics need no exe.
- **`testpitRunner` captures stdout+stderr and ignores exit code** — TestPit logs to stderr and may exit non-zero on issues. Don't switch back to stdout-only / promisified `exec` (it rejects on non-zero and the output is lost).
- **Route configs by role, not filename.** Filename routing only exists in `parseConfigFolder` for the folder-based fixture tests. Production uses `parseConfigFiles(configs)`.
- **`Ref` resolution** in NEOCAS configs: `<Connection Ref>`→`<References>` channel; partition `<Port Ref>`→`<Common><CommonPorts>`; field `Ref`→`<Common><CommonEnums>`. Resolved within each file during ingest; inline (RNE/VORILS) forms still work.
- **Enum validation gates on "has an enum table", not `DataType === "Enum"`** — types vary (`Enum`, `Enum8`, `Enum16`). See `componentValidator`, `completion`, `semanticTokens`.
- **Bus prefixes** in `.esi`: `[429_…]`/`[1553_…]`/`[DIS_…]`/`[Mem_…]`/`[VORILS<N>_…]`/`[PART_<partition>_<port>]`/`[ED_<Msg>]`. Derive from `COMPONENT_TAG_PREFIXES`/`Bus`; don't hardcode elsewhere.
- **CRLF.** Every `.split("\n")` on document text must be `.split(/\r?\n/)` — Windows `.esi` files leave trailing `\r` that breaks `$`-anchored regexes.
- **CSV cell refs** (`field = file.csv line:N col:M`) are detected in `componentValidator` before the generic enum check; the fs-touching `CsvLookup` is injected by [componentDiagnostics.ts](src/componentDiagnostics.ts) (cached per pass).
- **Two diagnostic collections** — `diagnostics.ts` (one per file, runs TestPit.exe, heavy) and `componentDiagnostics.ts` (single `esi-components`, in-process, cheap). Keep them separate.
- **Formatter `=` alignment** ([formatEsi.ts](src/lib/formatEsi.ts)): aligns `key =` per group (section instance, or bracket-depth in `tier` scope). `<pre>` openers participate (their bodies shift to follow the aligned `<pre>`); hanging multi-line continuations (indented more than their key) are kept verbatim. `[TEST/STEP DEFINITION]` prose is left alone except its keys.
- **`<pre>` blocks are column-anchored** (content at `preCol+INDENT`, `</pre>` at `preCol`) — not depth-based. Don't revert to depth-based or verbatim pass-through.
- **Syntax highlighting** is grammar ([syntaxes/esi.json](syntaxes/esi.json)) + semantic tokens. Inside `[TEST/STEP DEFINITION]` only comments/macros/strings/keys are coloured (a `begin/end` region) so prose numbers aren't.

## Testing approach

Pure functions (no `vscode` import) are unit-tested with Node's `assert`. vscode-touching code uses the [test/setup.js](test/setup.js) mock — extend it when you need more (it currently covers window/languages/commands/workspace incl. `createFileSystemWatcher`, `RelativePattern`, `showOpenDialog`, `EventEmitter`, etc.). The smoke test runs the full `activate()`; on Windows that does a real `reg export` (failure-guarded, so it can't break the test).

Glue (extension, statusBar, providers, commands, registry/cache/store layers) is excluded from coverage — it needs integration tests, not unit tests. After any change run `npm test`.

## Don't

- Don't drop the `.esi` `languageId` check in `diagnostics.ts` — orphan `.temp` files return.
- Don't make live diagnostics prompt for the exe (per-keystroke dialogs).
- Don't reintroduce filename-based config routing in production, or per-request registry reads.
- Don't revert the `<pre>` column-anchoring or the stdout+stderr capture.
- Don't bump the version in `package.json` casually — it doubles as the release trigger / changelog cutover.
- `config_folders/` and `sample_scripts/` are **reference material kept outside the repo** (e.g. `E:\testpluginsupport`) — they are not part of the extension; the test fixtures under `src/test/fixtures/config/` are the ones that matter.
