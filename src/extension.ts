import * as vscode from "vscode";
import { registerOpenWithTestPit } from "./commands/openWithTestPit";
import { registerRunValidityCheck } from "./commands/runValidityCheck";
import { registerUpdateStepNumbers } from "./commands/updateStepNumbers";
import { registerGotoStep } from "./commands/gotoStep";
import { registerRefactorDocument } from "./commands/refactorDocument";
import { registerShowProcessedFile } from "./commands/showProcessedFile";
import { registerSelectProject } from "./commands/selectProject";
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

export function activate(context: vscode.ExtensionContext): void {
  console.log('Extension "esi Helper for TestPit" is now active.');
  context.subscriptions.push(
    registerOpenWithTestPit(),
    registerRunValidityCheck(),
    registerUpdateStepNumbers(),
    registerGotoStep(),
    registerRefactorDocument(),
    registerShowProcessedFile(),
    registerSelectProject(),
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
}

export function deactivate(): void {
  // no-op
}
