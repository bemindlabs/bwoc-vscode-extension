import * as vscode from "vscode";

import type { AgentSummary, BwocClient } from "./bwoc";

export interface InboxChange {
  id: string;
  /** Current pending count. */
  count: number;
  /** How many arrived since the last snapshot. */
  delta: number;
}

/** Agents whose pending inbox count ROSE since the previous snapshot. New
 *  agents (not in `prev`) are not reported — only genuine new arrivals for an
 *  already-seen agent, so priming the snapshot never spams. Pure + tested. */
export function diffInbox(prev: Map<string, number>, curr: AgentSummary[]): InboxChange[] {
  const out: InboxChange[] = [];
  for (const a of curr) {
    const before = prev.get(a.id);
    if (before !== undefined && a.inboxCount > before) {
      out.push({ id: a.id, count: a.inboxCount, delta: a.inboxCount - before });
    }
  }
  return out;
}

/** Polls the fleet and raises a VS Code notification when an agent gains inbox
 *  messages. Off when `pollSeconds <= 0`. Fail-quiet: a failed poll (bad
 *  workspace, CLI missing) is skipped, not surfaced — the Fleet view already
 *  reports those. */
export class InboxWatcher {
  private timer?: ReturnType<typeof setInterval>;
  private snapshot = new Map<string, number>();

  constructor(private readonly getClient: () => BwocClient) {}

  start(pollSeconds: number): void {
    this.stop();
    if (pollSeconds <= 0) {
      return;
    }
    void this.tick(true); // prime without notifying
    this.timer = setInterval(() => void this.tick(false), pollSeconds * 1000);
  }

  private async tick(prime: boolean): Promise<void> {
    let agents: AgentSummary[];
    try {
      agents = await this.getClient().list();
    } catch {
      return;
    }
    if (!prime) {
      for (const c of diffInbox(this.snapshot, agents)) {
        void vscode.window.showInformationMessage(
          `BWOC: ${c.id} has ${c.delta} new inbox message${c.delta === 1 ? "" : "s"} (${c.count} pending).`,
        );
      }
    }
    this.snapshot = new Map(agents.map((a) => [a.id, a.inboxCount]));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}
