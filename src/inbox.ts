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
  /** Guards against overlapping ticks — a poll slower than pollSeconds (e.g. a
   *  hung bwocd) must not stack ticks that race the snapshot write. */
  private inFlight = false;

  constructor(
    private readonly getClient: () => BwocClient,
    private readonly output?: vscode.OutputChannel,
  ) {}

  start(pollSeconds: number): void {
    this.stop();
    if (pollSeconds <= 0) {
      return;
    }
    void this.tick(true); // prime without notifying
    this.timer = setInterval(() => void this.tick(false), pollSeconds * 1000);
  }

  private async tick(prime: boolean): Promise<void> {
    if (this.inFlight) {
      return; // a previous tick is still running — skip this one, don't stack.
    }
    this.inFlight = true;
    try {
      let agents: AgentSummary[];
      try {
        agents = await this.getClient().list();
      } catch (e) {
        // Fail-quiet in the UI (the Fleet view already reports outages), but log
        // so a persistently-failing poll is diagnosable instead of vanishing.
        this.output?.appendLine(`[inbox] poll failed: ${(e as Error).message}`);
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
    } finally {
      this.inFlight = false;
    }
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
