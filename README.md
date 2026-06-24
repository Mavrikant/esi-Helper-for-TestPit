<h1 align="center">esi Helper for TestPit</h1>

<p align="center">
  <em>Syntax highlighting, validation, IntelliSense, and refactoring for TestPit <code>.esi</code> test scripts.</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit"><img src="https://vsmarketplacebadges.dev/version-short/karamandev.esi-helper-for-testpit.svg" alt="Marketplace Version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit"><img src="https://vsmarketplacebadges.dev/installs-short/karamandev.esi-helper-for-testpit.svg" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit"><img src="https://vsmarketplacebadges.dev/downloads-short/karamandev.esi-helper-for-testpit.svg" alt="Downloads"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit&ssr=false#review-details"><img src="https://vsmarketplacebadges.dev/rating-short/karamandev.esi-helper-for-testpit.svg" alt="Rating"></a>
  <a href="https://github.com/Mavrikant/esi-Helper-for-TestPit/actions/workflows/ci.yaml"><img src="https://img.shields.io/github/actions/workflow/status/Mavrikant/esi-Helper-for-TestPit/ci.yaml?branch=main&label=CI" alt="CI Status"></a>
  <a href="https://github.com/Mavrikant/esi-Helper-for-TestPit/releases"><img src="https://img.shields.io/github/v/release/Mavrikant/esi-Helper-for-TestPit" alt="Latest Release"></a>
  <a href="https://github.com/Mavrikant/esi-Helper-for-TestPit/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Mavrikant/esi-Helper-for-TestPit" alt="License"></a>
  <a href="https://github.com/Mavrikant/esi-Helper-for-TestPit"><img src="https://img.shields.io/github/stars/Mavrikant/esi-Helper-for-TestPit?style=social" alt="GitHub Stars"></a>
</p>

---

**esi Helper for TestPit** turns VS Code into a first-class editor for TestPit test scripts. It validates scripts as you type, highlights unknown identifiers, autocompletes connections / fields / enums from your project's TestPit XML configs, and formats `.esi` files with bus-aware indentation — so you spend less time chasing typos and more time writing tests.

<p align="center">
  <img src="images/Animation.gif" alt="Demo">
</p>

<p align="center">
  <img src="images/Problems.png" alt="Problems panel">
</p>

## Highlights

- **Live validity check** against the configured `TestPit.exe` — errors surface in the Problems panel while you type.
- **Component IntelliSense** for `429_…`, `1553_…`, `DIS_…`, `Mem_…`, `VORILS<N>_…`, `PART_<partition>_<port>`, and `ED_…` (External Data) tags. Connections, fields, enum values, and `%VARIABLE%` references are completed and hover-documented from the active profile's TestPit XML configs. Re-indexes automatically when the XMLs change.
- **CSV-cell validation:** `field = file.csv line:N col:M` reads the referenced cell and validates its value against the field's enum table.
- **Rich syntax highlighting** — distinct, theme-overridable colours for section tags, message fields, keys, enum values, `%MACRO%` references, file/folder paths, quoted strings, numbers, constants and comments. Resolved component identifiers carry a `defaultLibrary` semantic modifier so unknown/stale ones stand out.
- **Auto-formatting** with ESI-aware indentation **and `=` alignment**: `[TAG]…[/TAG]` contents indent in 4-space steps; field assignments in a section align their `=` to one column (`esihelper.alignmentScope` = `section` or `tier`), including `<pre>` openers whose bodies stay under the aligned `<pre>`. Runs via **Format Document** (`Shift+Alt+F`) or on save (`esihelper.refactorDocumentOnSave`); tabs → 4 spaces on every save.
- **Quick-fix code actions** for unknown enum values — pick the right one from a lightbulb menu.
- **Multi-profile support driven by TestPit's own settings:** profiles and their config files are read from the Windows registry (`HKCU\Software\ESEN\TestPit`). The status-bar item (bottom-right) shows the active profile; click to switch via QuickPick.
- **Snippets** for `[STEP]`, `[STEP DEFINITION]`, `[STEP INPUTS]`, `[STEP OUTPUTS]`, `[VARIABLES]`, `[FUNC_*]`, `[PART_*]`, `[CMD_EXECUTE]`, `[MANUAL_VERIFY]`, `[EXTERNAL_VERIFY]`, `[STEP GET_DUMP]`.
- **Step renumbering** (sequential 10, 20, 30, …) and **Goto step** (`Ctrl+G`).
- **Open with TestPit** — launches the active script in the configured `TestPit.exe`.

