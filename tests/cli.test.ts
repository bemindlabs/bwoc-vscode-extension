import { describe, expect, it } from "vitest";

import { parseList, parseStatus } from "../src/bwoc/cli";

describe("parseList", () => {
  it("maps snake_case rows to AgentSummary", () => {
    const out = JSON.stringify({
      agents: [
        {
          backend: "claude",
          id: "agent-anna",
          inbox_count: 3,
          incarnated: "2026-06-10T03:27:19Z",
          path: "agents/agent-anna",
          running: true,
          status: "active",
          uptime_seconds: null,
        },
      ],
    });
    const rows = parseList(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "agent-anna",
      backend: "claude",
      inboxCount: 3,
      running: true,
      status: "active",
    });
  });

  it("tolerates an empty fleet", () => {
    expect(parseList(JSON.stringify({ agents: [] }))).toEqual([]);
    expect(parseList(JSON.stringify({}))).toEqual([]);
  });
});

describe("parseStatus", () => {
  it("maps the first agent to AgentDetail", () => {
    const out = JSON.stringify({
      agents: [
        {
          backend: "claude",
          health: "ok",
          health_detail: null,
          id: "agent-anna",
          incarnated: "2026-06-10T03:27:19Z",
          out_of_scope: "not a release owner",
          path: "agents/agent-anna",
          primary_model: "claude-opus-4-8",
          resources: { memories: 23, mindsets: 0, skills: 0 },
          running: true,
          scope: "Mac admin",
          status: "active",
          inbox_count: 0,
        },
      ],
    });
    const d = parseStatus(out);
    expect(d.id).toBe("agent-anna");
    expect(d.health).toBe("ok");
    expect(d.primaryModel).toBe("claude-opus-4-8");
    expect(d.resources.memories).toBe(23);
  });

  it("throws on an empty agents array", () => {
    expect(() => parseStatus(JSON.stringify({ agents: [] }))).toThrow();
  });
});

describe("parseRunResult", () => {
  it("maps the bwoc run --json envelope", async () => {
    const { parseRunResult } = await import("../src/bwoc/cli");
    const out = JSON.stringify({
      agent: "agent-anna",
      backend: "claude",
      task: "do x",
      exit_code: 0,
      duration_ms: 1234,
      output: "done",
    });
    expect(parseRunResult(out)).toEqual({
      agent: "agent-anna",
      exitCode: 0,
      durationMs: 1234,
      output: "done",
    });
  });
});
