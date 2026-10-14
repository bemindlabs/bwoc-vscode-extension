import { describe, expect, it, vi } from "vitest";

import type { AgentSummary, BwocClient } from "../src/bwoc/types";
import { diffInbox, InboxWatcher } from "../src/inbox";

const agent = (id: string, inboxCount: number): AgentSummary => ({
  id,
  backend: "claude",
  status: "active",
  running: false,
  inboxCount,
  incarnated: "",
  path: `agents/${id}`,
});

describe("diffInbox", () => {
  it("reports only agents whose count rose", () => {
    const prev = new Map([
      ["a", 1],
      ["b", 3],
      ["c", 0],
    ]);
    const changes = diffInbox(prev, [agent("a", 4), agent("b", 3), agent("c", 2)]);
    expect(changes).toEqual([
      { id: "a", count: 4, delta: 3 },
      { id: "c", count: 2, delta: 2 },
    ]);
  });

  it("ignores unseen agents (priming never spams)", () => {
    expect(diffInbox(new Map(), [agent("new", 5)])).toEqual([]);
  });

  it("ignores unchanged or decreased counts", () => {
    const prev = new Map([
      ["a", 5],
      ["b", 5],
    ]);
    expect(diffInbox(prev, [agent("a", 5), agent("b", 2)])).toEqual([]);
  });
});

describe("InboxWatcher restart", () => {
  it("drops the previous snapshot on start(), so a failed priming tick can't diff against stale counts", async () => {
    const client = { list: vi.fn(async () => [agent("a", 3)]) } as unknown as BwocClient;
    const watcher = new InboxWatcher(() => client);
    const priv = watcher as unknown as { tick: (p: boolean) => Promise<void>; snapshot: Map<string, number> };
    await priv.tick.call(watcher, true);
    expect(priv.snapshot.get("a")).toBe(3);
    watcher.start(0); // restart (here: disabled) — must reset the baseline
    expect(priv.snapshot.size).toBe(0);
  });
});

describe("InboxWatcher in-flight guard (B6)", () => {
  it("skips a tick while a previous poll is still running", async () => {
    // A poll slower than pollSeconds must not stack overlapping ticks.
    let resolveList!: (a: AgentSummary[]) => void;
    const list = vi.fn(
      () => new Promise<AgentSummary[]>((r) => (resolveList = r)),
    );
    const client = { list, status: vi.fn(), send: vi.fn() } as unknown as BwocClient;
    const watcher = new InboxWatcher(() => client);

    // Reach the private tick directly to drive overlap deterministically.
    const tick = (watcher as unknown as { tick: (p: boolean) => Promise<void> }).tick.bind(
      watcher,
    );

    const first = tick(true); // starts, awaits list — inFlight is now true
    await tick(true); // overlapping tick — must early-return without polling
    expect(list).toHaveBeenCalledTimes(1);

    resolveList([]);
    await first;

    // Once the first poll finished, a later tick is free to poll again.
    resolveList = () => {};
    void tick(true);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