## Getting started

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit).
2. Open any `.esi` file. On first use you're prompted to **pick your `TestPit.exe`** (the console build, used for validation) — or run **ESI Helper: Pick TestPit Executable** any time.
3. The status bar (bottom-right) shows the active **TestPit profile**, read from TestPit's own registry settings. Click it to switch profiles, or run **ESI Helper: Reload TestPit Settings** after you change config paths in the TestPit GUI.

## How configuration works

The extension reads the profiles and their config-file paths straight from **TestPit's Windows registry settings** at `HKEY_CURRENT_USER\Software\ESEN\TestPit` — the same settings the TestPit GUI manages. There is nothing to wire up per project:

- `Settings\SettingPrefix` lists the profiles; element `[0]` is the active one.
- Each `<Profile>\Executer\*ConfigFile` value supplies a config path by **role** (`ConfigFile`→cable, `A429ConfigFile`, `1553ConfigFile`, `DiscreteConfigFile`, `PartitionConfigFile`, `VORILSConfigFile`, `EDConfigFile`); element `[0]` is the live file.

On first use this is exported once and cached in the extension's global storage; switching profiles reads the cache, and **Reload TestPit Settings** re-exports it. The `TestPit.exe` path is **not** in the registry, so it's picked once via a dialog and remembered.

### Settings

All `esihelper.*` settings are **user-scoped (machine-wide)** — they live in your VS Code _User_ settings, never in `.vscode/settings.json`.

| Setting | Purpose |
|---|---|
| `esihelper.refactorDocumentOnSave` | When `true`, runs the full ESI formatter (re-indent + `=` alignment) on save. (Tabs → 4 spaces happens on every save regardless.) |
| `esihelper.alignmentScope` | `section` (default) aligns `=` within each block; `tier` aligns all blocks at the same bracket-depth together. |

## Commands

| Command | Default keybinding |
|---|---|
| ESI Helper: Run Validity Check | — |
| ESI Helper: Open with TestPit | — |
| ESI Helper: Update Step Numbers | — |
| ESI Helper: Refactor Document | — |
| ESI Helper: Show Processed File | — |
| ESI Helper: Select TestPit Profile | — |
| ESI Helper: Reload TestPit Settings | — |
| ESI Helper: Pick TestPit Executable | — |
| ESI Helper: Show Component Validation Info | — |
| Goto step number | `Ctrl+G` (when editing `.esi`) |
| Format Document (built-in) | `Shift+Alt+F` (when editing `.esi`) |

## Development

```bash
npm install
npm run compile     # tsc → out/
npm run lint        # ESLint (flat config)
npm test            # mocha unit tests
npm run coverage    # c8 coverage report
```

Press `F5` in VS Code to launch the Extension Development Host. CI runs lint + compile + test on Ubuntu / macOS / Windows × Node 22 for every push to `main` and every PR.

See [CLAUDE.md](CLAUDE.md) for an architecture overview and contribution conventions, and [CHANGELOG.md](CHANGELOG.md) for release history.

## Author

**M. Serdar Karaman** — [GitHub](https://github.com/Mavrikant) · [LinkedIn](https://www.linkedin.com/in/mserdarkaraman/) · [karaman.dev](https://karaman.dev/)

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

Copyright © 2020 M. Serdar Karaman
