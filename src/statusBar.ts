import * as vscode from "vscode";

import type { BwocClient } from "./bwoc";

/** A left-aligned status-bar item showing "BWOC N running / M total". Clicking
 *  it refreshes the fleet. */
export class FleetStatusBar {
  private readonly item: vscode.StatusBarItem;
  /** Active-host label ("Local CLI" or a host name/url), appended to tooltips so
   *  the operator can see which fleet the count refers to. */
  private host = "Local CLI";

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = "bwoc.refreshFleet";
    this.item.show();
    this.setLoading();
  }

  /** Record the active fleet host so subsequent tooltips name it. */
  setHost(label: string): void {
    this.host = label;
  }

  private setLoading(): void {
    this.item.text = "$(sync~spin) BWOC";
    this.item.tooltip = `Loading BWOC fleet (${this.host})…`;
  }

  async update(client: BwocClient): Promise<void> {
    this.setLoading();
    try {
      const agents = await client.list();
      const running = agents.filter((a) => a.running).length;
      this.item.text = `$(pulse) BWOC ${running}/${agents.length}`;
      this.item.tooltip = `${running} running of ${agents.length} agents on ${this.host} — click to refresh`;
    } catch {
      this.item.text = "$(warning) BWOC";
      this.item.tooltip = `BWOC fleet unavailable (${this.host}) — check bwoc.binaryPath / remote host`;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
