# Changelog

All notable changes to the **esi Helper for TestPit** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Editor features: an outline, tag-based folding, a step picker, more quick fixes, smarter completion, inlay hints, keyword hover, theme-aware colours, Format Selection, and a validity check that no longer runs on every keystroke.

### Added
- **Outline, breadcrumbs and Go to Symbol in Editor (`Ctrl+Shift+O`).** The section tree is built from the tags: TEST STEPS → STEP → STEP INPUTS / OUTPUTS → message blocks. Steps, input/output sections, `[VARIABLES]`, definitions, `[INCLUDE]`s and bus message blocks each get their own icon. A step shows its `Step Description` next to its name, `[TEST DEFINITION]` shows the `Test Description`, and `[INCLUDE]` shows the included file. One-liner sections such as `[STEP DUMP/]` appear as leaves, and the tree keeps working on half-written scripts with unclosed or mismatched tags.
- **Tag-based folding.** Every multi-line section folds on its tags; `<pre>…</pre>` bodies fold; runs of consecutive `#` comment lines fold as comments, so "Fold All Block Comments" works.
- **Go to Step (`Ctrl+G`) is now a step picker**, and is in the Command Palette as **ESI Helper: Go to Step**. It lists every `[STEP n]` with its Step Description, and its Step Requirements when set. Type a step number, or any word from the description or requirements, to filter; moving through the list previews each step; Enter jumps to it; Escape returns to where you were. The picker opens on the step containing the cursor, and typing an exact step number and pressing Enter works as before.
- **Quick fixes (`Ctrl+.`) for the extension's own diagnostics:**
  - Unknown component or field: "Change to '…'" with up to three closest names from the active profile's configs. Renaming a component also renames its closing tag.
  - Value out of range: set to the minimum or maximum.
  - Invalid `match` value: change to `next` or `any`. `occurrence = all` can be corrected to `ALL`.
  - Duplicate key, or an output-only field (`occurrence` / `synchronize` / `match`) in a `[STEP INPUTS]` message: remove the line.
  - Unbalanced section tags: add the missing `[/NAME]` at the right indentation, or correct a mismatched closing tag's name. One-liner `[NAME/]` sections are left alone. These work with no active TestPit profile.
  - "Fix all … problems in this file" for duplicate keys, output-only fields and out-of-range values.
