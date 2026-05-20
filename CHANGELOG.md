# Changelog

All notable changes to the **esi Helper for TestPit** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.4]

### Changed
- **Active project selection moved from workspace settings to machine-wide `globalState`.** The `esihelper.activeProject` configuration property is removed; the picked project is now remembered per workspace folder under the user's VS Code install. Selections no longer pollute `.vscode/settings.json` and survive across sessions without committing anything. Multi-root workspaces use the first folder as the key; single-file mode uses an internal sentinel so picks persist there too.
- **One-time migration on first activation.** Any existing `esihelper.activeProject` value found in workspace, workspace-folder, or user settings is auto-migrated into `globalState` and cleared from `settings.json`. Migration is idempotent and per-workspace.
- **Subscribers react via a new `onActiveProjectChanged` event** (status bar, XML index cache, component diagnostics). `onDidChangeConfiguration` is no longer fired by selection changes since the value lives outside config.
- **All `esihelper.*` settings are now `scope: machine`** — `esihelper.refactorDocumentOnSave`, `esihelper.RNE.executablePath`, `esihelper.RNE.configFolderpath`, `esihelper.VORILS.executablePath`, `esihelper.VORILS.configFolderpath`, and `esihelper.customProjects` can only be set in User settings, never in `.vscode/settings.json`. The extension never writes anything to your workspace folder.

## [0.3.2]

### Added
- **CSV-cell validation.** Field assignments of the form `field = <file>.csv line:N col:M` now resolve the referenced cell at validation time and check its value against the field's enum table. Reports `unknownCsvCell` when the file is unreadable or the cell is out of range, `unknownEnum` when the cell value isn't in the field's enum list. CSV reads are cached per validation pass.
- **VORILS bus prefixes** (`VORILS<N>_<MsgName>`) — connection / field / enum IntelliSense + validation for VORILS unit messages. Falls back through `VORILS_UNIT_PREFIX` so any unit number resolves to the same shared message definition.
- **Memory-port partitions** (`PART_<partition>_<port>`) — `MemoryPorts.xml` is now walked across every `<Partition>` so partitioned ports show up in completions and validation.
- **1553 `Word.Field` dot notation.** 1553 message fields are now qualified as `WordName.FieldName` instead of being flattened, so per-word field collisions resolve correctly.
- **Quick-fix code actions** for `unknownEnum` warnings — a lightbulb offers one CodeAction per valid enum value, applied via WorkspaceEdit.
- **Command: ESI Helper: Show Component Validation Info** (`extension.showValidationInfo`) — diagnostic dump: extension version, active project, configFolderpath, XmlIndex size, sample connections, per-issue line / col / kind / message, and a cross-check against `vscode.languages.getDiagnostics`.
- **`DIS_` bus prefix** for Discrete signals (replaces the earlier `Discrete_` form).
- README badges: Marketplace version / installs / downloads / rating (via `vsmarketplacebadges.dev`), CI status, latest release, license.

### Changed
- **README modernized:** tagline header, Getting started section, Highlights section reorganized to cover the newer features (CSV-cell validation, quick-fix actions, validation-info command, expanded bus prefixes), cleaner Author block.
- **GitHub Actions upgraded:** `actions/checkout` v5 → v6, `actions/setup-node` v5 → v6, `actions/upload-artifact` v5 → v7 (Node-20 deprecation), `softprops/action-gh-release` v2 → v3.
- **Code coverage in CI:** `npm run coverage` runs in every CI job; the c8 file-by-file table is posted to the GitHub Actions job summary and the HTML report is uploaded as the `coverage-html` artifact (Linux only).
- **`CreatePackage.bat`** installs the built `.vsix` into both VS Code stable and Insiders when present (`:install_one` label avoids the cmd-parser bug with `(stable)` inside `for`-loop bodies).
- **Completion polish:** trigger characters extended to include `.` (for `Word.Field`); every CompletionItem now carries an explicit `range` + `filterText` so digit-leading (`1553_…`) and dotted (`Mode.SelectedCourse`) tokens match reliably regardless of VS Code's default word-pattern heuristic.

