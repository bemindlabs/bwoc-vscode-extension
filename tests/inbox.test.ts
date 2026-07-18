import { describe, expect, it } from "vitest";

import type { AgentSummary } from "../src/bwoc/types";
import { diffInbox } from "../src/inbox";

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
