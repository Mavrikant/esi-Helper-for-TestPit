<p>
  <h1 align="center">esi Helper for TestPit</h1>
</p>
<p align="center">
    <a href="https://github.com/Mavrikant/esi-Helper-for-TestPit">
        <img src="https://img.shields.io/github/stars/Mavrikant/esi-Helper-for-TestPit?style=social">
    </a>
</p>

The **ESI Helper for TestPit** is a powerful Visual Studio Code extension that enhances the test script development process. It provides real-time feedback by checking the validity of test scripts, allowing for reliable and accurate debugging of errors. With its powerful syntax highlighter, the extension makes test scripts easy to read and understand. Additionally, the library of snippets enables developers to quickly and easily complete tests, while the refactoring feature speeds up the code maintenance process. Overall, the ESI Helper for TestPit improves developer productivity, saves time, and ensures the creation of faster and error-free tests.

![Animation](/images/Animation.gif)

![Problmes](/images/Problems.png)
## Features

- Snippets for `[STEP]`, `[STEP DEFINITION]`, `[STEP INPUTS]`, `[STEP OUTPUTS]`, `[VARIABLES]`, `[FUNC_*]`, `[PART_*]`, `[CMD_EXECUTE]`, `[MANUAL_VERIFY]`, `[EXTERNAL_VERIFY]`, `[STEP GET_DUMP]`
- Syntax highlighting and bracket matching
- Goto step number (`Ctrl+G` → enter step number)
- Step renumbering (sequential 10, 20, 30, …) via the **Update Step Numbers** command
- Live linting / error checking against the local `TestPit.exe` while you type
- Auto-formatting with ESI-aware indentation: contents of `[TAG]…[/TAG]` blocks are indented at 4-space increments per nesting level; `<pre>…</pre>` blocks (Step Conditions / Step Expected Results) are indented one level past the opener line, with `</pre>` aligned back. Available via **Format Document** (Shift+Alt+F) and on save (`"esihelper.refactorDocumentOnSave": true` or VS Code's `"editor.formatOnSave"`)
- **Multi-project support:** built-in `RNE` and `VORILS` profiles plus user-defined custom projects. Status-bar item (bottom-right) shows the active project; click to switch via QuickPick
- **Open with TestPit** command — opens the active script in the configured `TestPit.exe`
- **Component data IntelliSense:** auto-completion + hover for connections (`429_…`, `1553_…`, `DIS_…`, `Mem_…`), their fields, enum values, and `%VARIABLE%` references — driven by the active project's TestPit XMLs. Type `[`, hit Ctrl+Space inside a component block, or hover any identifier. Re-indexes automatically when XMLs change.
- **Semantic highlighting:** known connection / field / enum / variable identifiers carry a `defaultLibrary` modifier so themes can color resolved-vs-unknown identifiers differently — typos and stale references stand out.
- **Component validation warnings:** unknown component names, unknown fields, and invalid enum values get squiggle warnings (and Problems-panel entries) on every keystroke — e.g. `SDI = NORMAL_NOPE` flags `NORMAL_NOPE` with the list of valid enum names. Source: `esi Helper`.

## Configuration

Set in VS Code Settings (or `.vscode/settings.json`):

| Setting | Purpose |
|---|---|
| `esihelper.activeProject` | ID of the active TestPit project. Stored at workspace scope; set via the status-bar picker. |
| `esihelper.RNE.executablePath` / `esihelper.VORILS.executablePath` | Path to the project's `TestPit.exe`. |
| `esihelper.RNE.configFolderpath` / `esihelper.VORILS.configFolderpath` | Folder containing the project's TestPit XML configs (must end with a path separator). |
| `esihelper.customProjects` | Array of user-defined projects. Each entry is `{ id, label, executablePath, validityArgs[], openArgs[] }`. Use `{scriptPath}` and `{filePath}` placeholders in the args — both are substituted and double-quoted at runtime. |
| `esihelper.refactorDocumentOnSave` | When `true`, runs the ESI formatter on save. |

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
| Goto step number | `Ctrl+G` (when editing `.esi`) |
| Format Document (built-in) | `Shift+Alt+F` (when editing `.esi`) |

## Development

```bash
npm install
npm run compile     # tsc → out/
npm run lint        # ESLint (flat config)
npm test            # mocha unit tests (71 currently)
npm run build-icons # regenerate the status-bar icon font from icons/testpit.svg
```

Press `F5` in VS Code to launch the Extension Development Host. CI runs lint + compile + test on Ubuntu / macOS / Windows × Node 22 for every push to `main` and every PR.

See [CLAUDE.md](CLAUDE.md) for an architecture overview and contribution conventions, [CHANGELOG.md](CHANGELOG.md) for release history.

# Developers

- M. Serdar Karaman (<a href="https://github.com/Mavrikant" alt="Github"><img src="https://cdn-icons-png.flaticon.com/512/25/25231.png" alt="Github" width="15" height="15"></a>, <a href="https://www.linkedin.com/in/mserdarkaraman/" alt="linkedin"><img src="https://raw.githubusercontent.com/MartinHeinz/MartinHeinz/master/linkedin-3-16.png" alt="linkedin" width="15" height="15"></a>, https://karaman.dev/)

## License
This project is licensed under the terms of the GNU General Public License v3.0

Copyright © 2020 M. Serdar Karaman

[3.2]: https://raw.githubusercontent.com/MartinHeinz/MartinHeinz/master/linkedin-3-16.png (LinkedIn)
[2]: https://www.linkedin.com/in/mserdarkaraman/