### Fixed
- **CRLF line endings — silent validation failure.** Several modules split on `"\n"` and left a trailing `\r` on every line, which broke `^…$`-anchored regexes (assignment, tag, opening tag) on Windows files. Every line-split now uses `/\r?\n/`: componentValidator, esiContext, findStepLine, formatEsi, parseValidityOutput, refactorWhitespace, semanticTokens, diagnostics. On real Windows-authored `.esi` files this was the difference between 0 and dozens of warnings.
- **CSV-reference false positives.** Before CSV-cell validation, the validator's `RHS_IDENT_RE` matched up to the first `.` in `myfile.csv …`, producing bogus `unknownEnum: <basename>` warnings. CSV references are now detected before the generic enum check.
- **Bare-named 1553 / Memory connections** (no `L<label>` prefix) now resolve to their messages — `parseConnectionName` falls back to the raw name as `messageName`.
- **Digit-leading completions.** `[1553_…` and `[429_…` completions had empty filter lists due to VS Code's word-at-cursor heuristic. Fixed via `language-configuration.json` `"wordPattern": "[A-Za-z0-9_.]+"` plus explicit per-item `range` / `filterText`.
- **`showValidationInfo` parity.** Diagnostic report now uses the same `csvLookup` callback as live diagnostics, so the printed warning list matches the squiggles in the editor.

### Tests
- Test count grew to **145+ passing** with fixtures covering all five XML file types (`MessageConfig`, `A429MessageFields`, `1553MessageFields`, `DiscreteSignals`, `MemoryPorts`, `VORILSMessageFields`).
- Additional setup.js mocks: `CodeAction`, `CodeActionKind`, `WorkspaceEdit`, `languages.registerCodeActionsProvider`, `commands`, `Disposable`, `ConfigurationTarget`.

## [0.3.1]

### Added
- **TestPit XML index** — parses `<configFolderpath>/*.xml` (MessageConfig, A429MessageFields, 1553MessageFields, DiscreteSignals, MemoryPorts, plus VORILS variants) into an in-memory model of connections / messages / fields / enums. Re-loads on `esihelper.activeProject` change, on `<id>.configFolderpath` change, and on any XML file change via a `FileSystemWatcher`. Cached per `configFolderpath` so switching projects back-and-forth is instant.
- **Auto-completion** for `.esi` files (triggers on `[`, `=`, `%`, plus Ctrl+Space):
  - Inside `[…]`, suggests bus-prefixed connection names (`429_L100SelectedCourseBNR_input1`, `1553_…`, `DIS_…`, `Mem_…`) from the index.
  - At the start of a line inside an open component block, suggests the message's field names (plus the timing fields `time`).
  - On the RHS of `field = `, suggests enum values for `DataType=Enum` fields, or the `defaultValue` / `minValue` / `maxValue` for numeric fields.
  - After `%`, suggests variable names declared in the file's `[VARIABLES]` blocks.
- **Hover** information for connections (bus, label, card / channel / speed, message name, fields), fields (DataType, range, default, bit position, unit, enum table, parent message), and enum values (numeric value, parent field, parent message).
- **Semantic highlighting** for connection names (`class`), field names (`property`), enum values (`enumMember`), and variable references (`variable`). Identifiers resolved against the index get the `defaultLibrary` modifier so themes can render unknown / stale references differently.
- **Component validation diagnostics** — warnings (squigglies + Problems-panel entries) for: unknown component names (`[429_L999_NotReal]`), unknown field names inside a known message (`UnknownField = 5`), and unknown enum values for known Enum-typed fields (`SDI = NORMAL_NOPE`). Re-runs on every text change and on `esihelper.activeProject` / `customProjects` / `RNE.*` / `VORILS.*` setting changes. Skips timing field `time` and silently no-ops when no project is active. Source: `esi Helper`.
- Runtime dependency: `fast-xml-parser` for XML parsing.

