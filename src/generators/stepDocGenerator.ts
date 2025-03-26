import * as vscode from 'vscode';
import { callGeminiWithRetry } from '../extension'; 

/**
 * Generates Step Conditions and Step Expected Results for the current TestPit test step
 */
export async function generateStepDocumentation(myOutputViewProvider: any) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
    }

    // Show progress indication
    myOutputViewProvider.updateContent("Analyzing test step...");
    
    try {
        // Get the current step number based on cursor position
        const currentStepInfo = await getCurrentStep(editor);
        if (!currentStepInfo) {
            myOutputViewProvider.updateContent("Could not determine the current step. Please position cursor within a step.");
            return;
        }
        
        // Extract inputs and outputs for the current step
        const { stepNumber, inputs, outputs } = currentStepInfo;
        
        if (!inputs || !outputs) {
            myOutputViewProvider.updateContent(`Step ${stepNumber}: Missing inputs or outputs`);
            return;
        }

        myOutputViewProvider.updateContent(`Analyzing Step ${stepNumber}...\nGenerating documentation...`);

        // Generate documentation using AI
        const docResults = await generateStepDocWithAI(inputs, outputs, stepNumber);
        
        myOutputViewProvider.updateContent(`✅ Step ${stepNumber} documentation generated successfully!\n\n${docResults.conditions} \n\n${docResults.results}`);
    } catch (error: unknown) {
        console.error('Error generating step documentation:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        myOutputViewProvider.updateContent(`Error: ${errorMessage}`);
        vscode.window.showErrorMessage(`Error generating documentation: ${errorMessage}`);
    }
}

/**
 * Finds the current test step based on cursor position
 */
async function getCurrentStep(editor: vscode.TextEditor): Promise<{ stepNumber: string, inputs: string, outputs: string } | null> {
    const document = editor.document;
    const text = document.getText();
    const cursorPosition = editor.selection.active;
    const cursorOffset = document.offsetAt(cursorPosition);
    
    // Find all steps in the document
    const stepPattern = /\[STEP (\d+)\]([\s\S]*?)\[\/STEP \1\]/g;
    let match;
    
    while (match = stepPattern.exec(text)) {
        const stepNumber = match[1];
        const stepContent = match[2];
        const stepStartOffset = match.index;
        const stepEndOffset = match.index + match[0].length;
        
        // Check if cursor is within this step
        if (cursorOffset >= stepStartOffset && cursorOffset <= stepEndOffset) {
            // Extract inputs and outputs from this step
            const inputsMatch = /\[STEP INPUTS\]([\s\S]*?)\[\/STEP INPUTS\]/g.exec(stepContent);
            const outputsMatch = /\[STEP OUTPUTS\]([\s\S]*?)\[\/STEP OUTPUTS\]/g.exec(stepContent);
            
            if (!inputsMatch || !outputsMatch) {
                return null;
            }
            
            return {
                stepNumber,
                inputs: inputsMatch[1],
                outputs: outputsMatch[1]
            };
        }
    }
    
    return null;
}

/**
 * Calls the AI model to generate conditions and expected results
 */
async function generateStepDocWithAI(inputs: string, outputs: string, stepNumber: string): Promise<{ conditions: string, results: string }> {
    const prompt = `
You are a documentation generator for avionics test scripts. Analyze the following test inputs and outputs from Step ${stepNumber} and generate:
1. Step Conditions - Clear descriptions of the input conditions for this test
2. Step Expected Results - Clear descriptions of the expected outputs

Format:
- Use bullet points for each condition/result with <br/> HTML tags
- Be concise but descriptive
- Use consistent terminology
- CRITICAL: Each item MUST include a <br/> HTML tag AND start on a new line
- IMPORTANT: Follow the EXACT indentation pattern shown in the example below

STEP INPUTS:
${inputs}

STEP OUTPUTS:
${outputs}

Respond with JSON in this format:
{
  "conditions": "formatted HTML with <br/> tags and line breaks",
  "results": "formatted HTML with <br/> tags and line breaks"
}

The HTML format MUST follow this EXACT pattern with correct spacing and newlines:

                                    <br/> Scenario 1:
                                    <br/>* ItemName is ItemValue
                                    <br/>* AnotherItem is AnotherValue

                                    <br/> Scenario 2: 
                                    <br/>* OtherCondition applies

Note that each item starts with a <br/> tag, prefixed by proper indentation with spaces.
`;

    // Use a custom handler to just get the response text
    const tempProvider = {
        content: "",
        updateContent: function(text: string) {
            this.content = text;
        }
    };

    await callGeminiWithRetry(prompt, "", tempProvider);
    
    // Parse the JSON response
    try {
        // Look for JSON in the response, could be wrapped in code blocks
        const jsonMatch = tempProvider.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                         [null, tempProvider.content];
        
        let jsonContent = jsonMatch[1];
        
        // Clean any possible markdown formatting
        if (jsonContent.startsWith('`') && jsonContent.endsWith('`')) {
            jsonContent = jsonContent.substring(1, jsonContent.length - 1);
        }
        
        const parsedResult = JSON.parse(jsonContent);
        
        // Ensure proper newlines AND <br/> tags are present with correct indentation
        const processBreaks = (text: string): string => {
            // If no <br/> tags exist at all, add them to each line
            if (!text.includes('<br/>')) {
                // Split by lines and add <br/> to beginning of each non-empty line with proper indentation
                return text.split('\n')
                    .map(line => {
                        // Skip empty lines
                        if (!line.trim()) return line;
                        
                        const trimmedLine = line.trim();
                        
                        // Add appropriate indentation based on line content
                        if (trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
                            // Indented bullet points
                            return `<br/>     ${trimmedLine}`;
                        } else if (trimmedLine.includes('Scenario') || trimmedLine.endsWith(':')) {
                            // Section headers with no indentation
                            return `<br/> ${trimmedLine}`;
                        } else {
                            // Other content - standard indentation
                            return `<br/>     ${trimmedLine}`;
                        }
                    })
                    .join('\n');
            }
            const modifiedText = text.replace(/<br\/>/g, '\n\<br\/\>'); // Replace <br/> with newlines for processing
            return modifiedText;
        };
        
        return {
            conditions: processBreaks(parsedResult.conditions),
            results: processBreaks(parsedResult.results)
        };
    } catch (error: unknown) {
        console.error("Failed to parse AI response:", error);
        throw new Error("Failed to parse AI response. See console for details.");
    }
}
