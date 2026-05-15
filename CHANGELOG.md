# Changelog

All notable changes to the **esi Helper for TestPit** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] — Unreleased

### Changed
- **`<pre>…</pre>` blocks now participate in depth tracking** instead of being passed through verbatim. A line ending with `<pre>` increments depth (so `<br/>` lines and other content land one indent past `Step Conditions = <pre>`); a whole-line `</pre>` decrements depth (so the closer aligns with the opener line). Replaces the 0.3.0 behavior where `<pre>` block content was preserved at whatever column the source happened to use, which left `<br/>` and `</pre>` lines stranded far to the right when the surrounding tag depth changed.

### Documentation
- Added `CHANGELOG.md` (this file).
- Added `CLAUDE.md` — architecture overview, common tasks, conventions, and gotchas for future contributors and Claude Code sessions.
- Refreshed `README.md` Features list with multi-project + status-bar picker + ESI-aware formatter; added a Configuration section documenting `esihelper.activeProject`, the per-project `executablePath` / `configFolderpath` settings, and `esihelper.customProjects` (with an example); added a Commands table and a Development section with `npm` workflow.

## [0.3.0] — Released

### Added
- **Multi-project support.** Built-in `RNE` and `VORILS` profiles, each with its own command-line shape, executable path, and config folder. Both ship with sensible defaults; either can be overridden in settings.
- **`esihelper.customProjects`** array setting for user-defined project profiles. Each entry takes `id`, `label`, `executablePath`, `validityArgs`, and (optional) `openArgs`. Use `{scriptPath}` and `{filePath}` as placeholders — both get substituted at runtime and double-quoted. A custom entry whose `id` matches a built-in (`RNE` / `VORILS`) overrides the built-in.
- **Bottom-left status-bar item** showing the active TestPit project. Click to open a QuickPick of all projects (built-in + custom) and switch. Renders a custom multimeter glyph (registered via `contributes.icons` from `icons/testpit-icons.woff`).
- **Command: ESI Helper: Select TestPit Project** (`extension.selectProject`).
- **Per-project executable & config-folder settings:** `esihelper.RNE.executablePath`, `esihelper.RNE.configFolderpath`, `esihelper.VORILS.executablePath`, `esihelper.VORILS.configFolderpath`.
- **Workspace-scoped `esihelper.activeProject`** setting (saved to `.vscode/settings.json`) so each repo remembers its own project.
- **Prompt on first use:** when no active project is set, the validity-check and "open with" commands open the QuickPick before running. The status bar shows `Pick TestPit project` with a warning background until a choice is made.
- **Auto-formatter** for `.esi` files. Registers a Document Formatting provider so VS Code's **Format Document** (Shift+Alt+F) and per-language `editor.formatOnSave` work natively. The legacy `esihelper.refactorDocumentOnSave` setting now also triggers the same formatter on save.
- **ESI-aware indentation.** The formatter re-indents each line to `depth × 4` spaces, where depth tracks balanced `[NAME]` / `[/NAME]` block tags. So `[STEP 10]` contents land at 4 spaces, a nested `[STEP INPUTS]` at 8, and so on.
  - Tags with trailing `# comment` (e.g. `[429_FOO_input1] # Scenario 1`) are recognized as block tags.
  - `<pre>…</pre>` blocks are passed through verbatim — hand-aligned content (Step Conditions / Step Expected Results) isn't disturbed.
  - Mid-line tags (`foo = [bar]`, `Step Conditions = <pre>`) stay as content; only whole-line tags drive depth.
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
