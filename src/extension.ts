import * as vscode from "vscode";
import { registerOpenWithTestPit } from "./commands/openWithTestPit";
import { registerRunValidityCheck } from "./commands/runValidityCheck";
import { registerUpdateStepNumbers } from "./commands/updateStepNumbers";
import { registerGotoStep } from "./commands/gotoStep";
import { registerRefactorDocument } from "./commands/refactorDocument";
import { registerShowProcessedFile } from "./commands/showProcessedFile";
import { registerLiveDiagnostics } from "./diagnostics";

export function activate(context: vscode.ExtensionContext): void {
  console.log('Extension "esi Helper for TestPit" is now active.');
  context.subscriptions.push(
    registerOpenWithTestPit(),
    registerRunValidityCheck(),
    registerUpdateStepNumbers(),
    registerGotoStep(),
    registerRefactorDocument(),
    registerShowProcessedFile(),
    registerLiveDiagnostics()
  );
}

export function deactivate(): void {
  // no-op
}
