import { describe, expect, it } from "vitest";

import type {
  AgentSummary,
  BwocClient,
  CheckReport,
  DoctorReport,
  InboxMessage,
  MemoryEntry,
  Task,
  Team,
} from "../src/bwoc/types";
import {
  TOOL_SPECS,
  formatCheck,
  formatDoctor,
  formatInbox,
  formatMemoryList,
  formatRun,
  formatTasks,
  formatTeams,
} from "../src/tools";

function spec(name: string) {
  const s = TOOL_SPECS.find((t) => t.name === name);
  if (!s) throw new Error(`no spec ${name}`);
  return s;
}

/** Minimal client — tests set only the methods the exercised spec calls. */
function fakeClient(over: Partial<BwocClient>): BwocClient {
  return over as BwocClient;
}

// ── Formatters ───────────────────────────────────────────────────────────────

describe("formatters", () => {
  it("formatTeams — empty and populated", () => {
    expect(formatTeams([])).toBe("No teams in this workspace.");
    const teams: Team[] = [{ name: "tianting", members: ["agent-a", "agent-b"], createdAt: "" }];
    expect(formatTeams(teams)).toContain("**tianting** — 2 member(s): agent-a, agent-b");
  });

  it("formatTasks — marks state and claimer", () => {
    const tasks: Task[] = [
      { id: "t1", plan: "do a thing", claimedBy: null, completedAt: null, createdAt: "", state: "open" },
      { id: "t2", plan: "done thing", claimedBy: "agent-a", completedAt: "", createdAt: "", state: "done" },
    ];
    const md = formatTasks("sq", tasks);
    expect(md).toContain("**sq** — 2 task(s)");
    expect(md).toContain("⬜ `t1` do a thing");
    expect(md).toContain("✅ `t2` done thing _(claimed by agent-a)_");
    expect(formatTasks("sq", [])).toBe("Team **sq** has no tasks.");
  });

  it("formatMemoryList / formatInbox — empty and populated", () => {
    expect(formatMemoryList([])).toBe("No workspace memory entries.");
    const mem: MemoryEntry[] = [{ name: "prefs", sizeBytes: 12, path: "/ws/.bwoc/memory/prefs" }];
    expect(formatMemoryList(mem)).toContain("**prefs** `12B`");

    expect(formatInbox("agent-x", [])).toBe("**agent-x** inbox is empty.");
    const inbox: InboxMessage[] = [{ from: "agent-y", message: "hi", subject: "greet", type: null }];
    expect(formatInbox("agent-x", inbox)).toContain("from **agent-y** — _greet_: hi");
  });

  it("formatDoctor / formatCheck — icons and violations", () => {
    const doc: DoctorReport = {
      exit: 0,
      results: [
        { name: "binary", status: "ok", detail: null },
        { name: "workspace", status: "fail", detail: "missing" },
      ],
    };
    const dm = formatDoctor(doc);
    expect(dm).toContain("✅ **binary** — ok");
    expect(dm).toContain("❌ **workspace** — fail (missing)");

    const clean: CheckReport = { passes: ["a", "b"], violations: [] };
    expect(formatCheck("agent-x", clean)).toContain("✅ **agent-x** — backend-neutral (2 check(s) passed)");
    const bad: CheckReport = { passes: [], violations: ["hardcoded model id"] };
    expect(formatCheck("agent-x", bad)).toContain("❌ **agent-x** — 1 violation(s)");
    expect(formatCheck("agent-x", bad)).toContain("- hardcoded model id");
  });

  it("formatRun — header + output", () => {
    const md = formatRun({ agent: "agent-x", exitCode: 0, durationMs: 42, output: "hello\n" });
    expect(md).toContain("**agent-x** — exit 0 · 42ms");
    expect(md).toContain("hello");
    expect(formatRun({ agent: "agent-x", exitCode: 0, durationMs: 1, output: "  " })).toContain("_(no output)_");
  });
});

// ── Read specs: run wires to the client ──────────────────────────────────────

describe("read tool specs", () => {
  it("bwoc_list runs list() and formats", async () => {
    const agents: AgentSummary[] = [
      { id: "agent-a", backend: "claude", status: "active", running: true, inboxCount: 0, incarnated: "", path: "agents/agent-a" },
    ];
    const out = await spec("bwoc_list").run(fakeClient({ list: async () => agents }), {});
    expect(out).toContain("**1 agent**");
    expect(out).toContain("agent-a");
  });

  it("bwoc_teamTasks passes the team through", async () => {
    let asked = "";
    const out = await spec("bwoc_teamTasks").run(
      fakeClient({
        tasks: async (team: string) => {
          asked = team;
          return [];
        },
      }),
      { team: "sq" },
    );
    expect(asked).toBe("sq");
    expect(out).toBe("Team **sq** has no tasks.");
  });

  it("read specs carry no confirmation", () => {
    for (const name of ["bwoc_list", "bwoc_agentStatus", "bwoc_teams", "bwoc_doctor", "bwoc_memoryList"]) {
      expect(spec(name).confirm).toBeUndefined();
    }
  });
});

// ── Write specs: gated by confirmation ───────────────────────────────────────

describe("write tool specs are confirmed", () => {
  const writeNames = [
    "bwoc_sendMessage",
    "bwoc_broadcast",
    "bwoc_runTask",
    "bwoc_taskAdd",
    "bwoc_taskClaim",
    "bwoc_taskComplete",
    "bwoc_startAgent",
    "bwoc_stopAgent",
    "bwoc_outboxFlush",
    "bwoc_newAgent",
    "bwoc_retireAgent",
  ];

  it("every write/control spec has a confirm()", () => {
    for (const name of writeNames) {
      expect(spec(name).confirm, name).toBeTypeOf("function");
    }
  });

  it("sendMessage confirmation names the recipient", () => {
    const c = spec("bwoc_sendMessage").confirm!({ to: "agent-x", message: "hi" });
    expect(c.title).toBe("Send message");
    expect(c.message).toContain("agent-x");
  });

  it("broadcast confirmation distinguishes all vs team", () => {
    const all = spec("bwoc_broadcast").confirm!({ message: "hi" });
    expect(all.message).toContain("every agent");
    const team = spec("bwoc_broadcast").confirm!({ message: "hi", team: "tianting" });
    expect(team.message).toContain("tianting");
  });

  it("retire confirmation warns it is irreversible", () => {
    const c = spec("bwoc_retireAgent").confirm!({ agentId: "agent-x" });
    expect(c.message).toMatch(/cannot be undone/i);
    expect(c.message).toContain("agent-x");
  });

  it("sendMessage run wires to client.send", async () => {
    let got: [string, string] | null = null;
    const out = await spec("bwoc_sendMessage").run(
      fakeClient({
        send: async (to: string, message: string) => {
          got = [to, message];
          return "sent to agent-x";
        },
      }),
      { to: "agent-x", message: "hi" },
    );
    expect(got).toEqual(["agent-x", "hi"]);
    expect(out).toBe("sent to agent-x");
  });

  it("broadcast run passes team through (undefined → all)", async () => {
    const calls: Array<string | undefined> = [];
    const s = spec("bwoc_broadcast");
    await s.run(
      fakeClient({ broadcast: async (_m: string, team?: string) => { calls.push(team); return "ok"; } }),
      { message: "hi" },
    );
    await s.run(
      fakeClient({ broadcast: async (_m: string, team?: string) => { calls.push(team); return "ok"; } }),
      { message: "hi", team: "tianting" },
    );
    expect(calls).toEqual([undefined, "tianting"]);
  });
});
