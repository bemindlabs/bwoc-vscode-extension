import * as vscode from "vscode";

import { BwocCliError, BwocdError, type BwocClient, type Task, type Team } from "../bwoc";

/** A node is either a team (top level) or one of its tasks (lazily fetched).
 *  Task nodes carry their parent `team` so task actions (claim/complete) have
 *  both the team and the task id. */
export type TeamNode =
  | { kind: "team"; team: Team }
  | { kind: "task"; team: string; task: Task };

/** Tree of Saṅgha teams → their shared task lists (`bwoc team/task list`). */
export class TeamsProvider implements vscode.TreeDataProvider<TeamNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: BwocClient) {}

  setClient(client: BwocClient): void {
    this.client = client;
    this.refresh();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: TeamNode): vscode.TreeItem {
    if (node.kind === "team") {
      const item = new vscode.TreeItem(
        node.team.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${node.team.members.length} member${node.team.members.length === 1 ? "" : "s"}`;
      item.tooltip = node.team.members.join(", ");
      item.iconPath = new vscode.ThemeIcon("organization");
      item.contextValue = "bwocTeam";
      return item;
    }
    const t = node.task;
    const icon =
      t.state === "done"
        ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"))
        : t.state === "claimed"
          ? new vscode.ThemeIcon("sync", new vscode.ThemeColor("charts.yellow"))
          : new vscode.ThemeIcon("circle-outline");
    const firstLine = t.plan.split("\n")[0]?.slice(0, 80) || "(no description)";
    const item = new vscode.TreeItem(`${t.id}  ${firstLine}`, vscode.TreeItemCollapsibleState.None);
    item.description = t.state === "claimed" && t.claimedBy ? `claimed · ${t.claimedBy}` : t.state;
    item.tooltip = t.plan;
    item.iconPath = icon;
    // State-suffixed so the context menu shows claim on open tasks and complete
    // on claimed ones (see package.json view/item/context `when` clauses).
    item.contextValue =
      t.state === "open" ? "bwocTaskOpen" : t.state === "claimed" ? "bwocTaskClaimed" : "bwocTaskDone";
    return item;
  }

  async getChildren(node?: TeamNode): Promise<TeamNode[]> {
    try {
      if (!node) {
        return (await this.client.teams()).map((team) => ({ kind: "team" as const, team }));
      }
      if (node.kind === "team") {
        return (await this.client.tasks(node.team.name)).map((task) => ({
          kind: "task" as const,
          team: node.team.name,
          task,
        }));
      }
      return [];
    } catch (err) {
      // bwocd now proxies `team list` / `task list` via /cli, so surface real
      // failures instead of a silent empty tree — consistent with the Fleet view.
      const msg =
        err instanceof BwocCliError || err instanceof BwocdError
          ? err.message
          : String(err);
      vscode.window.showErrorMessage(`BWOC: ${msg}`);
      return [];
    }
  }
}
