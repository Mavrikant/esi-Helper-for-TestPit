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

    const disposable3 = vscode.commands.registerCommand('extension.updateStepNumbers', updateStepNumbers);

    async function updateStepNumbers() {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;
      
        if (!editor) {
          return;
        }
      
        const fullText = editor.document.getText();
        const firstLine = editor.document.lineAt(0);
        const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
        const textRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
      
        let targetText = fullText.replace(/\[STEP \d+\]/g, '[STEP XX]');
        const stepCount = (fullText.match(/\[STEP \d+\]/g) || []).length;
      
        for (let i = 0; i < stepCount; i++) {
          targetText = targetText.replace('[STEP XX]', function() {
            const number = (i + 1) * 10;
            return `[STEP ${number}]`;
          });
        }
      
        targetText = targetText.replace(/\[\/STEP \d+\]/g, '[/STEP XX]');
      
        for (let i = 0; i < stepCount; i++) {
          targetText = targetText.replace('[/STEP XX]', function() {
            const number = (i + 1) * 10;
            return `[/STEP ${number}]`;
          });
        }
      
        editor.edit((editBuilder) => {
          editBuilder.replace(textRange, targetText);
        });
      }

    const disposable4 = vscode.commands.registerCommand("extension.gotoStep", async () => {
        let stepNumberStr = "10";
        const searchQuery = await vscode.window.showInputBox({
          placeHolder: "Step number",
          prompt: "Enter step number you want to",
          value: stepNumberStr,
        });
        
        if (searchQuery != undefined) {
          stepNumberStr = String(searchQuery);
          let lineNumber = 0;
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            return;
          }
          const reg1 = /\[STEP /;
          const reg2 = /\]/g;
          const stepRegex = new RegExp(
            reg1.source + stepNumberStr + reg2.source
          );

          const lines = editor.document.getText().split("\n");
          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(stepRegex);
            if (match) {
              lineNumber = i + 1;
              break;
            }
          }
          if(lineNumber !=0)
          {
            const range = editor.document.lineAt(lineNumber - 1).range;
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
          }
          else{
            vscode.window.showInformationMessage('Step not found!');
          }
        }
      }
    );

    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
    context.subscriptions.push(disposable3);
    context.subscriptions.push(disposable4);
}
