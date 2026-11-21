import * as vscode from "vscode";
import { getActiveProjectIndex } from "../lib/projectIndexCache";
import { findDefinitionTargets, resolveDefinitions } from "../lib/xmlLocate";

/**
 * Go to Definition (F12 / Ctrl+click) from a `.esi` component name, field name
 * or enum value into the TestPit config XML of the active profile.
 *
 * A component name answers with its connection (cable / partition file) and
 * its message; when those are two places VS Code shows them in a peek. All the
 * logic is in lib/xmlLocate.ts — this only maps its answer onto LocationLinks.
 * `%MACRO%` definitions are a separate provider (macroNavigation.ts); VS Code
 * merges the two.
 */
export function registerEsiXmlDefinitionProvider(): vscode.Disposable {
  return vscode.languages.registerDefinitionProvider("esi", {
    provideDefinition(document, position) {
      // Per request, never cached: the index reloads on profile / file change.
      const index = getActiveProjectIndex();
      if (!index) {
        return undefined;
      }
      const query = findDefinitionTargets(
        index,
        document.getText(),
        position.line,
        position.character
      );
      if (!query) {
        return undefined;
      }
      const origin = new vscode.Range(
        query.line,
        query.startCol,
        query.line,
        query.endCol
      );
      const links: vscode.LocationLink[] = resolveDefinitions(query.targets).map(
        (loc) => {
          const range = new vscode.Range(
            loc.line,
            loc.character,
            loc.line,
            loc.character + loc.length
          );
          return {
            originSelectionRange: origin,
            targetUri: vscode.Uri.file(loc.file),
            targetRange: range,
            targetSelectionRange: range,
          };
        }
      );
      return links.length > 0 ? links : undefined;
    },
  });
}
