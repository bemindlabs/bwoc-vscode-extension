import * as vscode from "vscode";

import { activeWorkspaceRoot } from "./bwoc";

/** CLI args for the bwoc-mcp server: bind it to the active workspace when known. */
export function mcpServerArgs(workspaceRoot: string): string[] {
  return workspaceRoot ? ["--workspace", workspaceRoot] : [];
}

/**
 * Register a provider that exposes the `bwoc-mcp` server to Copilot agent-mode,
 * so the whole BWOC workspace becomes callable as MCP tools. The server command
 * is configurable (`bwoc.mcp.command`, default `bwoc-mcp`); if it isn't
 * installed the editor simply lists it as unavailable — installing bwoc-mcp is
 * an operator step. No-ops on editors without the MCP provider API.
 */
export function registerMcpProvider(context: vscode.ExtensionContext): void {
  const lm = vscode.lm as typeof vscode.lm & {
    registerMcpServerDefinitionProvider?: typeof vscode.lm.registerMcpServerDefinitionProvider;
  };
  if (typeof lm.registerMcpServerDefinitionProvider !== "function") {
    return;
  }

  const provider: vscode.McpServerDefinitionProvider = {
    provideMcpServerDefinitions: () => {
      const cfg = vscode.workspace.getConfiguration("bwoc");
      const command = cfg.get<string>("mcp.command", "bwoc-mcp") || "bwoc-mcp";
      const root = activeWorkspaceRoot();
      const def = new vscode.McpStdioServerDefinition(
        "bwoc-mcp",
        command,
        mcpServerArgs(root),
      );
      if (root) {
        def.cwd = vscode.Uri.file(root);
      }
      return [def];
    },
  };

  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider("bwoc.mcp", provider),
  );
}
