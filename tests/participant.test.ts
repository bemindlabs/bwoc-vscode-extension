import { describe, expect, it } from "vitest";

import type { AgentDetail, AgentSummary } from "../src/bwoc/types";
import { formatAgentList, formatAgentStatus } from "../src/chat/participant";
import { mcpServerArgs } from "../src/mcp";

const agent = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  id: "agent-anna",
  backend: "claude",
  status: "active",
  running: true,
  inboxCount: 0,
  incarnated: "",
  path: "agents/agent-anna",
  ...over,
});

describe("formatAgentList", () => {
  it("reports an empty fleet", () => {
    expect(formatAgentList([])).toBe("No agents in this workspace.");
  });
  it("renders a bulleted list with state, inbox, and backend", () => {
    const md = formatAgentList([
      agent(),
      agent({ id: "agent-luban", running: false, status: "active", inboxCount: 3 }),
    ]);
    expect(md).toContain("**2 agents**");
    expect(md).toContain("**agent-anna** — 🟢 running");
    expect(md).toContain("**agent-luban** — ⚪ offline · inbox 3");
    expect(md).toContain("`(claude)`");
  });
});

describe("formatAgentStatus", () => {
  it("renders health, model, inbox, and resources", () => {
    const d: AgentDetail = {
      ...agent(),
      health: "ok",
      healthDetail: null,
      primaryModel: "claude-opus-4-8",
      scope: "Mac admin",
      outOfScope: "",
      resources: { memories: 23, mindsets: 0, skills: 1 },
    };
    const md = formatAgentStatus(d);
    expect(md).toContain("**agent-anna** — 🟢 running · health `ok`");
    expect(md).toContain("model: `claude-opus-4-8`");
    expect(md).toContain("mem 23 · mind 0 · skill 1");
    expect(md).toContain("scope: Mac admin");
  });
});

describe("mcpServerArgs", () => {
  it("binds --workspace when a root is known, else passes nothing", () => {
    expect(mcpServerArgs("/ws")).toEqual(["--workspace", "/ws"]);
    expect(mcpServerArgs("")).toEqual([]);
  });
});
