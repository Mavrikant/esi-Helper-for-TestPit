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
import { registerGotoMatchingTag } from "./commands/gotoMatchingTag";
import { registerInsertComponent } from "./commands/insertComponent";
import { registerValidateWorkspace } from "./commands/validateWorkspace";
import { registerLiveDiagnostics } from "./diagnostics";
import { registerProjectStatusBar, registerValidationStatusBar } from "./statusBar";
import {
  registerEsiFormatter,
  registerEsiRangeFormatter,
  registerFormatOnSave,
} from "./formatter";
import { registerIndexLifecycle } from "./lib/projectIndexCache";
import { registerEsiCompletionProvider } from "./providers/completion";
import { registerEsiHoverProvider } from "./providers/hover";
import { registerEsiKeywordHoverProvider } from "./providers/keywordHover";
import { registerEsiInlayHintsProvider } from "./providers/inlayHints";
import { registerEsiSemanticTokensProvider } from "./providers/semanticTokens";
import { registerEsiCodeActionsProvider } from "./providers/codeActions";
import { registerEsiDocumentSymbolProvider } from "./providers/documentSymbols";
import { registerEsiFoldingRangeProvider } from "./providers/folding";
import { registerEsiMacroProviders } from "./providers/macroNavigation";
import { registerEsiDocumentLinkProvider } from "./providers/documentLinks";
import { registerEsiCsvHoverProvider } from "./providers/csvHover";
import { registerEsiTagPairProviders } from "./providers/tagPairs";
import { registerEsiXmlDefinitionProvider } from "./providers/xmlDefinition";
import { registerEsiCodeLensProvider } from "./providers/codeLens";
import { registerComponentBrowser } from "./views/componentBrowser";
import { registerEsiTestController } from "./testing/esiTestController";
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
    registerGotoMatchingTag(),
    registerProjectStatusBar(),
    registerValidationStatusBar(),
    registerLiveDiagnostics(),
    registerEsiFormatter(),
    registerEsiRangeFormatter(),
    registerFormatOnSave(),
    registerIndexLifecycle(),
    registerInsertComponent(),
    registerComponentBrowser(),
    registerEsiCompletionProvider(),
    registerEsiHoverProvider(),
    registerEsiKeywordHoverProvider(),
    registerEsiInlayHintsProvider(),
    registerEsiSemanticTokensProvider(),
    registerEsiCodeActionsProvider(),
    registerEsiDocumentSymbolProvider(),
    registerEsiFoldingRangeProvider(),
    registerEsiMacroProviders(),
    registerEsiDocumentLinkProvider(),
    registerEsiCsvHoverProvider(),
    registerEsiTagPairProviders(),
    registerEsiXmlDefinitionProvider(),
    registerEsiCodeLensProvider(),
    registerComponentDiagnostics(),
    registerValidateWorkspace(),
    registerEsiTestController()
  );

  // Nudge the user to pick TestPit.exe if it isn't set yet — otherwise the
  // live validity check silently does nothing. Fire-and-forget (non-blocking).
  void promptForExeIfUnset();
}

export function deactivate(): void {
  // no-op
}
