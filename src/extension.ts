import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as util from "util";
import TelemetryReporter from "@vscode/extension-telemetry";
import { performance } from "perf_hooks";
import * as os from "os";
import { GoogleGenerativeAI } from '@google/generative-ai';

// Add utility for delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// the application insights key (also known as instrumentation key)
const key = "53cdcbb8-0891-4ebb-8804-641335a36c2a";

// telemetry reporter
let reporter: TelemetryReporter;

// Initialize Google Generative AI with API key from configuration
let genAI: GoogleGenerativeAI;

// Rate limiting configuration
const rateLimitConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000, // Max 1 minute delay
  lastRequestTime: 0,
  minTimeBetweenRequestsMs: 1000, // Minimum 1 second between requests
};

const testpitExecutablePath =
  '"C:\\Program Files (x86)\\TestPit\\Tools\\bin\\TestPit.exe"';
let isUpdating = false;
const diagnosticCollections = new Map<string, vscode.DiagnosticCollection>();

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "esi Helper for TestPit" is now active!'
  );

  // Get the configuration for Gemini API
  const config = vscode.workspace.getConfiguration('esihelper');
  const geminiApiKey = config.get('geminiApiKey') as string || 'AIzaSyBqg0Zo3XVh2Xohh4TABtqi1D4u9cY80A4';
  
  // Initialize the GenAI client with the API key from configuration
  genAI = new GoogleGenerativeAI(geminiApiKey);

  // create telemetry reporter on extension activation
  reporter = new TelemetryReporter(key);
  // ensure it gets properly disposed. Upon disposal the events will be flushed
  context.subscriptions.push(reporter);

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('esihelper.geminiApiKey')) {
        // Reinitialize the GenAI client with the updated API key
        const newConfig = vscode.workspace.getConfiguration('esihelper');
        const newApiKey = newConfig.get('geminiApiKey') as string || '';
        genAI = new GoogleGenerativeAI(newApiKey);
      }
    })
  );

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

      const config = vscode.workspace.getConfiguration('esihelper');
      const testpitConfigFolderpath = config.get(
        "testpitConfigFolderpath"
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
        .getConfiguration('esihelper')
        .get("testpitConfigFolderpath");

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

    // Create a Uri from the file path
    const filePath = `C:\\Users\\${username}\\Documents\\Testpit\\Preprocessed.esi`;
    const fileUri = vscode.Uri.file(filePath);

    try {
      await vscode.window.showTextDocument(fileUri, {
        viewColumn: vscode.ViewColumn.Beside
      });
    } catch (error) {
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

    // Initialize the webview with a starting message
    myOutputViewProvider.updateContent("Hello, SerdAI here! I'm analyzing your test script...");

    try {
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      
      // Get configuration file paths
      const config = vscode.workspace.getConfiguration('esihelper');
      const testpitConfigFolderpath = config.get("testpitConfigFolderpath") as string;
      
      // Read configuration files for context
      const configFiles = {
        messageConfig: "",
        a429: "",
        m1553: "",
        discrete: "",
        memory: ""
      };

      try {
        // Attempt to read each config file
        const messageConfigPath = `${testpitConfigFolderpath}MessageConfig_RNESystemTestCable.xml`;
        const a429Path = `${testpitConfigFolderpath}A429MessageFields.xml`;
        const m1553Path = `${testpitConfigFolderpath}1553MessageFields.xml`;
        const discretePath = `${testpitConfigFolderpath}DiscreteSignals.xml`;
        const memoryPath = `${testpitConfigFolderpath}MemoryPorts.xml`;

        if (fs.existsSync(messageConfigPath)) {
          configFiles.messageConfig = fs.readFileSync(messageConfigPath, 'utf-8');
        }
        if (fs.existsSync(a429Path)) {
          configFiles.a429 = fs.readFileSync(a429Path, 'utf-8');
        }
        if (fs.existsSync(m1553Path)) {
          configFiles.m1553 = fs.readFileSync(m1553Path, 'utf-8');
        }
        if (fs.existsSync(discretePath)) {
          configFiles.discrete = fs.readFileSync(discretePath, 'utf-8');
        }
        if (fs.existsSync(memoryPath)) {
          configFiles.memory = fs.readFileSync(memoryPath, 'utf-8');
        }
      } catch (error) {
        console.error("Error reading config files:", error);
        // Continue even if files can't be read
      }
      
      const serdAIPrompt = `### Role and Objective
You are serdAI, an expert AI helper specializing in test development for safety-critical avionics software projects adhering to DO-178C Level A standards. Your primary task is to analyze complete test scripts, which consist of multiple test steps, and identify any issues or gaps based on a provided checklist.

### Analysis Process
To accomplish this, you will:
1. Read the complete test script from start to finish to understand the overall flow and context.
2. Analyze each test step individually, evaluating it against the detailed checklist items provided. Note that not all checklist items will apply to every test step; use your judgment to determine relevance based on the step's purpose and content.
3. Use the configuration file, which details the test environment, including hardware configurations and signal definitions, to validate that each test step correctly interacts with the specified hardware and signals.

### Feedback Structure
For each test step that does not fully comply with the checklist, you will:
- Clearly identify the step by its name (e.g., [STEP 70]).
- List each problem found in that step.
- For each problem, specify which checklist item(s) it violates.
- Provide a concise rationale explaining why the issue is significant in the context of the checklist criteria.

Structure your feedback as follows:
- **Step Name:** [e.g., [STEP 70]]
  - **Problem:** [Brief description of the issue]
    - **Rationale:** [Why it’s a problem]

If a step has multiple issues, list them all under that step, sepete with empty new line. For steps with no issues, you may skip them or briefly note that they comply with the checklist.

### Additional Guidelines
- Ensure feedback is specific and actionable. For example, instead of saying "Input unclear," specify "Define the exact input value for variable X in [STEP 10]."
- Avoid general statements, praise for well-executed aspects, or repetition of test script content unless directly relevant to an issue.
- Identify and suggest corrections for any typographical or grammatical errors found in the test script.
- Ensure all feedback is clear, concise, and focused solely on identifying problems.

### Checklist for Test Evaluation
- Test environment and configurations are defined.
- Each test case is uniquely identified.
- Test case complies with the testing methodology.
- Test procedures comply with the test environment and configuration.
- Traceability between requirements and test procedures is correct and complete.
- Data/object/function is specified only once and referenced thereafter.
- Reference documents, acronyms, abbreviations, and definitions are complete.
- The information given is unambiguous.
- The information given is consistent.
- Document is free of typographical, documentation, style, and template errors.
- Test procedures comply with the test case.
- The software requirements traced by a test procedure are fully verified under normal and robust procedures.
- Inputs and expected results are clearly specified.
- Test procedures are compatible with the target hardware.
- Precision, performance, and accuracy of test steps are correct.
- Variables are tested using equivalence class partitioning.
- Time-related functions are tested.
- State transitions are exercised.
- Loops are exercised with abnormal range instances.
- Boolean logic expressions are exercised considering modified condition/decision coverage.
- Computations for out-of-range conditions are exercised.
- Arithmetic overflow conditions are tested.
- System initialization is exercised under abnormal conditions.
- Input of corrupted and failure mode data from external sources is exercised.
- Test procedures are repeatable.
- Test procedures are correct.
- Real and integer input variables are exercised using boundary values.
      
TestPit's Configuration File Contents:

<MessageConfig_RNESystemTestCable>
${configFiles.messageConfig}
</MessageConfig_RNESystemTestCable>

<A429MessageFields>
${configFiles.a429}
</A429MessageFields>

<1553MessageFields>
${configFiles.m1553}
</1553MessageFields>

<DiscreteSignals>
${configFiles.discrete}
</DiscreteSignals>

<MemoryPorts>
${configFiles.memory}
</MemoryPorts>

Communication style examples drawn from my prior messages:
"When users submit test scripts, the AI will analyze them and offer constructive suggestions for improvement, referencing the test checklist. Ensure the feedback is clear, supportive, and helpful to foster a positive experience."

When you receive a complete test script, analyze it thoroughly from start to finish, listing any problems you find in each step along with its step name. Use the configuration file information to understand the test environment and validate that the test steps correctly interact with the configured hardware and signals.`;
      
      // Implement the API call with retries and rate limiting
      await callGeminiWithRetry("<TestScript>\n" + selectedText + "\n</TestScript>", serdAIPrompt, myOutputViewProvider);
      
    } catch (error: any) {
      console.error("Error running SerdAI:", error);
      myOutputViewProvider.updateContent("Error running SerdAI command: " + (error.message || String(error)));
      vscode.window.showErrorMessage("Error running SerdAI command: " + (error.message || String(error)));
    }
  }

  /**
   * Makes calls to Gemini API with retry logic and rate limiting
   */
  async function callGeminiWithRetry(
    userContent: string, 
    systemPrompt: string, 
    outputProvider: MyOutputViewProvider
  ): Promise<void> {
    let retryCount = 0;
    let delay = rateLimitConfig.initialDelayMs;

    // Get the current configuration for model name
    const config = vscode.workspace.getConfiguration('esihelper');
    const modelName = config.get('geminiModelName') as string || 'gemini-2.0-flash-lite';

    // Implement rate limiting - ensure minimum time between requests
    const now = Date.now();
    const timeSinceLastRequest = now - rateLimitConfig.lastRequestTime;
    if (timeSinceLastRequest < rateLimitConfig.minTimeBetweenRequestsMs) {
      const waitTime = rateLimitConfig.minTimeBetweenRequestsMs - timeSinceLastRequest;
      outputProvider.updateContent("Rate limiting in effect. Waiting a moment before making request...");
      await sleep(waitTime);
    }

    while (retryCount <= rateLimitConfig.maxRetries) {
      try {
        // Update the last request time
        rateLimitConfig.lastRequestTime = Date.now();
        
        // Configure the model using the name from configuration
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Create a chat session
        const chat = model.startChat({
          history: [
            {
              role: "user",
              parts: [{ text: systemPrompt }],
            },
            {
              role: "model",
              parts: [{ text: "I'll analyze this test script according to the checklist criteria." }],
            },
          ],
          generationConfig: {
            temperature: 0.2, // Lower temperature for more focused responses
            maxOutputTokens: 8192,
          },
        });
        
        // Send the system prompt and stream the response
        const result = await chat.sendMessageStream(userContent);
        
        let accumulatedResponse = "";
        
        // Process the stream as it comes in
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          accumulatedResponse += chunkText;
          
          // Update the webview with each chunk of text
          outputProvider.updateContent(accumulatedResponse);
        }
        
        // If we reach here, the request was successful
        return;
        
      } catch (error: any) {
        console.error(`API call failed (attempt ${retryCount + 1}/${rateLimitConfig.maxRetries + 1}):`, error);
        
        // Check specifically for rate limit errors
        if (error.message && error.message.includes("429") || 
            error.toString().includes("429") || 
            error.toString().includes("Too Many Requests") ||
            error.toString().includes("Resource has been exhausted")) {
          
          retryCount++;
          
          if (retryCount <= rateLimitConfig.maxRetries) {
            // Update the webview with retry information
            outputProvider.updateContent(`Rate limit reached. Waiting ${delay/1000} seconds before retry ${retryCount}/${rateLimitConfig.maxRetries}...`);
            
            // Wait before retrying with exponential backoff
            await sleep(delay);
            
            // Exponential backoff with max delay cap
            delay = Math.min(delay * 2, rateLimitConfig.maxDelayMs);
          } else {
            outputProvider.updateContent("Maximum retry attempts reached. Please try again later when the API quota refreshes.");
            throw new Error("Maximum retry attempts reached for rate limit. Please try again later.");
          }
        } else {
          // For non-rate-limit errors, don't retry
          outputProvider.updateContent("Error communicating with the Gemini API: " + (error.message || String(error)));
          throw error;
        }
      }
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
    // Load only Marked for Markdown parsing (no KaTeX)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SerdAI Output</title>

  <!-- Marked for Markdown parsing -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif;
      padding: 0 20px;
      line-height: 1.5;
    }
    #output {
      max-width: 100%;
    }
    pre {
      background-color: #f3f3f3;
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
    }
    code {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, 'Ubuntu Mono', 'Liberation Mono', 'DejaVu Sans Mono', monospace;
    }
    blockquote {
      border-left: 3px solid #ccc;
      margin-left: 0;
      padding-left: 15px;
      color: #666;
    }
  </style>
  
  <script>
    // Define a function to update content based on Markdown input.
    function updateContent(newMarkdown) {
      // Convert Markdown to HTML using Marked.
      const html = marked.parse(newMarkdown);
      const outputDiv = document.getElementById('output');
      outputDiv.innerHTML = html;
    }

    // Listen for messages from the extension
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