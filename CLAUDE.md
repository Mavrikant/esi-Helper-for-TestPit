# CLAUDE.md

Guidance for Claude Code sessions working on **esi Helper for TestPit**.

## What this is

A VS Code extension for editing TestPit `.esi` files — test scripts for avionics hardware testing (DO‑178C). It provides syntax highlighting, snippets, a goto‑step picker (Ctrl+G), an outline + tag-based folding, live (debounced) validity checking via the local `TestPit.exe`, ESI‑aware auto‑formatting (indentation + `=` alignment), and component IntelliSense / validation / quick fixes driven by the project's TestPit XML configs.

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
├── diagnostics.ts            # live validity check: onDidChangeTextDocument → validityScheduler (600 ms debounce) → TestPit.exe (heavy). ONE "esi-testpit" collection; exports runValidityCheckForDocument (shared with the command). Skips silently if no exe.
├── componentDiagnostics.ts   # "esi-components" DiagnosticCollection; in-process XML-index validation + CSV-cell lookup
├── statusBar.ts              # bottom-right profile item (shows active profile; click → picker)
├── formatter.ts              # registerEsiFormatter (Shift+Alt+F) + registerFormatOnSave (tabs→spaces always; full format when refactorDocumentOnSave)
├── commands/                 # one file per command, each exports register*(): Disposable
│   ├── selectProfile.ts         # QuickPick of registry profiles (+ "Change TestPit executable…")
│   ├── reloadRegistry.ts        # re-export the registry
│   ├── pickExecutable.ts        # file dialog → store TestPit.exe
│   ├── runValidityCheck.ts / openWithTestPit.ts / showValidationInfo.ts / showProcessedFile.ts
│   ├── gotoStep.ts              # QuickPick of listSteps(); preview on highlight, restore on Escape, exact number wins on accept
│   ├── gotoMatchingTag.ts       # [NAME] <-> [/NAME]; from inside a block → its opener (lib/tagPairs.ts)
│   └── updateStepNumbers.ts / refactorDocument.ts
├── providers/                # IntelliSense, wired in extension.ts
│   ├── completion.ts / hover.ts / semanticTokens.ts
│   ├── codeActions.ts           # the ONE code-action provider: "esi Helper" diagnostics → lib/quickFixes | macros | stepChecks (routed by diagnostic code) → CodeActions
│   ├── macroNavigation.ts       # %MACRO% definition / references / rename / highlight (logic in lib/macros.ts)
│   ├── macroResolver.ts         # fs/editor side of lib/macros.ts: reads `include file` targets (open editor first, then disk by mtime)
│   ├── xmlDefinition.ts         # F12 on component / field / enum → config XML (lib/xmlLocate.ts)
│   ├── tagPairs.ts              # matching-tag highlight + linked editing of the two names
│   ├── documentLinks.ts         # Ctrl+click on file refs that exist (lib/fileRefs.ts)
│   ├── csvHover.ts              # hover on `file.csv line:N col:M`
│   └── documentSymbols.ts / folding.ts   # thin: lib/esiOutline → DocumentSymbol / FoldingRange
└── lib/                      # vscode-free where possible — unit-tested
    ├── testpitRegistry.ts       # reg export → RegistryModel { defaultProfile, profiles[], configs: {<profile>: {cable,a429,m1553,discrete,partition,vorils,ed}} }
    ├── pluginStore.ts           # globalStorage JSON: testpitExe, activeProfile, cached registry; owns onActiveProfileChanged
    ├── profileRegistry.ts       # orchestration: ensureRegistryLoaded/reloadRegistry, getProfiles/getActiveProfileName/setActiveProfile, getActiveConfigs, getTestpitExe/ensureTestpitExe/pickTestpitExe, promptForExeIfUnset
    ├── projectIndexCache.ts     # XmlIndex for the active profile via parseConfigFiles; FileSystemWatcher on each resolved config file; getActiveProjectIndex()/registerIndexLifecycle()
    ├── xmlIndex.ts              # parseConfigFiles(configs) [route-by-role] + parseConfigFolder(dir) [filename, tests]; Ref resolution; ingesters; COMPONENT_TAG_PREFIXES
    ├── esiContext.ts           # cursor → EsiContext (tagName | closeTagName | fieldName | fieldValue | variableRef | other)
    ├── parseSectionTag.ts      # ONE source of section-tag grammar: [NAME] / [/NAME] / one-liner [NAME/] + the sloppy forms TestPit repairs
    ├── sectionNames.ts         # ONE source of structural section names (SEC_*) + isStepSectionName (STEP <id> vs STEP INPUTS/OUTPUTS/DEFINITION/DUMP)
    ├── esiOutline.ts           # pure: buildOutline(text) tree + foldingRanges(text) (sections, <pre> bodies, # runs); recovers from unclosed/mismatched tags
    ├── listSteps.ts            # [STEP n] blocks + Step Description/Requirements for the goto-step picker; findStepByQuery / findStepAtLine
    ├── tagCompletion.ts        # pure tag-completion decisions: names offered after `[` / `[/`, replace range, snippet text (auto closing tag)
    ├── bareConnectionLookup.ts # bare name → connection for hover, matchers derived from COMPONENT_TAG_PREFIXES
    ├── componentValidator.ts   # pure: text + index → ComponentIssue[] (each may carry `fix: IssueFixData`); optional CsvLookup; exports ASSIGNMENT_RE
    ├── quickFixes.ts           # pure: issue → plain edits (createFixContext / findIssues / computeQuickFixes / computeFixAll / applyEdits)
    ├── macros.ts               # pure, fs injected: %MACRO% scan / include-following model / validateMacros / rename / completion / hover text
    ├── csv.ts                  # RFC-4180 reader + the ONE CSV cell lookup (createCsvCellLookup) + hover markdown
    ├── fileRefs.ts             # file-reference detection (CSV cell, include/result file, path tokens) + resolveScriptRelative
    ├── tagPairs.ts             # opener/closer pairing (same stack walk as componentValidator)
    ├── xmlLocate.ts            # position-keeping XML scan: DefinitionTarget → file/line/col, found lazily; definitionLinkMarkdown for hover
    ├── stepChecks.ts           # duplicate / out-of-order step numbers + the "Renumber steps" fix
    ├── suggest.ts              # edit-distance ranking for "Change to 'X'" (editDistance / rankSuggestions / suggest)
    ├── validityScheduler.ts    # pure, injectable timers: per-document trailing debounce + exactly one re-run + runExclusive (never two TestPit runs per file)
    ├── validityResults.ts      # pure: version gate (older result never overwrites newer) + summarizeValidity
    ├── preprocessedPath.ts     # <home>\Documents\Testpit\Preprocessed.esi path + open-failure message
    ├── renderComponent.ts      # MarkdownString rendering for hover + completion
    ├── parseValidityOutput.ts  # TestPit stdout/stderr → ValidityIssue[]
    ├── testpitRunner.ts        # spawnSync / exec wrappers — capture stdout+stderr, ignore exit code
    ├── formatEsi.ts            # depth indenter + `=` alignment (section/tier scope) + column-anchored <pre>
    ├── refactorWhitespace.ts   # trailing trim + tabs → 4 spaces
    ├── toDiagnostic.ts         # ValidityIssue → Diagnostic, source "TestPit" (TESTPIT_DIAGNOSTIC_SOURCE)
    ├── renumberSteps.ts        # parseSectionTag + section stack; digit-only edits (planStepRenumber / applyStepNumberEdits)
    ├── findStepLine.ts (literal match, goto-step fallback) / withTempScript.ts / outputChannel.ts

