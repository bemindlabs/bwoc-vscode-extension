import * as vscode from "vscode";

import { BwocCliError, createClient } from "./bwoc";
import { FleetStatusBar } from "./statusBar";
import { FleetProvider } from "./views/fleetProvider";

export function activate(context: vscode.ExtensionContext): void {
  let client = createClient();

  const fleet = new FleetProvider(client);
  const statusBar = new FleetStatusBar();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("bwocFleet", fleet),
    statusBar,
  );

  const refresh = () => {
    fleet.refresh();
    void statusBar.update(client);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("bwoc.refreshFleet", refresh),
    vscode.commands.registerCommand(
      "bwoc.openAgentDetail",
      async (agentId?: string) => {
        if (!agentId) {
          return;
        }
        try {
          const d = await client.status(agentId);
          const doc = await vscode.workspace.openTextDocument({
            language: "json",
            content: JSON.stringify(d, null, 2),
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err) {
          const msg = err instanceof BwocCliError ? err.message : String(err);
          vscode.window.showErrorMessage(`BWOC: ${msg}`);
        }
      },
    ),
    // Rebuild the client when relevant settings change.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("bwoc")) {
        client = createClient();
        fleet.setClient(client);
        void statusBar.update(client);
      }
    }),
  );

  void statusBar.update(client);
}

export function deactivate(): void {
  // Subscriptions are disposed by VS Code via context.subscriptions.
}
