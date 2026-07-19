import { describe, expect, it } from "vitest";

import { parseTasks, parseTeams } from "../src/bwoc/cli";

describe("parseTeams", () => {
  it("maps the team-list array", () => {
    const out = JSON.stringify([
      { team: "tianting", members: ["agent-yudi", "agent-luban"], created_at: "2026-05-25T06:44:01Z" },
    ]);
    expect(parseTeams(out)).toEqual([
      { name: "tianting", members: ["agent-yudi", "agent-luban"], createdAt: "2026-05-25T06:44:01Z" },
    ]);
  });
  it("tolerates an empty list and missing fields", () => {
    expect(parseTeams("[]")).toEqual([]);
    expect(parseTeams(JSON.stringify([{ team: "x" }]))).toEqual([
      { name: "x", members: [], createdAt: "" },
    ]);
  });
});

describe("parseTasks", () => {
  it("derives state: done / claimed / open", () => {
    const out = JSON.stringify([
      { id: "t1", plan: "done one", claimed_by: "agent-luban", completed_at: "2026-06-08T05:01:58Z", created_at: "x" },
      { id: "t2", plan: "in progress", claimed_by: "agent-yudi", completed_at: null, created_at: "x" },
      { id: "t3", plan: "open one", claimed_by: null, completed_at: null, created_at: "x" },
    ]);
    const tasks = parseTasks(out);
    expect(tasks.map((t) => t.state)).toEqual(["done", "claimed", "open"]);
    expect(tasks[1]).toMatchObject({ id: "t2", claimedBy: "agent-yudi", state: "claimed" });
    expect(tasks[2]).toMatchObject({ id: "t3", claimedBy: null, state: "open" });
  });
});

describe("parseMemories", () => {
  it("maps the memory-list entries array", async () => {
    const { parseMemories } = await import("../src/bwoc/cli");
    const out = JSON.stringify({
      workspace_memory_dir: "/ws/.bwoc/memory",
      count: 2,
      total_bytes: 300,
      entries: [
        { name: "readme-style.md", size_bytes: 100 },
        { name: "bwoc-party.md", size_bytes: 200 },
      ],
    });
    expect(parseMemories(out)).toEqual([
      { name: "readme-style.md", sizeBytes: 100 },
      { name: "bwoc-party.md", sizeBytes: 200 },
    ]);
  });
  it("tolerates empty/missing entries", async () => {
    const { parseMemories } = await import("../src/bwoc/cli");
    expect(parseMemories(JSON.stringify({ count: 0, entries: [] }))).toEqual([]);
    expect(parseMemories(JSON.stringify({ entries: [{ name: "x" }] }))).toEqual([
      { name: "x", sizeBytes: 0 },
    ]);
  });
});
