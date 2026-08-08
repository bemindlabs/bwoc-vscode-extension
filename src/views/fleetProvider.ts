import * as vscode from "vscode";

import { BwocCliError, type AgentSummary, type BwocClient } from "../bwoc";

/** A tree node is either an agent row or one detail line under an expanded
 *  agent. Detail lines are fetched lazily via `bwoc status` on expand. */
type FleetNode =
  | { kind: "agent"; agent: AgentSummary }
  | { kind: "detail"; label: string; value: string };

export class FleetProvider implements vscode.TreeDataProvider<FleetNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: BwocClient) {}

  /** Swap the backing client (e.g. after a settings change) and repaint. */
  setClient(client: BwocClient): void {
    this.client = client;
    this.refresh();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: FleetNode): vscode.TreeItem {
    if (node.kind === "detail") {
      const item = new vscode.TreeItem(
        `${node.label}: ${node.value}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.tooltip = node.value;
      return item;
    }
    const a = node.agent;
    const item = new vscode.TreeItem(
      a.id,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    // Show real liveness (pid probe via `bwoc list`), not the registry lifecycle
    // status: an unstarted agent is "active" in the registry but NOT running, and
    // labeling that "active" reads as online. "offline" is the honest word; the
    // registry status lives in the tooltip.
    item.description = `${a.running ? "running" : "offline"}${
      a.inboxCount > 0 ? ` · inbox ${a.inboxCount}` : ""
    }`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${a.id}** — ${a.running ? "🟢 running" : "⚪ offline (daemon not started)"}`,
        `- backend: \`${a.backend}\``,
        `- registry status: \`${a.status}\``,
        `- inbox: ${a.inboxCount}`,
        a.running ? "" : "- start it: **BWOC: Start Agent Daemon**",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    item.contextValue = "bwocAgent";
    item.iconPath = new vscode.ThemeIcon(
      a.running ? "circle-filled" : "circle-outline",
      a.running
        ? new vscode.ThemeColor("charts.green")
        : new vscode.ThemeColor("charts.gray"),
    );
    item.command = {
      command: "bwoc.openAgentDetail",
      title: "Show Agent Detail",
      arguments: [a.id],
    };
    return item;
  }

  async getChildren(node?: FleetNode): Promise<FleetNode[]> {
    if (!node) {
      try {
        const agents = await this.client.list();
        return agents.map((agent) => ({ kind: "agent" as const, agent }));
      } catch (err) {
        const msg = err instanceof BwocCliError ? err.message : String(err);
        vscode.window.showErrorMessage(`BWOC: ${msg}`);
        return [];
      }
    }
    if (node.kind === "agent") {
      try {
        const d = await this.client.status(node.agent.id);
        return [
          { kind: "detail", label: "health", value: d.health },
          { kind: "detail", label: "backend", value: d.backend },
          { kind: "detail", label: "model", value: d.primaryModel },
          { kind: "detail", label: "inbox", value: String(d.inboxCount) },
          {
            kind: "detail",
            label: "resources",
            value: `mem ${d.resources.memories} · mind ${d.resources.mindsets} · skill ${d.resources.skills}`,
          },
          { kind: "detail", label: "scope", value: d.scope },
        ];
      } catch (err) {
        const msg = err instanceof BwocCliError ? err.message : String(err);
        return [{ kind: "detail", label: "error", value: msg }];
      }
    }
    return [];
  }
}