### Changed
- **`<pre>…</pre>` blocks now participate in depth tracking** instead of being passed through verbatim. A line ending with `<pre>` increments depth (so `<br/>` lines and other content land one indent past `Step Conditions = <pre>`); a whole-line `</pre>` decrements depth (so the closer aligns with the opener line). Replaces the 0.3.0 behavior where `<pre>` block content was preserved at whatever column the source happened to use, which left `<br/>` and `</pre>` lines stranded far to the right when the surrounding tag depth changed.
- **Auto-formatter** for `.esi` files. Registers a Document Formatting provider so VS Code's **Format Document** (Shift+Alt+F) and per-language `editor.formatOnSave` work natively. The legacy `esihelper.refactorDocumentOnSave` setting now also triggers the same formatter on save.
- **ESI-aware indentation.** The formatter re-indents each line to `depth × 4` spaces, where depth tracks balanced `[NAME]` / `[/NAME]` block tags. So `[STEP 10]` contents land at 4 spaces, a nested `[STEP INPUTS]` at 8, and so on.
  - Tags with trailing `# comment` (e.g. `[429_FOO_input1] # Scenario 1`) are recognized as block tags.
  - `<pre>…</pre>` blocks are passed through verbatim — hand-aligned content (Step Conditions / Step Expected Results) isn't disturbed.
  - Mid-line tags (`foo = [bar]`, `Step Conditions = <pre>`) stay as content; only whole-line tags drive depth.

### Fixed
- **`.vscodeignore` no longer excludes `node_modules/**`.** The blanket exclusion stopped `vsce` from packaging the new `fast-xml-parser` runtime dependency, so installed `.vsix` builds threw `Cannot find module 'fast-xml-parser'` at activation and the extension silently failed to load. `vsce`'s production-dep walker now includes the runtime modules; devDependencies are still left out.

### Tests
- **Code coverage** via `c8`. New `npm run coverage` script writes a text summary plus HTML report (`coverage/index.html`) and lcov (`coverage/lcov.info`). Configured via `.c8rc.json` with vscode-touching glue (extension, statusBar, providers, command files, registry/cache layers) excluded — they need integration tests, not unit. Pure-logic modules under `src/lib/` and `src/projects.ts` count for **94.76%** statements / **100%** functions.
- **+15 new tests** (105 → 120):
  - `xmlIndex.test.ts`: 1553 message ingest (Word > Field flattening, attribute-style fields with enums) + MemoryPorts ingest (Mem_-prefixed connections, attribute-style fields with `Type`/`BitSize`).
  - `renderComponent.test.ts`: connection / field / enum MarkdownString rendering — bus labels, label / card / channel / speed lines, enum tables, parent message references. Required adding `MarkdownString` to `test/setup.js`.
  - `componentValidator.test.ts`: mid-edit cases — field name on a line with no `=` yet, Enum field assigned a numeric literal (no enum check fires).
  - `esiContext.test.ts`: out-of-range `lineIndex`, cursor on a non-component-tag line.
- New XML fixtures: `1553MessageFields.xml`, `MemoryPorts.xml`.

### Documentation
- Added `CHANGELOG.md` (this file).
- Added `CLAUDE.md` — architecture overview, common tasks, conventions, and gotchas for future contributors and Claude Code sessions.
- Refreshed `README.md` Features list with multi-project + status-bar picker + ESI-aware formatter; added a Configuration section documenting `esihelper.activeProject`, the per-project `executablePath` / `configFolderpath` settings, and `esihelper.customProjects` (with an example); added a Commands table and a Development section with `npm` workflow.

## [0.3.0]

### Added
- **Multi-project support.** Built-in `RNE` and `VORILS` profiles, each with its own command-line shape, executable path, and config folder. Both ship with sensible defaults; either can be overridden in settings.
- **`esihelper.customProjects`** array setting for user-defined project profiles. Each entry takes `id`, `label`, `executablePath`, `validityArgs`, and (optional) `openArgs`. Use `{scriptPath}` and `{filePath}` as placeholders — both get substituted at runtime and double-quoted. A custom entry whose `id` matches a built-in (`RNE` / `VORILS`) overrides the built-in.
- **Bottom-right status-bar item** showing the active TestPit project. Click to open a QuickPick of all projects (built-in + custom) and switch. Renders a custom multimeter glyph (registered via `contributes.icons` from `icons/testpit-icons.woff`).
- **Command: ESI Helper: Select TestPit Project** (`extension.selectProject`).
- **Per-project executable & config-folder settings:** `esihelper.RNE.executablePath`, `esihelper.RNE.configFolderpath`, `esihelper.VORILS.executablePath`, `esihelper.VORILS.configFolderpath`.
- **Workspace-scoped `esihelper.activeProject`** setting (saved to `.vscode/settings.json`) so each repo remembers its own project.
- **Prompt on first use:** when no active project is set, the validity-check and "open with" commands open the QuickPick before running. The status bar shows `Pick TestPit project` with a warning background until a choice is made.
- **`scripts/build-icons.js`** — SVG → SVG-font → TTF → WOFF pipeline behind `npm run build-icons` for regenerating the status-bar icon font.

