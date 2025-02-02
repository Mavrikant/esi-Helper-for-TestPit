import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as util from "util";
import TelemetryReporter from "@vscode/extension-telemetry";
import { performance } from "perf_hooks";
import * as os from "os";
import ollama from "ollama";

// the application insights key (also known as instrumentation key)
const key = "53cdcbb8-0891-4ebb-8804-641335a36c2a";

// telemetry reporter
let reporter: TelemetryReporter;

const testpitExecutablePath =
  '"C:\\Program Files (x86)\\TestPit\\Tools\\bin\\TestPit.exe"';
let isUpdating = false;
const diagnosticCollections = new Map<string, vscode.DiagnosticCollection>();

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "esi Helper for TestPit" is now active!'
  );

  // create telemetry reporter on extension activation
  reporter = new TelemetryReporter(key);
  // ensure it gets properly disposed. Upon disposal the events will be flushed
  context.subscriptions.push(reporter);

  const disposable2 = vscode.commands.registerCommand(
    "extension.openWithTestPit",
    async () => {
      reporter.sendTelemetryEvent("openWithTestPit_Usage");

      const currentlyOpenTabfilePath =
        vscode.window.activeTextEditor?.document.uri.fsPath;
      cp.exec(testpitExecutablePath + " --ow=" + currentlyOpenTabfilePath);
    }
  );
  class OutputChannel {
    private static instance: vscode.OutputChannel;

    public static getInstance(): vscode.OutputChannel {
      if (!OutputChannel.instance) {
        OutputChannel.instance =
          vscode.window.createOutputChannel("esi Helper");
      }
      return OutputChannel.instance;
    }
  }
  const disposable6 = vscode.commands.registerCommand(
    "extension.runValidityCheck",
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }
      const start = performance.now();

      // create a temporary file with a unique filename
      const tempFilePath = editor.document.uri.fsPath + ".temp";
      fs.writeFileSync(tempFilePath, editor.document.getText());

      const config = vscode.workspace.getConfiguration();
      const testpitConfigFolderpath = config.get(
        "esihelper.testpitConfigFolderpath"
      );

      const validityOutput = cp
        .execSync(
          testpitExecutablePath +
          " --cf=" +
          testpitConfigFolderpath +
          "MessageConfig_RNESystemTestCable.xml" +
          " --ac=" +
          testpitConfigFolderpath +
          "A429MessageFields.xml" +
          " --mc=" +
          testpitConfigFolderpath +
          "1553MessageFields.xml" +
          " --dc=" +
          testpitConfigFolderpath +
          "DiscreteSignals.xml" +
          " --pc=" +
          testpitConfigFolderpath +
          "MemoryPorts.xml" +
          " --sf=" +
          tempFilePath +
          " --validateScriptOnly=true"
        )
        .toString();
      fs.unlinkSync(tempFilePath);

      // print a message to the output channel
      OutputChannel.getInstance().clear();
      OutputChannel.getInstance().appendLine(validityOutput);
      OutputChannel.getInstance().show(true);

      const end = performance.now();
      const elapsedTime = end - start;
      reporter.sendTelemetryEvent(
        "runValidityCheck_Usage",
        { stringProp: "some string" },
        { elapsedTime_ms: elapsedTime }
      );
    }
  );

  vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (isUpdating) {
      return;
    }
    isUpdating = true;
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const start = performance.now();
      const uri = editor.document.uri;
      let diagnosticCollection = diagnosticCollections.get(uri.toString());
      if (!diagnosticCollection) {
        diagnosticCollection = vscode.languages.createDiagnosticCollection(
          uri.toString()
        );
        diagnosticCollections.set(uri.toString(), diagnosticCollection);
      }
      diagnosticCollection.clear();

      const testpitConfigFolderpath = vscode.workspace
        .getConfiguration()
        .get("esihelper.testpitConfigFolderpath");

      // create a temporary file with a unique filename
      const tempFilePath = editor.document.uri.fsPath + ".temp";
      fs.writeFileSync(tempFilePath, editor.document.getText());

      const validityOutput = await executeTestpitValidity(
        tempFilePath,
        testpitExecutablePath,
        testpitConfigFolderpath
      );

      const diagnostics = parseValidtyOutput(validityOutput, editor);
      fs.unlinkSync(tempFilePath);

      diagnosticCollection.set(uri, diagnostics);

      const end = performance.now();
      const elapsedTime = end - start;
      reporter.sendTelemetryEvent(
        "onDidChangeTextDocument_Usage",
        { stringProp: "some string" },
        { elapsedTime_ms: elapsedTime }
      );
    } catch (error: any) {
      const stackTrace = error.stack || "";
      const errorMessage = error.message || "";
      const exception = {
        name: error.name,
        message: errorMessage,
        stack: stackTrace,
      };
      reporter.sendTelemetryException(exception);
    } finally {
      isUpdating = false;
    }
  });

  async function executeTestpitValidity(
    FilePath: fs.PathLike,
    testpitExecutablePath: string,
    testpitConfigFolderpath: unknown
  ) {
    const command = `${testpitExecutablePath} --cf=${testpitConfigFolderpath}MessageConfig_RNESystemTestCable.xml --ac=${testpitConfigFolderpath}A429MessageFields.xml --mc=${testpitConfigFolderpath}1553MessageFields.xml --dc=${testpitConfigFolderpath}DiscreteSignals.xml --pc=${testpitConfigFolderpath}MemoryPorts.xml --sf="${FilePath}" --validateScriptOnly=true`;
    const validityOutput = await util.promisify(cp.exec)(command);
    return validityOutput.stdout.toString();
  }

  function parseValidtyOutput(
    validityOutput: string,
    editor: vscode.TextEditor
  ) {
    const diagnostics = [];
    const lines = validityOutput.split("\n");
    for (const line of lines) {
      // Updated regex to capture both "Line:" and "Line(s):" followed by one or more numbers
      const regexMatch = line.match(/\[(Fatal|Error|Warn.)\].*(Line:|Line\(s\):)\s?(\d+)/);
      if (regexMatch) {
        const type = regexMatch[1];
        // Assuming the line number might be missing, we use 0 as a fallback
        let lineNumber = regexMatch[3] ? parseInt(regexMatch[3]) - 1 : 0;
        if (Number.isNaN(lineNumber)) lineNumber = 0; // Additional check to ensure lineNumber is a number

        // Protect against accessing a line out of the document's range
        const documentLineCount = editor.document.lineCount;
        if (lineNumber >= documentLineCount) {
          lineNumber = documentLineCount - 1;
        }

        const lineText = editor.document.lineAt(lineNumber).text;
        const firstNonSpaceCharIndex = lineText.search(/\S|$/);
        const range = new vscode.Range(
          lineNumber,
          firstNonSpaceCharIndex,
          lineNumber,
          lineText.trimEnd().length
        );
        // Modified to correctly slice the message from the rest of the line
        const message = line.trim().slice(8);
        const severity =
          type === "Warn."
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostics.push(diagnostic);
      }
    }
    return diagnostics;
  }


  const disposable3 = vscode.commands.registerCommand(
    "extension.updateStepNumbers",
    updateStepNumbers
  );

  async function updateStepNumbers() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return;
    }
    reporter.sendTelemetryEvent("updateStepNumbers_Usage");
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
      reporter.sendTelemetryEvent("gotoStep_Usage");

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
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return;
    }
    reporter.sendTelemetryEvent("refactorDocument_Usage");

    const text = editor.document.getText();
    const lines = text.split("\n");
    const trimmedLines = lines.map((line) => line.trimEnd());
    const trimmedText = trimmedLines.join("\n");
    const replacedText = trimmedText.replace(/\t/g, "    ");

    await editor.edit((editBuilder) => {
      const fullDocRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length)
      );
      editBuilder.replace(fullDocRange, replacedText);
    });
  }

  const disposable7 = vscode.commands.registerCommand(
    "extension.showProcessedFile",
    showProcessedFile
  );

  async function showProcessedFile() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return;
    }
    reporter.sendTelemetryEvent("showProcessedFile_Usage");

    // Get the current username
    const username = os.userInfo().username;
    console.log(username);

    // Create a Uri from the file path
    const filePath = `C:\\Users\\${username}\\Documents\\Testpit\\Preprocessed.esi`;
    const fileUri = vscode.Uri.file(filePath);

    try {
      await vscode.window.showTextDocument(fileUri, {
        viewColumn: vscode.ViewColumn.Beside
      });
    } catch (error) {
      console.error("Error opening file:", error);
      vscode.window.showErrorMessage("Could not open file.");
    }
  }

  const disposable8 = vscode.commands.registerCommand(
    "extension.serdAI",
    runSerdAI
  );

  async function runSerdAI() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor found.");
      return;
    }
    reporter.sendTelemetryEvent("SerdAI_Usage");

    const serdAIPrompt = `You will act as serdAI, an expert AI helper for test development specializing in safety‐critical avionics software projects (DO-178C Level A). When I provide you with test scripts, you will analyze them and suggest improvements based on the detailed checklist provided below. Begin each session by introducing yourself as serdAI. Your responses must be clear, direct, and structured, using a professional tone that mirrors my communication style.

Your responsibilities include:

Self-introduction: Start by introducing yourself as serdAI.
Test Script Analysis: Upon receiving a test script, review it thoroughly using the following checklist categories:
Documentation and Planning: Verify the completeness and currency of plans (SDP, PSAC, SVP, SQAP, SCMP) and ensure that roles, responsibilities, and processes are clearly defined. Confirm traceability and proper baseline documentation, and check tool qualification per DO-178C/DO-330.
Requirements Review: Ensure that high-level and low-level requirements are clear, complete, testable, and traceable, with safety-critical items correctly identified.
Design Review: Assess whether the design architecture and interfaces reflect the requirements, comply with internal guidelines and DO-178C objectives, and support modularity and maintainability.
Code Review: Check adherence to coding standards, readability, proper error handling, static analysis, and traceability from code to requirements.
Verification and Test Case Review: Evaluate test cases for completeness and coverage, confirm that test environments and results are well-documented, and ensure regression and integration testing is properly executed.
Configuration Management and Traceability: Verify that all artifacts are under configuration management, with baselines established and traceability matrices maintained.
Safety and Regulatory Compliance: Confirm compliance with DO-178C objectives, ensuring independent reviews, documented audit trails, and appropriate handling of discrepancies.
General Review Process: Check for reviewer independence, comprehensive issue identification, and documented corrective actions.
Training and Mentorship: Encourage continuous learning by providing guidance on standards, tools, and best practices.
Clarification: If any part of the test script or checklist is ambiguous, ask clarifying questions before providing your evaluation.
Rationale: For every suggested improvement, include a brief explanation of why it is necessary, referencing the corresponding checklist section.
Write your responses using a clear, structured format, and ensure that each point of feedback is directly tied to the checklist criteria.

Communication style examples drawn from my prior messages:
“Im genererating an AI helper for test development. user will sent test scripts and AI will suggest inprovments according to test checklist.”`
    try {
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      // Sample usage of the ollama package. Adjust model and message as needed.
      const response = await ollama.chat({
        model: "deepseek-r1:8b",
        messages: [{ role: "user", content: selectedText }, { role: "system", content: serdAIPrompt }],
      });
      console.log("Ollama response:", response);
      const cleanResponse = response.message.content.replace(/<think>[\s\S]*?<\/think>/g, '');

      myOutputViewProvider.updateContent(cleanResponse);

    } catch (error) {
      console.error("Error running SerdAI:", error);
      vscode.window.showErrorMessage("Error running SerdAI command.");
    }
  }

  const myOutputViewProvider = new MyOutputViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'myOutputView',
      myOutputViewProvider
    )
  );





  context.subscriptions.push(disposable2);
  context.subscriptions.push(disposable3);
  context.subscriptions.push(disposable4);
  context.subscriptions.push(disposable5);
  context.subscriptions.push(disposable6);
  context.subscriptions.push(disposable7);
  context.subscriptions.push(disposable8);

}



class MyOutputViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    
    // Allow scripts in the webview.
    webviewView.webview.options = { enableScripts: true };

    // Set the initial HTML content.
    webviewView.webview.html = this.getHtmlForWebview();
    this.updateContent("Hello, SerdAI here! How can I help you today?");
  }

  // This function sends a message with a markdown string.
  public updateContent(markdown: string) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'update', markdown });
    }
  }

  private getHtmlForWebview(): string {
    // Load the marked library from a CDN to render markdown.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Markdown Renderer</title>
  <style>
    body { font-family: sans-serif; padding: 10px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <div id="output">Initial content</div>
  <script>
    // Acquire VS Code API
    const vscode = acquireVsCodeApi();
    // Listen for messages from the extension.
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'update') {
        // Use marked to convert markdown to HTML.
        const html = marked.parse(message.markdown);
        document.getElementById('output').innerHTML = html;
      }
    });
  </script>
</body>
</html>`;
  }
}