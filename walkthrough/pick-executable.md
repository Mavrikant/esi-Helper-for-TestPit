## TestPit executable

TestPit runs on **Windows only**. The validity check and **Open with TestPit** need a local TestPit installation; on other systems they cannot run.

Pick the **console** `TestPit.exe` once. The extension stores the path itself (it is not a `settings.json` entry and it is not in the registry).

- The validity check runs this `TestPit.exe` on a temporary copy of the editor contents.
- **Open with TestPit** starts the GUI `TestPitw.exe` from the same folder.
- Until a path is picked, the live validity check is skipped without a message. The checks that run inside the extension (tag structure, component and field names) do not need the executable.

To change the path later, run **ESI Helper: Pick TestPit Executable** again, or use *Change TestPit executable…* at the bottom of the profile picker.