### Changed
- **Live diagnostics scoped to `.esi` files only** — no more `.temp` files leaking into the working tree when editing TypeScript/JSON/etc. with a project active.
- **Status-bar item polish:** higher priority so it stays leftmost, descriptive name in the Customize Status Bar menu, warning background when no project is set, error background when the active id no longer resolves to a known project.
- **Refactor: extracted `withTempScript` and `toDiagnostic`** helpers; `runValidityCheck` and `diagnostics.ts` no longer duplicate the temp-file write/cleanup plumbing or the Diagnostic-conversion logic.
- **`testpitRunner` slimmed** to three exec wrappers (`runValidityCheckSync` / `runValidityCheckAsync` / `runCommandDetached`) that all take a fully-built command string. Command building moved to the per-project `buildValidityCommand` / `buildOpenCommand` in `src/projects.ts`.

### Removed
- **`esihelper.testpitConfigFolderpath`** setting — replaced by per-project `esihelper.RNE.configFolderpath` / `esihelper.VORILS.configFolderpath`. Existing users will be prompted to pick a project on first command after upgrading; if their old folderpath value differed from the new default, copy it under the matching `*.configFolderpath` key.
- Hardcoded TestPit executable path constant — now per-project, configurable in settings.

### Fixed
- Tags with a trailing `# comment` (e.g. `[429_FOO_input1] # Scenario 1`) now correctly increment depth in the formatter, so contents inside indent one level deeper instead of staying at the same indent as the tag.

## [0.2.9]

### Added
- **41 mocha unit tests** covering the pure library functions (`parseValidityOutput`, `renumberSteps`, `refactorWhitespace`, `findStepLine`, `outputChannel`, `testpitRunner`, `withTempScript`, `toDiagnostic`).
- **Modern GitHub Actions CI** (`.github/workflows/ci.yaml`): triggers on push to `main`, PRs, and version tags; matrix runs on ubuntu-latest / macos-latest / windows-latest with Node 22; `npm ci` → `npm run lint` → `npm run compile` → `npm test`. Release job uses `@vscode/vsce` and uploads the `.vsix` to GitHub Releases on tag push.
- `package-lock.json` committed for reproducible builds.

### Changed
- **Refactored monolithic `extension.ts`** into focused modules: `src/lib/` for pure logic, `src/commands/` for command handlers (one file each), `src/diagnostics.ts` for the live-validation listener. `extension.ts` shrank from 321 lines to a ~25-line `activate()` that just wires registrations.
- **Modernized toolchain:** ESLint 10 with flat config (`eslint.config.cjs`), TypeScript 6, `@types/node` to v22, dropped the deprecated `vscode` shim package.
- Test infrastructure uses `mock-require` to stub `vscode` so vscode-touching modules (e.g. `outputChannel`, `toDiagnostic`) are unit-testable.
- Dependabot bumps for `js-yaml`, `picomatch`, `flatted`.

### Removed
- **SerdAI command** (`extension.serdAI`) — Gemini-powered DO-178C checklist analysis.
- **Generate Step Documentation command** (`extension.generateStepDocumentation`) — Gemini-powered conditions/results generator.
- **`@google/generative-ai`** dependency.
- **`esihelper.geminiApiKey` and `esihelper.geminiModelName`** settings (the former previously contained a hardcoded default key — now removed from the manifest; existing repo history still contains it, so the maintainer should revoke at Google Cloud).
- **SERDAI panel / webview** and the `myOutputView` view container.

### Fixed
- Mojibake in the "Step not found" message — `ðŸ˜"` is now `😔`.

## [0.2.8]

### Added
- **Generate Step Documentation** command — used Gemini to auto-generate `Step Conditions` and `Step Expected Results` blocks from the inputs/outputs of the test step under the cursor. *(Removed in 0.2.9.)*

## [0.2.7]

### Changed
- Activation events updated.

### Fixed
- Activation issue.

### Removed
- Telemetry.
