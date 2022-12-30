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

    const disposable3 = vscode.commands.registerCommand('extension.updateStepNumbers', async () => {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;

        if (editor) {
            const fullText = editor.document.getText();
            const firstLine = editor.document.lineAt(0);
            const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
            const textRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
            let number = 0;
            let targetText = fullText.replaceAll(/\[STEP \d+\]/g,"[STEP XX]");
            const count = (fullText.match(/\[STEP \d+\]/g) || []).length;
            for (let i = 0; i < count; i++) {
                targetText = targetText.replace("[STEP XX]",function() {
                    // will be called if a "A" gets found
                    number=number+10;        // increases count of "number"
                    const result = "[STEP " + number.toString() + "]";
                    return result;      // return will replace "A" with "1"
                });
            }
            number = 0;
            targetText= targetText.replaceAll(/\[\/STEP \d+\]/g,"[/STEP XX]");
            for (let i = 0; i < count; i++) {
                targetText = targetText.replace("[/STEP XX]",function() {
                    // will be called if a "A" gets found
                    number=number+10;        // increases count of "number"
                    const result = "[/STEP " + number.toString() + "]";
                    return result;      // return will replace "A" with "1"
                });
            }
            editor.edit(editBuilder => {
				editBuilder.replace(textRange, targetText);
            });
        }
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
    context.subscriptions.push(disposable3);
}
