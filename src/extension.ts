// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testpitExecutablePath =
  '"C:\\Program Files (x86)\\TestPit\\Tools\\bin\\TestPit.exe"';
let isUpdating = false;
const updateInterval = 1000; // milliseconds
const diagnosticCollections = new Map<string, vscode.DiagnosticCollection>();

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "esi Helper for TestPit" is now active!'
  );

  const disposable2 = vscode.commands.registerCommand(
    "extension.openWithTestPit",
    async () => {
      const currentlyOpenTabfilePath =
        vscode.window.activeTextEditor?.document.uri.fsPath;
      cp.exec(testpitExecutablePath + " --ow=" + currentlyOpenTabfilePath);
    }
  );

  function clearDiagnostics(document: vscode.TextDocument) {
    const uri = document.uri.toString();
    const diagnosticCollection = diagnosticCollections.get(uri);
    if (diagnosticCollection) {
      diagnosticCollection.clear();
      diagnosticCollection.dispose();
      diagnosticCollections.delete(uri);
    }
  }

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (isUpdating) {
      return;
    }
    isUpdating = true;
    setTimeout(() => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      // create a temporary file with a unique filename
      const tempFilePath = editor.document.uri.fsPath + ".temp";
      fs.writeFileSync(tempFilePath, editor.document.getText());

      const uri = editor.document.uri;
      let diagnosticCollection = diagnosticCollections.get(uri.toString());
      if (!diagnosticCollection) {
        diagnosticCollection = vscode.languages.createDiagnosticCollection(
          uri.toString()
        );
        diagnosticCollections.set(uri.toString(), diagnosticCollection);
      }
      diagnosticCollection.clear();

      // Add new diagnostics to the collection
      const diagnosticList: vscode.Diagnostic[] = [];

      const validityOutput = cp
        .execSync(
          testpitExecutablePath +
            " --sf=" +
            tempFilePath +
            " --validateScriptOnly=true"
        )
        .toString();
      console.log(validityOutput);
      fs.unlinkSync(tempFilePath);

      const lines = validityOutput.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const regexMatch = line.match(
          /\[(Fatal|Error|Warn.)\] (Line:)?\s*(\d+)?/
        );
        if (regexMatch) {
          const Type = regexMatch[1];
          const isLineNumberExist = regexMatch[2];
          const lineNumber = regexMatch[3];
          console.log(`Type: ${Type}`);
          console.log(`isLineNumberExist: ${isLineNumberExist}`);
          console.log(`Line number: ${lineNumber}`);

          const range = new vscode.Range(
            new vscode.Position(parseInt(lineNumber) - 1, 0),
            new vscode.Position(parseInt(lineNumber) - 1, 0)
          );
          const message = line.substring(9).trim();
          let DiagnosticSeverity = vscode.DiagnosticSeverity.Error;
          if (Type == "Warn.") {
            DiagnosticSeverity = vscode.DiagnosticSeverity.Warning;
          }
          const diagnostic = new vscode.Diagnostic(
            range,
            message,
            DiagnosticSeverity
          );
          diagnosticList.push(diagnostic);
        }
      }

      // Add the diagnostic to the collection
      diagnosticCollection.set(uri, diagnosticList);

      isUpdating = false;
    }, updateInterval);
  });

  const disposable3 = vscode.commands.registerCommand(
    "extension.updateStepNumbers",
    updateStepNumbers
  );

  async function updateStepNumbers() {
    // Get the active text editor
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return;
    }

    const fullText = editor.document.getText();
    const firstLine = editor.document.lineAt(0);
    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
    const textRange = new vscode.Range(
      firstLine.range.start,
      lastLine.range.end
    );

    let targetText = fullText.replace(/\[STEP \d+\]/g, "[STEP XX]");
    const stepCount = (fullText.match(/\[STEP \d+\]/g) || []).length;

    for (let i = 0; i < stepCount; i++) {
      targetText = targetText.replace("[STEP XX]", function () {
        const number = (i + 1) * 10;
        return `[STEP ${number}]`;
      });
    }

    targetText = targetText.replace(/\[\/STEP \d+\]/g, "[/STEP XX]");

    for (let i = 0; i < stepCount; i++) {
      targetText = targetText.replace("[/STEP XX]", function () {
        const number = (i + 1) * 10;
        return `[/STEP ${number}]`;
      });
    }

    editor.edit((editBuilder) => {
      editBuilder.replace(textRange, targetText);
    });
  }

  const disposable4 = vscode.commands.registerCommand(
    "extension.gotoStep",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const searchQuery = await vscode.window.showInputBox({
        placeHolder: "Step number",
        prompt: "Enter the step number you want to go to",
      });
      if (!searchQuery) {
        return;
      }
      const stepNumberStr = String(searchQuery);
      const stepRegex = new RegExp(`\\[STEP ${stepNumberStr}\\]`);
      const lines = editor.document.getText().split("\n");
      const lineNumber = lines.findIndex((line) => stepRegex.test(line));
      if (lineNumber === -1) {
        return vscode.window.showInformationMessage(
          '😔 Step "' + stepNumberStr + '" not found!'
        );
      }
      const range = editor.document.lineAt(lineNumber).range;
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    }
  );

  const disposable5 = vscode.commands.registerCommand(
    "extension.refactorDocument",
    refactorDocument
  );

  async function refactorDocument() {
    // Get the current editor
    const editor = vscode.window.activeTextEditor;

    // If there's no open editor, do nothing
    if (!editor) {
      return;
    }

    // Get the entire text of the document
    const text = editor.document.getText();

    // Split the text into an array of lines
    const lines = text.split("\n");

    // Trim trailing spaces from each line
    const trimmedLines = lines.map((line) => line.trimEnd());

    // Join the lines back into a single string
    const trimmedText = trimmedLines.join("\n");

    // Replace tabs with 4 spaces and trim trailing spaces
    const replacedText = trimmedText.replace(/\t/g, "    ");

    // Replace the entire text of the document with the trimmed text
    editor.edit((editBuilder) => {
      const fullDocRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length)
      );
      editBuilder.replace(fullDocRange, replacedText);
    });
  }

  context.subscriptions.push(disposable2);
  context.subscriptions.push(disposable3);
  context.subscriptions.push(disposable4);
  context.subscriptions.push(disposable5);
}
