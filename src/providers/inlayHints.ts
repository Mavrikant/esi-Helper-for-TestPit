import * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants";
import { InlayHintOptions, computeInlayHints } from "../lib/inlayHints";
import { getActiveProjectIndex, onIndexChanged } from "../lib/projectIndexCache";

/** Settings: `esihelper.inlayHints.{enumNames,units,ranges}`. */
function readOptions(): InlayHintOptions {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enumNames: cfg.get<boolean>("inlayHints.enumNames", true) !== false,
    units: cfg.get<boolean>("inlayHints.units", true) !== false,
    ranges: cfg.get<boolean>("inlayHints.ranges", false) === true,
  };
}

/**
 * Inlay hints after numeric field values: enum name, unit, optional range.
 * All logic is in lib/inlayHints.ts; the index is fetched per request.
 */
export function registerEsiInlayHintsProvider(): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  // The index reloads on a profile switch / registry reload / config-file
  // change; the settings decide which hints exist. Either way the editor has
  // to ask again.
  const onProfileChange = onIndexChanged(() => changed.fire());
  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e || e.affectsConfiguration(`${CONFIG_SECTION}.inlayHints`)) {
      changed.fire();
    }
  });

  const provider: vscode.InlayHintsProvider = {
    onDidChangeInlayHints: changed.event,
    provideInlayHints(document, range) {
      const hints = computeInlayHints(
        document.getText(),
        getActiveProjectIndex(),
        { startLine: range.start.line, endLine: range.end.line },
        readOptions()
      );
      return hints.map((h) => {
        const hint = new vscode.InlayHint(
          new vscode.Position(h.line, h.character),
          h.label,
          h.kind === "enumName" ? undefined : vscode.InlayHintKind.Type
        );
        hint.paddingLeft = true;
        hint.tooltip = h.tooltip;
        return hint;
      });
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerInlayHintsProvider("esi", provider),
    onProfileChange,
    onConfigChange,
    changed
  );
}
