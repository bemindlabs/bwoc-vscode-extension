import * as vscode from "vscode";

import { BwocCliError, type AgentDetail, type AgentSummary, type BwocClient } from "../bwoc";
import { BwocdError } from "../bwoc";

const PARTICIPANT_ID = "bwoc.fleet";

function errText(err: unknown): string {
  if (err instanceof BwocCliError || err instanceof BwocdError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── Pure response formatters (unit-tested) ──────────────────────────────────

export function formatAgentList(agents: AgentSummary[]): string {
  if (agents.length === 0) {
    return "No agents in this workspace.";
  }
  const rows = agents.map((a) => {
    const state = a.running ? "🟢 running" : `⚪ ${a.status}`;
    const inbox = a.inboxCount > 0 ? ` · inbox ${a.inboxCount}` : "";
    return `- **${a.id}** — ${state}${inbox} \`(${a.backend})\``;
  });
  return `**${agents.length} agent${agents.length === 1 ? "" : "s"}**\n\n${rows.join("\n")}`;
}

export function formatAgentStatus(d: AgentDetail): string {
  return [
    `**${d.id}** — ${d.running ? "🟢 running" : `⚪ ${d.status}`} · health \`${d.health}\``,
    "",
    `- backend: \`${d.backend}\``,
    `- model: \`${d.primaryModel}\``,
    `- inbox: ${d.inboxCount}`,
    `- resources: mem ${d.resources.memories} · mind ${d.resources.mindsets} · skill ${d.resources.skills}`,
    d.scope ? `- scope: ${d.scope}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Register the `@bwoc` chat participant so Copilot Chat can query the fleet. */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  getClient: () => BwocClient,
): void {
  const handler: vscode.ChatRequestHandler = async (request, _ctx, stream) => {
    const client = getClient();
    const prompt = request.prompt.trim();
    try {
      if (request.command === "status") {
        if (!prompt) {
          stream.markdown("Usage: `@bwoc /status <agent-id>`");
          return;
        }
        stream.markdown(formatAgentStatus(await client.status(prompt)));
        return;
      }
      if (request.command === "list" || /^(list|agents|fleet)\b/i.test(prompt)) {
        stream.markdown(formatAgentList(await client.list()));
        return;
      }
      // Default: a friendly capability hint. (Delegating the free-text prompt to
      // an agent chat turn is a later slice — kept out so `@bwoc` never silently
      // acts on an ambiguous request.)
      stream.markdown(
        "👋 Hi! I'm your **BWOC fleet** copilot. Quick things I can show you:\n\n" +
          "- `@bwoc /list` — see every agent and its status\n" +
          "- `@bwoc /status <agent-id>` — one agent's health & config\n\n" +
          "💡 In **agent mode** you can also just ask me in plain language — I now bring native " +
          "tools (`#bwocList`, `#bwocSendMessage`, `#bwocBroadcast`, `#bwocRunTask`, …) so Copilot " +
          "can read *and* drive the fleet for you. Anything that changes the fleet asks you to " +
          "confirm first.",
      );
    } catch (err) {
      stream.markdown(`⚠️ ${errText(err)}`);
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon("rocket");
  context.subscriptions.push(participant);
}
