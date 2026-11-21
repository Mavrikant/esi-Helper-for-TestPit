import * as vscode from "vscode";
import { buildOutline, OutlineKind, OutlineNode } from "../lib/esiOutline";

function symbolKind(kind: OutlineKind): vscode.SymbolKind {
  switch (kind) {
    case "testSteps":
      return vscode.SymbolKind.Module;
    case "step":
      return vscode.SymbolKind.Function;
    case "stepIO":
      return vscode.SymbolKind.Interface;
    case "definition":
      return vscode.SymbolKind.String;
    case "variables":
      return vscode.SymbolKind.Variable;
    case "include":
      return vscode.SymbolKind.File;
    case "component":
      return vscode.SymbolKind.Struct;
    default:
      return vscode.SymbolKind.Namespace;
  }
}

function toSymbol(node: OutlineNode): vscode.DocumentSymbol {
  const symbol = new vscode.DocumentSymbol(
    node.name,
    node.detail,
    symbolKind(node.kind),
    new vscode.Range(node.startLine, 0, node.endLine, node.endCol),
    new vscode.Range(
      node.selectionLine,
      node.selectionStartCol,
      node.selectionLine,
      node.selectionEndCol
    )
  );
  symbol.children = node.children.map(toSymbol);
  return symbol;
}

/** Outline view / breadcrumbs / Ctrl+Shift+O for `.esi`, from the section tags. */
export function registerEsiDocumentSymbolProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentSymbolProvider("esi", {
    provideDocumentSymbols(document) {
      return buildOutline(document.getText()).map(toSymbol);
    },
  });
}
