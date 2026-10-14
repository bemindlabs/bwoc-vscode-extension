import { describe, expect, it } from "vitest";

import { agentDirIn } from "../src/paths";

describe("agentDirIn", () => {
  it("resolves a workspace-relative agent path", () => {
    expect(agentDirIn("/ws", "agents/agent-a")).toBe("/ws/agents/agent-a");
  });

  it("rejects empty, absolute and escaping paths", () => {
    expect(agentDirIn("/ws", "")).toBeUndefined();
    expect(agentDirIn("/ws", ".")).toBeUndefined();
    expect(agentDirIn("/ws", "/etc")).toBeUndefined();
    expect(agentDirIn("/ws", "../other")).toBeUndefined();
    expect(agentDirIn("/ws", "agents/../../x")).toBeUndefined();
    expect(agentDirIn("", "agents/a")).toBeUndefined();
  });

  it("allows names that merely start with dots", () => {
    expect(agentDirIn("/ws", "..agents/a")).toBe("/ws/..agents/a");
  });
});
