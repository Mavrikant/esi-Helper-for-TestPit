// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from "child_process";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "esi Helper for TestPit" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json

    const disposable = vscode.commands.registerCommand('extension.sayHello', () => {
        vscode.window.showInformationMessage('Hello World from esi Helper!');
    });

    const disposable2 = vscode.commands.registerCommand('extension.openWithTestPit', async () => {
        const execSync = cp.exec;
        const currentlyOpenTabfilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        execSync("\"C:\\Program Files (x86)\\TestPit\\Tools\\bin\\TestPit.exe\" --sf="+ currentlyOpenTabfilePath );
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
}
