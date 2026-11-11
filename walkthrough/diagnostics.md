## Problems

Findings appear as squiggles in the editor and in the **Problems** panel. They come from two sources, shown in the *source* column:

| Source | Produced by | Needs |
|---|---|---|
| `esi Helper` | checks inside the extension: section tags, component / field / enum names, macros, step numbering | nothing for the structural checks; an active profile for the name checks |
| `TestPit` | `TestPit.exe` run on a temporary copy of the editor contents | the TestPit executable (Windows only) |

The `TestPit` check runs while you edit (turn it off with the `esihelper.liveValidation` setting; `esihelper.liveValidationDelay` sets the pause before it starts), and on demand with **ESI Helper: Run Validity Check** — also available as a button in the editor title bar and in the editor context menu. The on-demand run writes TestPit's full output to the *esi Helper* output channel.

The `esi Helper` checks are an editing aid. They do not replace the TestPit validity check.