test/setup.js                  # mock-require fake `vscode`; loaded via mocha --require. Records registered providers/commands in `vscode.__registered` (see glue.test.ts, glueNavigation.test.ts)
src/test/fixtures/config/      # XML fixtures for xmlIndex tests (RNE-style at root; neocas/ for Ref/ED/ports)
```

## Build, lint, test, run

| Command | What it does |
|---|---|
| `npm run compile` | `tsc -p ./` → `out/` |
| `npm test` | `compile` then `mocha` (`out/test/unit/**/*.test.js`) — 654 passing |
| `npm run coverage` | `c8 npm test` (config in [.c8rc.json](.c8rc.json); vscode-touching glue excluded) |
| `npm run lint` | ESLint (flat config) — needs Node ≥ 20.19 / 22 |
| F5 | Extension Development Host (uses [.vscode/launch.json](.vscode/launch.json); run `npm run watch` alongside) |
| `npx @vscode/vsce package` | build the `.vsix` |

TypeScript runs side by side: `tsc` is TS 7 (`@typescript/native` → `npm:typescript@^7`), while `typescript` is aliased to `npm:@typescript/typescript6` because typescript-eslint needs the TS 6 API (TS 7.0 ships none). Keep both aliases until typescript-eslint supports TS ≥ 7.1.

`overrides` in `package.json` force `glob` ≥ 14.0.3 and `minimatch` ≥ 11.0.4 (GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249): mocha, c8, ESLint and typescript-eslint still ask for the unpatched glob 13 / minimatch 10 lines. Dev-only — neither ships in the `.vsix`. Drop each override once every dependent asks for the patched major itself (`npm ls glob minimatch` shows no `overridden`).

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
- **`[NAME/]` is a ONE-LINER section — it opens AND closes on one line.** It is the only reason a section name may appear with no matching `[/NAME]`, so it must never go on a tag stack (that produced a false "never closed" error, and every later close in the file cascaded). It is depth-neutral for indentation too, but it is still a real block: nesting rules apply to it. TestPit is also deliberately forgiving about tag SHAPE — `[[NAME]]`, `[//NAME]`, `[NAME] junk` and `[NAME` are all repaired with a warning, and a name still holding a `[`/`]`/`/` after normalization is rejected outright. All of this lives in ONE place, [parseSectionTag.ts](src/lib/parseSectionTag.ts), a port of `ScriptParser.cpp` `readSection` + `checkTagName`; don't re-derive a `\[(\/?)([^\]]+)\]` regex anywhere else. `TRT/Scripts/Validation/val_test_tag_recovery_pass.esi` is the authoritative list of forms, and TestPit validates it clean — so must we.
- **`match` (parameter field, TestPit ≥ v1.3.6.15) takes only `any` or `next`.** It picks which record of the comparison window may answer an expected block: `next` is the default (the next record no other block has taken); `any` means any record in the window carrying these values. It is output-only on every bus, and TestPit's `checkMatchValue` **refuses** an unknown value rather than defaulting, so the extension reports one as an error. Case-sensitive; a `%macro%` value is exempt. Values are hardcoded (`MATCH_VALUES`) — it is an engine keyword, not an XML-indexed enum.
- **`occurrence` and `match` are the ONLY parameters whose value the engine constrains** (`checkOccurrenceValue` / `checkMatchValue`); both are checked in `checkParameterValue`. Everything else in `PARAMETER_FIELDS` is accepted with any value. Keep that list in sync with `ScriptMessageValidator.cpp`'s per-bus `commonFields`/`outputFields` — only the single-token ones, since the multi-word params (`end time`, `time offset`, `clear time`, `frame count`, `return code`) never match `ASSIGNMENT_RE`. `value` is deliberately excluded: the XML index synthesizes a real enum-typed `value` field for `DIS_` messages.
- **CRLF.** Every `.split("\n")` on document text must be `.split(/\r?\n/)` — Windows `.esi` files leave trailing `\r` that breaks `$`-anchored regexes.
- **CSV cell refs** (`field = file.csv line:N col:M`) are detected in `componentValidator` before the generic enum check, for enum fields and (range-checked like a literal) numeric fields. The fs-touching lookup is `createCsvCellLookup` in [csv.ts](src/lib/csv.ts) — the only one; [componentDiagnostics.ts](src/componentDiagnostics.ts) makes one per pass. The ref grammar is `parseCsvCellRef` in [fileRefs.ts](src/lib/fileRefs.ts); don't write another CSV-ref regex.
- **One resolve rule for referenced files:** `resolveScriptRelative` ([fileRefs.ts](src/lib/fileRefs.ts)) — relative to the folder of the script that names the file. CSV refs, document links and macro include-following all use it. TestPit's own rule is unknown, which is why links are existence-gated and an unreadable include silences the macro checks instead of raising anything.
- **Macro checks only speak when they can know.** `validateMacros` reports only for a root script (`[TEST STEPS]` / `[TEST DEFINITION]`) whose includes were ALL read; otherwise nothing. `%TIMEOUT%` is in `ASSUMED_EXTERNAL_MACROS`. Don't relax either — an include fragment gets its macros from its includer.
- **Exactly one code-action provider** ([codeActions.ts](src/providers/codeActions.ts)), routing on the diagnostic `code` (`isStepIssueKind` / `isMacroIssueKind` / component kinds). Don't register a second one — fixes would be offered twice. `toDiagnostic` in `componentDiagnostics.ts` must keep each issue's exact range and `code`; that is how the issue is re-found.
- **Providers that share a position must not both answer.** VS Code shows only ONE DocumentHighlight provider's result (first non-empty), so `providers/tagPairs.ts` stands down on a `%MACRO%`; hovers ARE merged, so `providers/hover.ts` stands down on a CSV cell ref (`csvHover.ts` owns it); the XML definition provider returns nothing for a macro.
- **The index stores only `sourceFile`** (on `ConnectionDef` / `MessageDef`); line/column are found lazily by [xmlLocate.ts](src/lib/xmlLocate.ts). Don't add positions to the index.
- **Tag pairing** ([tagPairs.ts](src/lib/tagPairs.ts)) duplicates the stack walk of `componentValidator` (a closer pairs with the nearest same-named opener, case-sensitive; one-liners never stacked). Change the two together. Linked editing needs `"[esi]": {"editor.linkedEditing": true}` in `configurationDefaults` and is offered only with the cursor inside the name.
- **Step renumbering edits digits only** (never a whole-document replace — that reset the cursor and folding) and never touches step numbers in prose / `Step Dependencies`.
- **Two diagnostic collections** — `diagnostics.ts` (single `esi-testpit`, source `TestPit`, runs TestPit.exe, heavy) and `componentDiagnostics.ts` (single `esi-components`, source `esi Helper`, in-process, cheap). Keep them separate, and keep the sources distinct: the code-action provider and Show Component Validation Info select diagnostics by source.
- **The live validity check is debounced and never overlaps itself.** Every TestPit run for a document — live or the Run Validity Check command — goes through the one `validityScheduler` in `diagnostics.ts` (`runExclusive` for the command), because both write the same `<file>.temp`. Don't call `testpitRunner` for a validity check from anywhere else, don't go back to running per keystroke, and don't go back to `runValidityCheckSync` in the command (it freezes the UI). Results are published through the version gate in `validityResults.ts` so a slow run for old text can't overwrite a newer result; the previous diagnostics deliberately stay up until the next run finishes (no clear-on-keystroke flicker).
- **Structural section names live in [sectionNames.ts](src/lib/sectionNames.ts)** — `SEC_*` and `isStepSectionName`. The validator, outline, tag completion and step list all import from it; don't re-declare `"STEP INPUTS"` & co. locally (a reserved name missing from one copy shows up as a bogus step, e.g. `[STEP DUMP/]` in the picker).
- **Registering a FoldingRangeProvider replaces VS Code's indentation folding for `.esi`.** Folds come only from `foldingRanges()` (sections, `<pre>` bodies, `#` runs) — anything else that should fold must be added there.
- **Outline / folding / step list / tag completion are tolerant by design** — they run on half-typed scripts, so they recover (stray closers ignored, unclosed sections run to EOF) instead of bailing. Tags come from `parseSectionTagLine`; one-liners are leaves and never stacked, same as in `validateStructure`.
- **Quick fixes are computed by pure code and re-validated.** Diagnostics can't carry fix data across the VS Code API, so `codeActions.ts` re-runs the validators per request and matches issues by kind + range; each unbalanced-tag candidate edit is applied and re-validated, and dropped unless it clears the issue without creating a new structural one. No fix for `%macro%` values, and no "replace" fix on a CSV cell ref. Keep the logic in `lib/quickFixes.ts`, not the provider.
- **Tag completion owns the closing `]`** — on a tag line the replace range runs through the auto-closed `]` and the item writes its own, so don't shorten the range (you get `]]`). `/` is a completion trigger only for `[/`; a `/` elsewhere must return nothing.
- **Snippet bodies must be formatter-stable** — `snippets.test.ts` runs every body (tabstops expanded) through `formatEsi` and requires it unchanged. After editing `snippets.json` or the formatter, regenerate the bodies rather than relaxing the test.
- **`findStepLine` matches literally** — never build a `RegExp` from what the user typed.
- **Formatter `=` alignment** ([formatEsi.ts](src/lib/formatEsi.ts)): aligns `key =` per group (section instance, or bracket-depth in `tier` scope). `<pre>` openers participate (their bodies shift to follow the aligned `<pre>`); hanging multi-line continuations (indented more than their key) are kept verbatim. `[TEST/STEP DEFINITION]` prose is left alone except its keys.
- **`<pre>` blocks are column-anchored** (content at `preCol+INDENT`, `</pre>` at `preCol`) — not depth-based. Don't revert to depth-based or verbatim pass-through.
- **Syntax highlighting** is grammar ([syntaxes/esi.json](syntaxes/esi.json)) + semantic tokens. Inside `[TEST/STEP DEFINITION]` only comments/macros/strings/keys are coloured (a `begin/end` region) so prose numbers aren't.

## Testing approach

Pure functions (no `vscode` import) are unit-tested with Node's `assert`. vscode-touching code uses the [test/setup.js](test/setup.js) mock — extend it when you need more (it currently covers window/languages/commands/workspace incl. `createFileSystemWatcher`, `RelativePattern`, `showOpenDialog`, `withProgress`, `createQuickPick` (with `_fireValue`/`_fireActive`/`_fireAccept` test hooks), `DocumentSymbol`, `FoldingRange`, `EventEmitter`, etc.). The mock keeps the symbol / folding / code-action providers and every command handler in `vscode.__registered`, so `glue.test.ts` can call them the way VS Code would. The smoke test runs the full `activate()`; on Windows that does a real `reg export` (failure-guarded, so it can't break the test).

Glue (extension, statusBar, providers, commands, registry/cache/store layers) is excluded from coverage — it needs integration tests, not unit tests. After any change run `npm test`.

## Don't

- Don't drop the `.esi` `languageId` check in `diagnostics.ts` — orphan `.temp` files return.
- Don't make live diagnostics prompt for the exe (per-keystroke dialogs).
- Don't bypass the validity scheduler (per-keystroke or overlapping TestPit runs), and don't merge the `esi-testpit` and `esi-components` collections or their sources.
- Don't reintroduce filename-based config routing in production, or per-request registry reads.
- Don't revert the `<pre>` column-anchoring or the stdout+stderr capture.
- Don't bump the version in `package.json` casually — it doubles as the release trigger / changelog cutover.
- `config_folders/` and `sample_scripts/` are **reference material kept outside the repo** (e.g. `E:\testpluginsupport`) — they are not part of the extension; the test fixtures under `src/test/fixtures/config/` are the ones that matter.
