import * as vscode from "vscode";
import { findStepLine } from "../lib/findStepLine";
import {
  findStepAtLine,
  findStepByQuery,
  listSteps,
  StepInfo,
} from "../lib/listSteps";

interface StepItem extends vscode.QuickPickItem {
  step: StepInfo;
}

function toItem(step: StepInfo): StepItem {
  const requirements = step.requirements;
  const hasRequirements =
    requirements !== "" && requirements.toUpperCase() !== "N/A";
  return {
    step,
    label: step.label,
    description: step.description || undefined,
    detail: hasRequirements ? requirements : undefined,
  };
}

export function registerGotoStep(): vscode.Disposable {
  return vscode.commands.registerCommand("extension.gotoStep", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const document = editor.document;
    const steps = listSteps(document.getText());
    if (steps.length === 0) {
      vscode.window.showInformationMessage(
        "No steps found in this file (looking for [STEP <number>] sections)."
      );
      return;
    }

    const originalSelections = editor.selections;
    const originalView = editor.visibleRanges[0];
    const highlight = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    });

    const lineRange = (line: number): vscode.Range =>
      document.lineAt(Math.min(line, document.lineCount - 1)).range;

    const preview = (line: number): void => {
      const range = lineRange(line);
      editor.setDecorations(highlight, [range]);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    };

    const jump = (line: number): void => {
      const range = lineRange(line);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    };

    const items = steps.map(toItem);
    const itemFor = (step: StepInfo | undefined): StepItem | undefined =>
      step ? items.find((it) => it.step === step) : undefined;

    const picker = vscode.window.createQuickPick<StepItem>();
    picker.items = items;
    picker.title = `Go to Step (${steps.length})`;
    picker.placeholder = "Step number, or text from the step description";
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;

    let accepted = false;

    // True once the user has moved off the exact-number item on purpose
    // (arrow keys / mouse) since the text last changed.
    let userMoved = false;

    picker.onDidChangeActive((active) => {
      if (active.length > 0) {
        preview(active[0].step.line);
        // The filter's own first-ranked item can also arrive here; the pin
        // below then echoes back with the exact item and clears this again.
        const exact = itemFor(findStepByQuery(steps, picker.value));
        userMoved = exact !== undefined && active[0] !== exact;
      }
    });

    // An exact step number wins over whatever the filter happens to rank
    // first ("10" must not land on "STEP 100").
    picker.onDidChangeValue((value) => {
      userMoved = false;
      const exact = itemFor(findStepByQuery(steps, value));
      if (exact) {
        picker.activeItems = [exact];
      }
    });

    picker.onDidAccept(() => {
      const query = picker.value.trim();
      const exact = findStepByQuery(steps, query);
      const selected = picker.selectedItems[0]?.step;
      // The exact match only beats the filter's ranking, never a step the
      // user highlighted (and saw previewed) themselves.
      const chosen = userMoved ? (selected ?? exact) : (exact ?? selected);
      let line = chosen ? chosen.line : -1;
      if (line === -1 && query !== "") {
        line = findStepLine(document.getText(), query);
      }
      if (line === -1) {
        if (query !== "") {
          vscode.window.showInformationMessage(`Step "${query}" not found.`);
        }
        picker.hide();
        return;
      }
      accepted = true;
      picker.hide();
      jump(line);
    });

    picker.onDidHide(() => {
      highlight.dispose();
      picker.dispose();
      if (!accepted) {
        editor.selections = originalSelections;
        if (originalView) {
          editor.revealRange(originalView, vscode.TextEditorRevealType.AtTop);
        }
      }
    });

    const here = itemFor(findStepAtLine(steps, editor.selection.active.line));
    picker.show();
    if (here) {
      picker.activeItems = [here];
    }
  });
}
