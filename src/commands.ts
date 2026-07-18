import * as path from "node:path";

import * as vscode from "vscode";

import { activeWorkspaceRoot, BwocCliError, type BwocClient } from "./bwoc";
import { BwocdError } from "./bwoc";
import { ChatPanel } from "./chat/panel";
import { buildChatSpawn, ChatSession } from "./chat/session";

/** Message shown for any backend failure, unwrapped to its clean text. */
function errText(err: unknown): string {
  if (err instanceof BwocCliError || err instanceof BwocdError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Pick an agent id from the live fleet via a QuickPick. Returns undefined if
 *  the user dismisses it or the fleet can't be read. */
async function pickAgent(client: BwocClient, placeHolder: string): Promise<string | undefined> {
  let agents;
  try {
    agents = await client.list();
  } catch (err) {
    vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    return undefined;
  }
  if (agents.length === 0) {
    vscode.window.showInformationMessage("BWOC: no agents in this workspace.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.id,
      description: `${a.running ? "running" : a.status}${a.inboxCount > 0 ? ` · inbox ${a.inboxCount}` : ""}`,
    })),
    { placeHolder, matchOnDescription: true },
  );
  return pick?.label;
}

/**
 * Register the command-palette actions. `getClient` returns the *current*
 * backend (it is rebuilt when settings change), so commands always run against
 * the active client. `output` is a shared channel for verb results.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  getClient: () => BwocClient,
  output: vscode.OutputChannel,
): void {
  const sendMessage = async (preselected?: string) => {
    const client = getClient();
    const to = preselected ?? (await pickAgent(client, "Send a message to which agent?"));
    if (!to) {
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: `Message to ${to}`,
      placeHolder: "Type the message to append to the agent's inbox…",
      validateInput: (v) => (v.trim().length === 0 ? "Message cannot be empty" : undefined),
    });
    if (message === undefined || message.trim().length === 0) {
      return;
    }
    try {
      const confirmation = await client.send(to, message);
      output.appendLine(`[send → ${to}] ${confirmation}`);
      vscode.window.showInformationMessage(`BWOC: sent to ${to}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const openChat = async (preselected?: string) => {
    // Chat drives a local `bwoc-harness --chat` subprocess in the agent's dir,
    // so it needs a local workspace — not a remote bwocd host.
    const cfg = vscode.workspace.getConfiguration("bwoc");
    if ((cfg.get<string>("remote.url", "") || "").trim()) {
      vscode.window.showInformationMessage(
        "BWOC: chat runs against a local workspace; it isn't wired for a remote bwoc.remote.url host yet.",
      );
      return;
    }
    const client = getClient();
    const to = preselected ?? (await pickAgent(client, "Open a chat with which agent?"));
    if (!to) {
      return;
    }
    let detail;
    try {
      detail = await client.status(to);
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
      return;
    }
    const wsRoot = activeWorkspaceRoot();
    if (!wsRoot) {
      vscode.window.showErrorMessage("BWOC: no workspace root — open a folder containing .bwoc/.");
      return;
    }
    const spawnSpec = buildChatSpawn({
      bwocBinaryPath: cfg.get<string>("binaryPath", "bwoc") || "bwoc",
      agentDir: path.join(wsRoot, detail.path),
      backend: detail.backend,
      model: detail.primaryModel || "auto",
    });
    new ChatPanel(to, new ChatSession(spawnSpec)).reveal();
  };

  const commandPalette = async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(comment-discussion) Chat with an agent", cmd: "bwoc.openChat" },
        { label: "$(comment) Send message to an agent", cmd: "bwoc.sendMessage" },
        { label: "$(refresh) Refresh fleet", cmd: "bwoc.refreshFleet" },
      ],
      { placeHolder: "BWOC — pick an action" },
    );
    if (pick) {
      await vscode.commands.executeCommand(pick.cmd);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("bwoc.sendMessage", sendMessage),
    vscode.commands.registerCommand("bwoc.openChat", openChat),
    vscode.commands.registerCommand("bwoc.commandPalette", commandPalette),
  );
}
