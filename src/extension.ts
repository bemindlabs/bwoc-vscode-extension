import * as vscode from "vscode";

import { BwocCliError, createClient } from "./bwoc";
import { registerChatParticipant } from "./chat/participant";
import { registerCommands } from "./commands";
import { InboxWatcher } from "./inbox";
import { registerMcpProvider } from "./mcp";
import { FleetStatusBar } from "./statusBar";
import { FleetProvider } from "./views/fleetProvider";

export function activate(context: vscode.ExtensionContext): void {
  let client = createClient(context);

  const fleet = new FleetProvider(client);
  const statusBar = new FleetStatusBar();
  const output = vscode.window.createOutputChannel("BWOC");

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("bwocFleet", fleet),
    statusBar,
    output,
  );

  // Command-palette verbs (send message, action hub). `() => client` reads the
  // live backend, which is rebuilt on a settings change.
  registerCommands(context, () => client, output);

  // Copilot integration: the `@bwoc` chat participant and the bwoc-mcp server
  // provider (both no-op gracefully on editors that lack the API).
  registerChatParticipant(context, () => client);
  registerMcpProvider(context);

  // Inbox notifications: poll the fleet and notify on new arrivals.
  const inbox = new InboxWatcher(() => client);
  context.subscriptions.push(inbox);
  const pollSeconds = () =>
    vscode.workspace.getConfiguration("bwoc").get<number>("inbox.pollSeconds", 60);
  inbox.start(pollSeconds());

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
        client = createClient(context);
        fleet.setClient(client);
        void statusBar.update(client);
        inbox.start(pollSeconds());
      }
    }),
  );

  void statusBar.update(client);
}

export function deactivate(): void {
  // Subscriptions are disposed by VS Code via context.subscriptions.
}
