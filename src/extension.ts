import * as vscode from "vscode";
import { registerOpenWithTestPit } from "./commands/openWithTestPit";
import { registerRunValidityCheck } from "./commands/runValidityCheck";
import { registerUpdateStepNumbers } from "./commands/updateStepNumbers";
import { registerGotoStep } from "./commands/gotoStep";
import { registerRefactorDocument } from "./commands/refactorDocument";
import { registerShowProcessedFile } from "./commands/showProcessedFile";
import { registerSelectProfile } from "./commands/selectProfile";
import { registerReloadRegistry } from "./commands/reloadRegistry";
import { registerPickExecutable } from "./commands/pickExecutable";
import { registerShowValidationInfo } from "./commands/showValidationInfo";
import { registerLiveDiagnostics } from "./diagnostics";
import { registerProjectStatusBar } from "./statusBar";
import { registerEsiFormatter, registerFormatOnSave } from "./formatter";
import { registerIndexLifecycle } from "./lib/projectIndexCache";
import { registerEsiCompletionProvider } from "./providers/completion";
import { registerEsiHoverProvider } from "./providers/hover";
import { registerEsiSemanticTokensProvider } from "./providers/semanticTokens";
import { registerEsiCodeActionsProvider } from "./providers/codeActions";
import { registerComponentDiagnostics } from "./componentDiagnostics";
import { initPluginStore } from "./lib/pluginStore";
import { ensureRegistryLoaded, promptForExeIfUnset } from "./lib/profileRegistry";

export function activate(context: vscode.ExtensionContext): void {
  console.log('Extension "esi Helper for TestPit" is now active.');
  // Order matters: the store must be initialised before the registry is read,
  // and the registry must be loaded before any register*() runs — the status
  // bar, index cache, and component diagnostics read the active profile and
  // its config paths at registration time.
  initPluginStore(context);
  ensureRegistryLoaded();
  context.subscriptions.push(
    registerOpenWithTestPit(),
    registerRunValidityCheck(),
    registerUpdateStepNumbers(),
    registerGotoStep(),
    registerRefactorDocument(),
    registerShowProcessedFile(),
    registerSelectProfile(),
    registerReloadRegistry(),
    registerPickExecutable(),
    registerShowValidationInfo(),
    registerProjectStatusBar(),
    registerLiveDiagnostics(),
    registerEsiFormatter(),
    registerFormatOnSave(),
    registerIndexLifecycle(),
    registerEsiCompletionProvider(),
    registerEsiHoverProvider(),
    registerEsiSemanticTokensProvider(),
    registerEsiCodeActionsProvider(),
    registerComponentDiagnostics()
  );

  // Nudge the user to pick TestPit.exe if it isn't set yet — otherwise the
  // live validity check silently does nothing. Fire-and-forget (non-blocking).
  void promptForExeIfUnset();
}

export function deactivate(): void {
  // no-op
}