- **Tag completion after `[` offers the structural sections** (`VARIABLES`, `TEST DEFINITION`, `TEST STEPS`, `STEP`, `STEP DEFINITION`, `STEP INPUTS`, `STEP OUTPUTS`, `INCLUDE`, `STEP GET_DUMP`, `TIMELIMIT`, `MANUAL_VERIFY`, `EXTERNAL_VERIFY`, `STEP DUMP`, `CMD_EXECUTE`, `CMD_INSTRUCTION`, `CMD_SWMemoryWrite`) alongside the profile's connections. The ones that belong where the cursor is are listed first, and they work with no TestPit profile loaded.
- **The closing tag is written for you.** Accepting a tag on an empty line inserts the matching `[/NAME]` below with the cursor in between, correctly indented. It is not added when the tag is already closed further down or when you are editing an existing tag line. `[STEP …]` gets an id placeholder that is mirrored into its closing tag.
- **Tag completion after `[/`** lists the sections still open, innermost first and preselected, and lines the closing tag up under its opening tag.
- **Hover on a bare connection name** (bus prefix left off) now also works for `ED_`, `PART_<partition>_` and any `VORILS<N>_` connection.
- **`%MACRO%` navigation.** Go to Definition (`F12`), Find All References (`Shift+F12`) and occurrence highlighting work on `%NAME%` variables. A definition is a `%NAME% = value` line — in `[VARIABLES]` or any other section — or one handed to an included file in an `[INCLUDE]` block. Definitions and uses in files reached through `include file = …` are found too, as long as the file can be read relative to the including script's folder.
- **Rename (`F2`) on a macro** renames its `[VARIABLES]` definition and every use in the file; comments are left alone. Names may contain letters, digits and underscores only, and a name already in use is refused. Rename is also refused when it could not be completed from this file: the macro is not defined here, it is an `[INCLUDE]` argument, an included file uses the same name, or an included file could not be read (it may use the name).
- **Hover on a macro** shows its value and where it is defined (line, and the included file if any). It works with no TestPit profile loaded.
- **Macro checks (need no profile):** a use of a macro no definition was found for is a warning; a `[VARIABLES]` macro that is never used is shown faded; a name that differs from a definition only by case is a hint. Quick fixes: "Change to '%NAME%'" (closest defined names) and "Remove unused variable". The checks run only on a complete script (one with `[TEST STEPS]` / `[TEST DEFINITION]`) whose includes could all be read — an include fragment, or a script with an unreadable include, gets none, because its macros may come from elsewhere. The macros TestPit fills in itself (`%TARGETIP%`, `%FUNCTARGETIP%`, `%PARTITIONPORTNUMBER%`, `%FUNCTIONPORTNUMBER%`, `%REPORTDIR%`, `%SYSTEMTIME%`, `%SYNCTIME%`) and `%TIMEOUT%` (used by the `[CMD_EXECUTE]` template) are never reported as undefined. TestPit's own validity check remains the authority.
- **Go to Definition into the TestPit config XML.** `F12` / `Ctrl+click` (or Peek Definition) on a component tag (`[429_…]`, `[1553_…]`, `[DIS_…]`, `[Mem_…]`, `[VORILS<N>_…]`, `[ED_…]`, `[PART_<partition>_<port>]`, also its closing tag or a bare name) jumps to its `<Connection>` in the cable file (or `<Port>` in the partition file) and to its `<Message>`; on a field name, to its `<Field>`; on an enum value, to its `<Enum>` entry. Works with both config formats and with shared definitions under `<Common>`. When the exact element cannot be found it opens the nearest enclosing definition, or the top of the file. No `TestPit.exe` is needed.
- **"Open definition" link on hover cards** for components, fields and enum values.
- **Matching tag highlight.** With the cursor on `[STEP 1]` or `[/STEP 1]`, both tags are highlighted. One-liner sections (`[STEP DUMP/]`), unclosed tags and stray closers have no partner and are not highlighted — a quick cue that a tag is unbalanced.
- **Linked tag rename.** Editing the name inside an opening tag changes its closing tag with it, and vice versa. This uses VS Code's `editor.linkedEditing`, which the extension turns on by default for `.esi` files; `"[esi]": { "editor.linkedEditing": false }` switches it off.
- **Go to Matching Tag** (**ESI Helper: Go to Matching Tag**, `Ctrl+Shift+\`) jumps from an opening tag to its closing tag and back; from a line inside a block, to the opening tag of the innermost enclosing section. In `.esi` files the key replaces the built-in Go to Bracket.
- **Clickable file references.** `Ctrl+click` opens the file named by a `file.csv line:N col:M` reference (at that cell), by an `include file` or `result file` value, or by any other path-shaped value such as the script in a `system call`. Paths resolve relative to the script's folder. A link only appears when the file exists; values containing a `%macro%` are not linked.
- **CSV cell hover.** Hovering a `file.csv line:N col:M` reference shows the cell's value, the same column on line 1, the surrounding cells of that line and the resolved path — or says whether the file, the line or the column is missing.
- **CSV values on numeric fields are checked** against the field's Min/Max, exactly like a literal. A missing CSV file or cell is now reported for numeric fields too, not only enum fields.
- **Step-number diagnostics:** a warning when a step number is used twice, and an information hint when a step number is lower than the previous step's. Both offer the quick fix **Renumber steps**, which does the same as the command.

- **Next step number.** Typing `[STEP` proposes the next number in the script's own numbering (10, 20 → 30; 1, 2 → 3; zero padding kept; a step typed between two others gets a free number in between) instead of a fixed `00`. It is a tab stop mirrored into the closing tag, so it can be overtyped. **Update Step Numbers** still renumbers the whole file.
- **"STEP (full skeleton)" completion** inserts a whole step with its definition, inputs and outputs.
- **Component block with fields.** On an empty line inside `[STEP INPUTS]` / `[STEP OUTPUTS]`, each known connection has a second entry "<name> (with fields)". It inserts the block with `time` and the message's non-reserved fields (up to 8) as tab stops, already aligned. The plain tag stays first.
- **CSV value completion.** After a field's `=`, the `.csv` files next to the script are offered (or those in the folder typed so far) and insert `file.csv line:1 col:1` with the two numbers as tab stops. After a typed `.csv` name, `line:N col:M` is offered on its own. Not offered for parameter keys, values containing a `%macro%`, or unsaved files.
- **Inlay hints inside component blocks.** After a numeric value on an enum field the enum's name is shown (`SDI = 1` shows `INSTALLATION_NUMBER_ONE`); after a numeric value on a field with a declared unit the unit is shown (`Course = 100.0` shows `deg`); optionally the declared `[min..max]` range. Settings: `esihelper.inlayHints.enumNames` (default on), `esihelper.inlayHints.units` (default on), `esihelper.inlayHints.ranges` (default off); VS Code's `editor.inlayHints.enabled` is the master switch. Hints come only from the active profile's XML configs. Nothing is shown for `%macro%` values, CSV cell references, parameter keys (`time`, `count`, …), unknown fields, reserved / unused fields, or definition blocks.
- **Keyword hover.** Hovering a TestPit parameter key inside a message block (`match`, `occurrence`, `synchronize`, `time`, …) or a structural section tag (`[STEP INPUTS]`, `[VARIABLES]`, `[STEP DUMP/]`, `[STEP <id>]`, …) shows a short card: the accepted values of `match` / `occurrence`, which parameters are output-only, where a section belongs and what is not valid inside it. Needs no profile. Parameters whose behaviour the extension has no source for show only their class (common / bus-specific / output-only).
- **Theme-aware colours.** The built-in light themes (Light 2026, Light Modern, Light+, Visual Studio Light, Quiet Light, Solarized Light, High Contrast Light) get their own palette, every colour at WCAG AA contrast (≥ 4.5:1). Dark colours are unchanged. Third-party light themes keep the default palette; copy the light block under your theme's name to use it there.
- **New distinct colours:** `[STEP n]` tags (bold) versus structural section tags such as `[STEP INPUTS]` (bold) versus component tags; the slash of `[/NAME]` and `[NAME/]` (muted); units glued to numbers (`10ms`, `400Hz`); the `<` / `>` of an `occurrence` count; `<pre>` / `<br/>` markup; the `line:N col:M` part of a CSV cell reference.
- **Reserved / unused fields are struck through**, and components, fields and enum values the loaded config does not know are shown in italics, in addition to the existing warning.
- **Format Selection** (`Ctrl+K Ctrl+F`, or right-click → Format Selection). Selected lines are formatted exactly as Format Document would format them — indentation depth, `=` alignment and `<pre>` anchoring are computed from the whole file — and lines outside the selection are not touched. The selection is expanded to whole lines. Formatting part of an alignment group or of a `<pre>` block leaves the unselected lines of that group as they were until they are formatted too.
- **CodeLens in `.esi` files.** At the top of a root script (one containing `[TEST STEPS]` or `[TEST DEFINITION]`): **Validate** (runs the TestPit validity check) and **Open with TestPit**. Above every `[STEP n]`: a summary such as `2 inputs · 1 output`, counting the blocks directly inside the step's `[STEP INPUTS]` / `[STEP OUTPUTS]`; click it to fold or unfold the step. When a step contains problems a second lens such as `2 errors, 1 warning` appears; click to jump to the problem, or pick from a list when there are several. Counts come from the Problems panel (all sources, errors and warnings only) and refresh shortly after diagnostics change. `esihelper.codeLens.enabled` (default `true`) turns the lenses off.
- **Validation status-bar item** next to the TestPit profile, shown for the active `.esi` editor. It reads "validating…" with a spinner while TestPit.exe checks the file, otherwise the error and warning counts reported for that file. Click opens the Problems panel. The counts are always numbers, never a "passed" mark; the tooltip says when the TestPit part is missing (no executable set) or possibly out of date (live check turned off).
- **Settings for the live TestPit check.** `esihelper.liveValidation` (default `true`): turn off to stop the automatic TestPit.exe check while typing — Run Validity Check still works and the in-process checks are unaffected. `esihelper.liveValidationDelay` (ms, default 600, clamped to 200–10000): quiet period after the last edit before TestPit.exe starts.
- **"TestPit Components" view in the Explorer side bar.** It lists everything the active profile's TestPit config files define: bus → connection (the section tag name) → fields. Each field shows its data type, range, step, unit and number of enum values; fields the config marks as not used show "reserved". Hovering an item shows the same card as the editor hover. Clicking a connection writes its `[NAME]` … `[/NAME]` block into the active `.esi` editor (the same block `[`-completion writes); clicking a field writes `field = ` with the cursor after the `=`. On an empty line the text goes on that line, indented to fit the enclosing section; on a line with text it goes on a new line below, and that line itself is never changed. A filter (title button, or **ESI Helper: Filter Components…**) narrows the tree: several words must all match, case-insensitive, against connection, message, field and enum-value names. Right-click → **Go to XML Definition** opens the config XML at the element. The view follows profile switches, Reload TestPit Settings and config-file edits, and offers Select Profile / Reload TestPit Settings when nothing is loaded.
- **ESI Helper: Validate All .esi Files in Workspace.** Checks every `.esi` file in the workspace (respecting `files.exclude`) with the extension's in-process checks: section structure, step numbering, macros, and component / field / enum / CSV-cell validation against the active profile. No editors are opened. Results go to the Problems panel; progress is shown in a cancellable notification and partial results are kept. The run ends with a summary (files checked, errors, warnings) offering **Show Problems** and **Clear**, and a per-file report in the output channel. It does NOT run TestPit.exe and is not a substitute for TestPit's own validity check; the summary says so. Files open in an editor are counted from the editor buffer and shown by the live diagnostics, so nothing appears twice. A checked file that changes on disk is re-checked, a deleted one is removed, and all results are cleared when the active profile, the registry settings or a config XML changes. Files that cannot be read are listed as "NOT CHECKED" and make the summary a warning. **ESI Helper: Clear Workspace Validation Results** removes the results at any time.
- **Test Explorer (Testing view).** Every `.esi` script in the workspace is listed with its `[STEP …]` blocks as children; steps of an open script get a gutter icon on their opening tag. The one run profile, **Validate (TestPit validity check)**, runs the same `TestPit.exe --validateScriptOnly` check as Run Validity Check, from the editor buffer if the script is open, otherwise from disk. The test is not executed: green means TestPit reported no error for that script or step in the validity check and says nothing about the result on hardware. A step is red when TestPit reports an error on a line inside it; errors outside any step, or without a line number, mark the script red (and with an error TestPit gave no line for, steps with no error of their own are shown as skipped rather than green); warnings do not turn an item red and are listed in the Test Results output. If TestPit produced no validation log the script is shown as errored, never passed. With no TestPit.exe configured the run is skipped and the output says to run Pick TestPit Executable — a test run never opens a dialog. Running a single step still validates the whole script.
- **Menus.** Editor title-bar buttons on `.esi` files: **Run Validity Check** and **Open with TestPit**. Editor right-click menu: **Go to Step**, **Update Step Numbers**, **Refactor Document**, **Run Validity Check**. Explorer right-click on a `.esi` file: **Open with TestPit**. Both commands act on the file the menu was opened on, not on whichever editor has focus.
- **A "Get started with esi Helper for TestPit" walkthrough** (Help → Welcome → Walkthroughs). It covers picking TestPit.exe, selecting the registry profile, reloading TestPit settings, and where Problems, Outline, quick fixes and the step picker are.
- **Extension-host integration suite** (development only): `npm run test:integration` opens fixture `.esi` files in a real VS Code instance and checks the providers through the public API. It is not part of `npm test` and has not yet been run in CI.

### Changed
- **The extension no longer loads at every VS Code start.** It activates when the workspace contains a `.esi` file, when a `.esi` file is opened, when one of its commands is run, or when its walkthrough or view is opened. In windows with no `.esi` files, the profile status-bar item and the "TestPit.exe is not set" warning no longer appear until one of those happens.
- **Update Step Numbers, Refactor Document, Run Validity Check and Open with TestPit are hidden from the Command Palette** unless the active editor is a `.esi` file.
- **Switching the TestPit profile or running Reload TestPit Settings re-runs the live TestPit check** for all open `.esi` files (debounced, never prompts).
- **The live validity check waits for a short pause in typing** (about 0.6 s) before running `TestPit.exe`, instead of running on every keystroke. Only one TestPit process runs per file at a time, and if you keep typing during a run, one more run follows — so the Problems panel always ends up reflecting the final text. The previous result stays visible until the new one arrives, instead of flickering away on each keystroke.
- **Run Validity Check no longer freezes the editor.** It shows a progress notification, still writes the full command and TestPit output to the "esi Helper" output channel, and now also puts the issues in the Problems panel and as squiggles. It finishes with a short message: "n errors, n warnings", "clean", or a warning that TestPit produced no validation log (for example when the executable path is wrong). Messages TestPit reports without a line number cannot be shown in the Problems panel; the summary counts them and points to the output channel.
- **TestPit findings are labelled `TestPit` in the Problems panel**; the extension's own checks remain `esi Helper`. Closing a file removes its TestPit findings.
- **Folding follows the tags, not the indentation.** Indented text that is not a section, a `<pre>` body or a comment run (a hanging continuation line, say) no longer folds on its own.
- **The enum quick fix lists the closest value first** and marks it as the preferred fix.
- **One completion entry per section, with its body.** The section list after `[` now inserts the lines the separate snippets used to carry — `[STEP DEFINITION]`, `[TEST DEFINITION]`, `[VARIABLES]`, `[MANUAL_VERIFY]`, `[EXTERNAL_VERIFY]`, `[CMD_EXECUTE]`, `[STEP GET_DUMP]` — and the duplicate snippet entries are gone. A body is inserted only for a brand-new tag on an otherwise empty line; retyping a name on an existing tag line inserts the name only. The `[FUNC_…]` and `[PART_…]` placeholder snippets remain.
- **Section bodies come out already formatted**, with aligned `=` and `<pre>` anchored to that column, so Format Document or format-on-save no longer reshuffles a freshly inserted block.
- **Smarter field names.** Fields already assigned in the block are no longer offered (a second one is a duplicate key). Reserved fields are listed last. `occurrence`, `match` and `synchronize` are not offered inside `[STEP INPUTS]`, where they are output-only; `synchronize` is newly offered elsewhere.
- **Format Document and format-on-save apply small per-line edits** instead of replacing the whole file, so cursor position, selections and folded regions survive formatting. The formatted result is unchanged, and line endings (CRLF/LF) are left as they are.
- **Colours, hints and component warnings refresh when a config XML changes on disk**, not only on a profile switch or Reload TestPit Settings.
- Clearer messages when a step is not found or the file has no steps.
- **Update Step Numbers is structure-aware.** Each closing tag gets the number of its own opening tag, so an unclosed or mis-closed step no longer shifts every later `[/STEP n]`. One-liner steps (`[STEP 10/]`) and the tag shapes TestPit repairs are renumbered too; steps with a non-numeric id (`[STEP GET_DUMP]`, `[STEP %N%]`) and `[STEP DEFINITION]` / `INPUTS` / `OUTPUTS` / `DUMP` are never touched. Only the digits change, so indentation, comments and CRLF line endings are kept and the cursor and folding no longer reset. The command reports what it did ("Renumbered 3 of 12 steps." / "Steps are already sequential…" / "No numbered steps found…"). Several tags on one line are no longer renumbered, and step numbers written in prose or in `Step Dependencies` are not updated.
- **CSV files are read with a real CSV reader** (quoted fields with embedded commas, quotes and line breaks; CRLF; UTF-8 BOM). Simple files read as before. A CSV file name may now include a folder (`..\data\x.csv line:1 col:1`).
- **The "CSV cell not found" message states the reason:** file not found, the file has N lines, or the line has K columns. CSV references or cells containing a `%macro%` are never reported.
- **Completion after `%`** shows each macro's value, includes macros from included files, and inserts correctly whether or not a closing `%` is already there. It no longer pops up right after a finished `%MACRO%` or inside a comment.

### Fixed
- **Semantic highlighting is no longer switched on for every language.** The extension enabled it globally; it is now on for `.esi` only.
- **`<br/>` is no longer partly coloured as a folder path.**
- **Show Processed File no longer assumes `C:\Users\<login>\Documents\…`.** It resolves the file under the real user home directory, so profile folders that differ from the login name, or sit on another drive, now work. When the file cannot be opened, the error names the exact path that was tried and says a validity check must run first.
- **The enum quick fix on a CSV-sourced value** (`field = file.csv line:N col:M`) used to overwrite the whole CSV reference with a literal; no replace fix is offered there now. Values containing a `%macro%` never get a fix.
- **Step lookup no longer treats typed text as a regular expression**, so input such as `(` or `.*` cannot error or match the wrong step.
- **Completion no longer leaves `]]`** behind the auto-inserted closing bracket.
- **The live check follows the file that changed**, not whichever editor has focus, so writes to the output channel no longer trigger a run.
- Snippet descriptions "Step definiton" / "Test definiton" corrected to "definition".

## [0.4.6]

Dependency refresh — no change in what the extension does.

### Changed
- **Requires VS Code 1.144 or newer** (was 1.140). The extension is now built against the 1.144 API definitions, and VS Code requires `engines.vscode` to cover them; an older VS Code keeps 0.4.5 until it is updated.
- **The XML reader's helper packages updated:** `fast-xml-parser` stays on 5.11.2 (still the latest), while the packages it ships with move to `fast-xml-builder` 1.3.1, `strnum` 2.5.1 and `xml-naming` 0.3.0.
- **Build toolchain brought up to date:** ESLint 10.14, typescript-eslint 8.72, `@types/node` 26.6.6. Still compiled with TypeScript 7.0, run side by side with TypeScript 6.0 for typescript-eslint, which does not support 7.x yet.
- **CI tests on Node.js 26** (the current LTS) on Windows, macOS and Linux, plus Node.js 22, the oldest supported, on Linux; releases are built on Node.js 26. GitHub Actions updated to `actions/checkout` v7 and `actions/setup-node` v7.

### Security
- Development-only advisories cleared (`npm audit` reports none): serialize-javascript (GHSA-m5mm-p8h7-m29v), glob (GHSA-3g3m-2fjr-6pw4), minimatch (GHSA-g3hv-75wg-m249). glob and minimatch are pinned to their patched releases through `overrides`, because mocha, c8, ESLint and typescript-eslint still ask for the older lines. None of these packages ship in the `.vsix`.

## [0.4.5]

Dependency refresh — no change in what the extension does.

### Changed
- **Requires VS Code 1.140 or newer** (was 1.120). The extension is now built against the 1.140 API definitions, and VS Code requires `engines.vscode` to cover them; an older VS Code keeps 0.4.4 until it is updated.
- **`fast-xml-parser` 5.8.0 → 5.11.2**, the one runtime dependency (it reads the TestPit XML configs).
- **Build toolchain brought up to date:** compiled with TypeScript 7.0, run side by side with TypeScript 6.0 for typescript-eslint, which does not support 7.0 yet. Also updated: ESLint 10.11, typescript-eslint 8.71, mocha 12, c8 12, `@vscode/test-electron` 3, `@types/node` 26. The JavaScript TypeScript 7 emits differs from 6.0's only in helper-variable naming and line breaks.

### Security
- Development-only advisories cleared (`npm audit` reports none): js-yaml (GHSA-2883-xcg3-v3hh), brace-expansion (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p), serialize-javascript (GHSA-gfhx-hw2g-v5hg). None of these packages ship in the `.vsix`.

## [0.4.4]

Catch-up with TestPit v1.3.6.19 (Source r2370): the second form of the bus message configuration files.

### Added
- **Configuration format 2 is read, and format 1 still is.** TestPit v1.3.6.19 accepts a second shape for the message configuration files — one **attribute** per value instead of one child element, `Version="2"` on the root, no `<Fields>` / `<Enums>` wrappers, and the states that repeat across a file defined once in `<Common><CommonEnums>` and taken by `Ref="…"`. Both shapes are now indexed by the same reader, so completion, hover, enum checking and range checking work the same whichever form a project's configs are in — and a project that never converts its files notices nothing. The mechanism is the engine's own: one accessor takes the attribute where there is one and the child element otherwise (`XMLConfigParser::getNodeValue`), which is why format 2 kept the element names it replaced.
- **The names format 2 respelled are read on both spellings**, the newer one first: a field's `Name` (was `FieldName` on A429), `DataType` (was `Type` on VOR/ILS, external data and the software-test ports), `BitSize` (was `Size` on A429, 1553 and discrete), `DefaultValue` (was `Default` on 1553), and a message's `Encoding` (was `Type` on A429). `<EnumDef>` and `<Enums>` are both accepted as a set of states, wrapped or unwrapped, and the external-data root is read as `<EDRoot>` or `<Root>`.
- **`Used="false"` is understood.** A reserved / spare / padding field is still offered and never called unknown — TestPit keeps its name — but hover says the value written there is ignored, and completion marks it *reserved*. Where the file does not state it, the name rule the engine has always guessed with (`Reserved…`, `Spare…`, `Pad…`, `FutureSpare`) is the fallback, so format 1 files gain the same hint.
- **Defaults a format 2 file leaves out are supplied**, as the engine supplies them: a discrete signal with no `BitSize` is one bit (version-gated — a format 1 file that omits it means nothing of the kind), an A429 field stating neither bound is a constant rather than a range, and a `DefaultValue` that only repeats the default is simply absent.

### Fixed
- **A discrete signal whose name contains `#` was indexed under a name no script can write.** TestPit strips every `#` out of a discrete name (`TAStatus#1` → `TAStatus1`), which is how the cable file spells it and the only form a script can use; the extension kept the sharp, so the signal's fields resolved to nothing and were silently never checked. It now strips them too — in both formats.
- **A superseded `<name>.v1.xml` beside a converted file is ignored** when a whole folder is indexed. `convert_config --replace` leaves the format 1 original there, and reading both let the older file's contents into the index.

### Verified
- Both formats are checked to build the *same* index: the fixture folder `src/test/fixtures/config_v2` is `src/test/fixtures/config` put through TestPit's own converter, and the suite asserts every connection, message and field agrees, naming the handful of things conversion is allowed to drop. The same comparison was run over the delivered configurations — NEOCAS, RNE, Sim, VOR/ILS and external data, ~4,800 fields — with no difference.

## [0.4.3]

Catch-up with the TestPit comparison-engine work (Source r2341–r2345): the new `match` parameter, and a section-tag reader that matches the engine's own.

### Fixed
- **One-liner sections `[NAME/]` were reported as unclosed.** TestPit's reader accepts `[NAME/]` as a section that opens *and* closes on a single line — it is the only reason a section name may legitimately appear with no matching closing tag. The validator read the trailing `/` as part of the tag name, pushed `NAME/` on its tag stack and never popped it, so a script containing e.g. `[STEP GET_DUMP/]` got a spurious *Section [STEP GET_DUMP/] is never closed* / *is not closed before […]* error. One-liners are now depth-neutral: they never go on the stack, but the nesting rules still apply to them (a `[708_…/]` under `[STEP INPUTS]` is still flagged). The formatter no longer indents anything after a one-liner, and the highlighter now colours the closing `/` as punctuation instead of swallowing it into the tag name.
- **The sloppy-but-legal tag forms no longer cascade into false "unbalanced tag" errors.** TestPit repairs a handful of malformed tags with a warning and carries on; the validator did not, so the *next* closing tag looked unmatched and every later close in the file was flagged too. The tag grammar is now a faithful port of the reader's own (`ScriptParser.cpp` `readSection` + `checkTagName`), covering repeated braces/slashes (`[[NAME]]`, `[//NAME]`), text left after the tag end (`[NAME] junk`), and a missing closing brace (`[NAME`). A tag whose name TestPit would reject outright is skipped silently rather than guessed at — its real error comes from the validity check. Pinned against the regression case `TRT/Scripts/Validation/val_test_tag_recovery_pass.esi`, which TestPit validates clean and the extension now reports clean too (it previously raised four errors on it).

### Added
- **The `match` parameter** (TestPit ≥ v1.3.6.15, Source r2341). `match` says which record of the comparison window may answer an expected block: `next` — the default, the next record no other block has taken — or `any`, meaning any record of the window carrying these values, wherever it sits. It is accepted in message blocks on every bus, offered in completion (with both values suggested and explained), coloured as a parameter keyword, flagged as output-only inside a `[STEP INPUTS]` message, and **its value is validated**: anything other than `any`/`next` is an error, matching TestPit's `checkMatchValue`, which refuses an unknown value rather than silently falling back to the default. A `%macro%` value is exempt — it resolves at run time. The comparison is case-sensitive, as it is in the engine.
- **`occurrence` values are validated too.** `occurrence` and `match` are the only two parameters whose value TestPit constrains, and the same reasoning applies: an out-of-grammar value used to run against an expected count of −1, a *silent* determinate FAIL. Only `ALL` or an optional `<`/`>` followed by a non-negative number is accepted (so `all`, `>=3`, `>` and `-1` are flagged), mirroring `checkOccurrenceValue`; `%macro%` values are exempt.

## [0.4.2]

### Fixed
- **Cross-bus message-name collision caused false "Unknown field" errors.** When two config files defined a message with the same name on different buses — e.g. an A429 message `RadioAltitude` and a `NeoCASPorts.xml` memory port also named `RadioAltitude` — the later-ingested one overwrote the earlier in the shared message map, so a valid field (`SDI = …`) on the A429 message was reported as `Unknown field 'SDI' for message 'RadioAltitude'`. Message resolution (and hover) is now **bus-aware**: each connection resolves to the message from its own bus, so same-named messages on different buses no longer clash.

## [0.4.1]

Conformance and diagnostics polish following review against the TestPit source.

### Fixed
- **No more false "Unknown field" warnings on valid parameter fields.** The component validator's allowlist was widened to match TestPit's `ScriptMessageValidator.cpp` — message blocks may carry the scheduling/output parameters `count`, `parity`, `synchronize`, `validity`, `angle`, `duration`, and `image` (alongside the existing `time`/`interval`/`occurrence`/`period`). The discrete `value` field is intentionally still validated against its enum table.
- **Quoted-string highlighting** now covers typographic quotes (`“…”`) in addition to straight `"…"`.

### Added
- **New structural checks that run even with no active profile** (they need no config): unbalanced/mismatched section tags (error), A708 message under `[STEP INPUTS]` (error), `MANUAL_VERIFY`/`EXTERNAL_VERIFY` under `[STEP INPUTS]` (warning), output-only fields (`occurrence`/`synchronize`) used in a `[STEP INPUTS]` message (warning), and duplicate keys within a message block (error). These mirror TestPit's own validator and are scoped to complete scripts (a `[TEST STEPS]`/`[TEST DEFINITION]` root), so include-fragments are never false-flagged.
- **Numeric range check.** A bare numeric field value outside the message field's `MinValue`/`MaxValue` is flagged. Skipped for `%macro%` values, CSV references, and ranges, whose real value is only known after TestPit preprocessing — so no false positives.
- **Numeric enum values are validated too.** An enum field may be set by its numeric value (e.g. `SDI = 1`), matching TestPit's `getEnumValue`; an out-of-table number (e.g. `SDI = 7`) is now flagged. Skipped for macros/CSV/file references and when the enum table carries no numeric values.
- **Run Validity Check prints the full TestPit command.** The output channel now logs the active profile, the script path, a note about the temp-copy validation, and the exact command (with all flags) before the TestPit output — making CLI-vs-extension discrepancies easy to diagnose.
- **`[TEST STEPS]` snippet** plus tidied descriptions/indentation for the existing step snippets.

## [0.4.0]

A major rework of how the extension finds its TestPit configuration, plus broader project support, smarter formatting, and a full syntax-colour overhaul.

### Added
- **Registry-driven, multi-profile configuration.** Profiles and their config-file paths now come from TestPit's own Windows registry settings (`HKEY_CURRENT_USER\Software\ESEN\TestPit`) instead of hardcoded project definitions. On first use the extension runs a single `reg export`, parses it, and caches a slim JSON in the extension's global storage. `Settings\SettingPrefix[0]` is the default profile; each `<Profile>\Executer\*ConfigFile[0]` gives a config path by role.
- **Status-bar profile picker** populated from `SettingPrefix`; click to switch profiles. New commands **ESI Helper: Reload TestPit Settings** (re-export after changing paths in the TestPit GUI) and **ESI Helper: Pick TestPit Executable**.
- **NEOCAS-style config support:** config files are routed to ingesters **by registry role, not filename**, so non-standard names (`A429Messages_HURJET.xml`, `NeoCASPorts.xml`, …) work. The `Ref` indirection is resolved in all three forms — `<Connection Ref>`→`<References>` channel, partition `<Port Ref>`→`<Common><CommonPorts>`, field `Ref`→`<Common><CommonEnums>` — plus `Sampling`/`Queuing` port types.
- **External Data (DTIF) messages:** new `EDMessageFields.xml` ingester and the `ED_` tag prefix (`[ED_Type1]`).
- **`=` alignment in the formatter.** Field assignments are aligned to one column per section (and `<pre>` block openers align with their sibling keys; their bodies follow the aligned `<pre>`). New `esihelper.alignmentScope` setting: `section` (default) or `tier` (align all blocks at the same bracket-depth together).
- **Tabs → 4 spaces on every save** (full re-format on save still gated by `esihelper.refactorDocumentOnSave`).
- **Syntax-highlighting overhaul.** A purpose-built grammar + semantic tokens colour: section tags / connections, message fields, enum values, keys (any `key =`), `%MACRO%` references, file/folder path values, double-quoted strings, numbers, constants, and comments — each via its own scope so themes/users can recolour. `[TEST DEFINITION]`/`[STEP DEFINITION]` prose only highlights macros + keys + strings.

### Changed
- **Validity check / live diagnostics** build the TestPit command from the active profile's resolved config paths (`--cf/--ac/--mc/--dc/--pc/--edc/--vc` for the roles that exist) and `--validateScriptOnly=true`.
- **TestPit.exe is a one-time pick** (file dialog, stored in the plugin's JSON), prompted on activation if unset — it is not in the registry. **Open with TestPit** derives `TestPitw.exe` from the same folder.
- All `esihelper.*` settings remain machine-scoped; the only remaining ones are `esihelper.refactorDocumentOnSave` and `esihelper.alignmentScope`.

### Fixed
- **TestPit output capture.** The runner now captures both stdout and stderr and ignores the process exit code, so validation warnings (which TestPit may print to stderr and/or accompany a non-zero exit) reach the Problems panel instead of being silently dropped.

### Removed
- Built-in RNE/VORILS project machinery and the settings `esihelper.RNE.*`, `esihelper.VORILS.*`, `esihelper.<id>.configFolderpath`, and `esihelper.customProjects`. Also the legacy globalState "active project" store and its one-time settings migration. Profiles + config paths now come from the registry.

## [0.3.4]

### Changed
- **Active project selection moved from workspace settings to machine-wide `globalState`.** The `esihelper.activeProject` configuration property is removed; the picked project is now remembered per workspace folder under the user's VS Code install. Selections no longer pollute `.vscode/settings.json` and survive across sessions without committing anything. Multi-root workspaces use the first folder as the key; single-file mode uses an internal sentinel so picks persist there too.
- **One-time migration on first activation.** Any existing `esihelper.activeProject` value found in workspace, workspace-folder, or user settings is auto-migrated into `globalState` and cleared from `settings.json`. Migration is idempotent and per-workspace.
- **Subscribers react via a new `onActiveProjectChanged` event** (status bar, XML index cache, component diagnostics). `onDidChangeConfiguration` is no longer fired by selection changes since the value lives outside config.
- **All `esihelper.*` settings are now `scope: machine`** — `esihelper.refactorDocumentOnSave`, `esihelper.RNE.executablePath`, `esihelper.RNE.configFolderpath`, `esihelper.VORILS.executablePath`, `esihelper.VORILS.configFolderpath`, and `esihelper.customProjects` can only be set in User settings, never in `.vscode/settings.json`. The extension never writes anything to your workspace folder.

### Fixed
- **`formatEsi` malformed-input alignment.** Replaced the integer depth counter with a `Context[]` stack plus a two-phase `<pre>` pre-scan. Previously, a single defect — `</pre>` with a trailing `# comment`, bracket-tag-looking content inside `<pre>`, an orphan `<pre>` opener, content before `</pre>` on the same line — cascaded into every subsequent closing tag being indented one level too deep, making large files effectively un-formattable. Now bracket-tag patterns inside `<pre>` no longer disturb depth; mismatched closes render as content preserving the user's typo visibly; orphan opens render at current depth without pushing to the stack.
- **`<pre>` opener / closer regexes** extended to recognize `<pre>` and `</pre>` mid-line and to allow a trailing `# comment`. The `<pre>` block's content column is now anchored to the opener's column (`preCol`) with a trailing-content branch: `Step Expected Results = <pre> Following results...` keeps subsequent `<br/>` lines aligned with `<pre>` rather than indented one step further.
- **Formatter test coverage** for the new Context-stack behavior — 166+ new lines across all malformed-input scenarios.

## [0.3.3]

### Added
- **SECURITY.md** documenting the vulnerability reporting policy and supported versions.

### Changed
- **README modernization** — badge layout refresh (Marketplace version / installs / downloads / rating, CI status, latest release, license, GitHub stars), tighter Highlights section, refined Author block.
- **CI workflow refinements** — `ci.yaml` and `codeql-analysis.yaml` alignment, including action version pins.
- **Removed unused icon-build pipeline** — `scripts/build-icons.js`, `icons/testpit-icons.woff`, `icons/testpit.svg`, and the related `package.json` build steps. The extension's icon comes directly from `images/TestPitIcon.ico`.

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
