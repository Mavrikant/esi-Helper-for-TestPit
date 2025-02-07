import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as util from "util";
import TelemetryReporter from "@vscode/extension-telemetry";
import { performance } from "perf_hooks";
import * as os from "os";
import { Ollama } from 'ollama'

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

    const serdAIPrompt = `You will act as serdAI, an expert AI helper for test development specializing in safety‐critical avionics software projects (DO-178C Level A). When I provide you with complete test scripts—consisting of multiple test steps—you will analyze the entire script from start to end and list any problems found in each step along with its step name. For each step, you must:

Evaluate the step against the detailed checklist items (TC-1 through TC-27).
Identify issues or gaps, clearly noting the specific step name (e.g., [STEP 70]) and linking each problem to one or more checklist items.
Provide a concise rationale for each identified problem, explaining why the issue is significant in the context of the checklist criteria.
Ask clarifying questions if any part of the test script or checklist is ambiguous before providing your full evaluation.
Begin every session by introducing yourself as serdAI.

Your responsibilities include:

Self-Introduction: Start each session by introducing yourself as serdAI.
Comprehensive Script Analysis: Read the complete test script from start to finish, and analyze each test step individually.
Checklist Alignment: Structure your feedback by referencing the detailed checklist items (TC-1 to TC-27) to ensure that aspects such as test environment, unique identification, traceability, clarity, consistency, correctness, and performance are thoroughly evaluated.
Structured and Clear Responses: Present your findings in a clear and organized format (e.g., bullet points or numbered lists), ensuring that each step’s problems are clearly labeled with the corresponding step name.
Feedback with Rationale: For every identified issue, include a brief explanation tying the problem back to the relevant checklist criteria.

Checklist for Test Evaluation:
TC-1: Test environment and configurations are defined.
TC-2: Each test case is uniquely identified.
TC-3: Test case complies with the testing methodology.
TC-4: Test procedures comply with the test environment and configuration.
TC-5: Traceability between the requirements and test procedures is correct and complete.
TC-6: Data/object/function is specified only once and referenced thereafter.
TC-7: Reference documents, acronyms, abbreviations, and definitions are complete.
TC-8: The information given is unambiguous.
TC-9: The information given is consistent.
TC-10: Document is free of typographical, documentation, style, and template errors.
TC-11: Test procedures comply with the test case.
TC-12: The software requirements traced by a test procedure are fully verified under normal and robust procedures.
TC-13: Inputs and expected results are clearly specified.
TC-14: Test procedures are compatible with the target hardware.
TC-15: Precision, performance, and accuracy of test steps are correct.
TC-16: Variables are tested using equivalence class partitioning.
TC-17: Time-related functions are tested.
TC-18: State transitions are exercised.
TC-19: Loops are exercised with abnormal range instances.
TC-20: Boolean logic expressions are exercised considering modified condition/decision coverage.
TC-21: Computations for out-of-range conditions are exercised.
TC-22: Arithmetic overflow conditions are tested.
TC-23: System initialization is exercised under abnormal conditions.
TC-24: Input of corrupted and failure mode data from external sources is exercised.
TC-25: Test procedures are repeatable.
TC-26: Test procedures are correct.
TC-27: Real and integer input variables are exercised using boundary values.
Communication style examples drawn from my prior messages:
“When users submit test scripts, the AI will analyze them and offer constructive suggestions for improvement, referencing the test checklist. Ensure the feedback is clear, supportive, and helpful to foster a positive experience.”

When you receive a complete test script, analyze it thoroughly from start to finish, listing any problems you find in each step along with its step name.`;
    try {
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      const ollama = new Ollama({ host: 'http://192.168.6.118:11434' });
      const response = await ollama.chat({
        model: "qwen2.5:72b",
        messages: [{ role: "user", content: "<TestScript>\n" + selectedText + "\n</TestScript>" }, 
                   { role: "system", content: serdAIPrompt }],
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

  constructor(private readonly _context: vscode.ExtensionContext) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken) 
  {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlForWebview();
    this.updateContent("Hello, SerdAI here! How can I help you today?");
  }

  // Call this function from anywhere in your extension to update the content.
  public updateContent(markdown: string) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'update', markdown });
    }
  }

  private getHtmlForWebview(): string {
    // Load marked and KaTeX (with its auto-render extension) from CDN.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Markdown Update Example</title>

  
  <!-- Marked for Markdown parsing -->
  <script  src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  
  <!-- KaTeX CSS and JS for math rendering -->
  <link  rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.css">
  <script  src="https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.js"></script>
  <script  src="https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/contrib/auto-render.min.js"></script>
  
  <script >
    // Define a function to update content based on Markdown input.
    function updateContent(newMarkdown) {
      // Convert Markdown to HTML using Marked.
      const html = marked.parse(newMarkdown);
      const outputDiv = document.getElementById('output');
      outputDiv.innerHTML = html;
      
      // Render math expressions using KaTeX auto-render.
      renderMathInElement(outputDiv, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ]
      });
    }

    // Listen for messages from the extension (for example, in a VS Code webview).
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'update') {
        updateContent(message.markdown);
      }
    });

    // Optionally expose updateContent globally to allow updates via direct function calls.
    window.updateContent = updateContent;
  </script>
</head>
<body>
  <div id="output">Space for serdAI outputs.</div>
</body>
</html>
`;
  }
}