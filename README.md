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
- **Component IntelliSense** for `429_…`, `1553_…`, `DIS_…`, `Mem_…`, `VORILS<N>_…`, and `PART_<partition>_<port>` tags. Connections, fields, enum values, and `%VARIABLE%` references are completed and hover-documented from the active project's XML configs. Re-indexes automatically when the XMLs change.
- **CSV-cell validation:** `field = file.csv line:N col:M` reads the referenced cell and validates its value against the field's enum table.
- **Semantic highlighting:** resolved identifiers carry a `defaultLibrary` modifier so themes can dim unknown ones — typos and stale references stand out at a glance.
- **Auto-formatting** with ESI-aware indentation: contents of `[TAG]…[/TAG]` blocks are indented in 4-space steps per nesting level; `<pre>…</pre>` blocks (Step Conditions / Step Expected Results) are indented one level past the opener line with `</pre>` aligned back. Runs via **Format Document** (`Shift+Alt+F`), on save (`editor.formatOnSave`), or via `esihelper.refactorDocumentOnSave`.
- **Quick-fix code actions** for unknown enum values — pick the right one from a lightbulb menu.
- **Multi-project support:** built-in `RNE` and `VORILS` profiles plus user-defined custom projects. Status-bar item (bottom-right) shows the active project; click to switch via QuickPick.
- **Snippets** for `[STEP]`, `[STEP DEFINITION]`, `[STEP INPUTS]`, `[STEP OUTPUTS]`, `[VARIABLES]`, `[FUNC_*]`, `[PART_*]`, `[CMD_EXECUTE]`, `[MANUAL_VERIFY]`, `[EXTERNAL_VERIFY]`, `[STEP GET_DUMP]`.
- **Step renumbering** (sequential 10, 20, 30, …) and **Goto step** (`Ctrl+G`).
- **Open with TestPit** — launches the active script in the configured `TestPit.exe`.

## Getting started

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=karamandev.esi-helper-for-testpit).
2. Open any `.esi` file. The status bar shows the active TestPit project (bottom-right) — click it to switch between `RNE`, `VORILS`, or a custom project.
3. Point each project at its `TestPit.exe` and its `Config` folder via VS Code Settings (see below). Validation and IntelliSense activate as soon as the config path resolves.

## Configuration

All `esihelper.*` settings are **user-scoped (machine-wide)** — they live in your VS Code _User_ settings, never in `.vscode/settings.json`. The extension does not pollute your workspace folder with config files.

| Setting | Purpose |
|---|---|
| _Active project_ | Remembered per workspace folder in VS Code's machine-wide `globalState`. Set via the status-bar picker. In a multi-root workspace the first folder's path is the key. Single-file mode is supported via an internal sentinel. |
| `esihelper.RNE.executablePath` / `esihelper.VORILS.executablePath` | Path to the project's `TestPit.exe`. Machine-scoped. |
| `esihelper.RNE.configFolderpath` / `esihelper.VORILS.configFolderpath` | Folder containing the project's TestPit XML configs (must end with a path separator). Machine-scoped. |
| `esihelper.customProjects` | Array of user-defined projects. Each entry is `{ id, label, executablePath, validityArgs[], openArgs[] }`. Use `{scriptPath}` and `{filePath}` placeholders in the args — both are substituted and double-quoted at runtime. Machine-scoped. |
| `esihelper.refactorDocumentOnSave` | When `true`, runs the ESI formatter on save. Machine-scoped. |

A custom-project entry whose `id` matches a built-in (`RNE` / `VORILS`) overrides the built-in.

### Example custom project

```json
"esihelper.customProjects": [{
  "id": "MYPROJ",
  "label": "My Project",
  "executablePath": "C:\\Tools\\custom.exe",
  "validityArgs": [
    "--cfg=foo",
    "--sf={scriptPath}",
    "--validate=true"
  ],
  "openArgs": ["--ow={filePath}"]
}]
```

## Commands

| Command | Default keybinding |
|---|---|
| ESI Helper: Run Validity Check | — |
| ESI Helper: Open with TestPit | — |
| ESI Helper: Update Step Numbers | — |
| ESI Helper: Refactor Document | — |
| ESI Helper: Show Processed File | — |
| ESI Helper: Select TestPit Project | — |
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
