import * as vscode from "vscode";

import {
  BwocCliError,
  BwocdBackend,
  BwocdError,
  type BwocClient,
  type CheckReport,
  type DoctorReport,
  type InboxMessage,
  type MemoryEntry,
  type RunResult,
  type Task,
  type Team,
} from "./bwoc";
import { formatAgentList, formatAgentStatus } from "./chat/participant";

// ── Language Model Tools ─────────────────────────────────────────────────────
//
// Native VS Code LM tools wrapping the `BwocClient`, so Copilot agent-mode (and
// `#bwoc_*` references in chat) can operate the fleet directly — no separate
// `bwoc-mcp` server required. Read tools auto-invoke; write/control tools carry
// a `confirm` so the editor gates them behind an explicit user confirmation.
//
// Each spec's `run` and `confirm` are pure over the client + validated input
// (VS Code validates against the package.json `inputSchema` before `invoke`),
// so they unit-test without stubbing the LM API. The `register*` glue that wraps
// them into `vscode.lm.registerTool` is the only vscode-coupled part.

function errText(err: unknown): string {
  if (err instanceof BwocCliError || err instanceof BwocdError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── Pure result formatters (unit-tested) ─────────────────────────────────────

export function formatTeams(teams: Team[]): string {
  if (teams.length === 0) {
    return "No teams in this workspace.";
  }
  return teams
    .map((t) => `- **${t.name}** — ${t.members.length} member(s): ${t.members.join(", ")}`)
    .join("\n");
}

export function formatTasks(team: string, tasks: Task[]): string {
  if (tasks.length === 0) {
    return `Team **${team}** has no tasks.`;
  }
  const mark = (s: Task["state"]) =>
    s === "done" ? "✅" : s === "claimed" ? "🔸" : "⬜";
  const rows = tasks.map((t) => {
    const who = t.claimedBy ? ` _(claimed by ${t.claimedBy})_` : "";
    return `- ${mark(t.state)} \`${t.id}\` ${t.plan}${who}`;
  });
  return `**${team}** — ${tasks.length} task(s)\n\n${rows.join("\n")}`;
}

export function formatMemoryList(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "No workspace memory entries.";
  }
  return entries.map((m) => `- **${m.name}** \`${m.sizeBytes}B\``).join("\n");
}

export function formatInbox(agentId: string, messages: InboxMessage[]): string {
  if (messages.length === 0) {
    return `**${agentId}** inbox is empty.`;
  }
  const rows = messages.map((m) => {
    const subj = m.subject ? ` — _${m.subject}_` : "";
    return `- from **${m.from}**${subj}: ${m.message}`;
  });
  return `**${agentId}** — ${messages.length} message(s)\n\n${rows.join("\n")}`;
}

export function formatDoctor(r: DoctorReport): string {
  const rows = r.results.map((c) => {
    const icon = /ok|pass/i.test(c.status) ? "✅" : /warn/i.test(c.status) ? "⚠️" : "❌";
    return `- ${icon} **${c.name}** — ${c.status}${c.detail ? ` (${c.detail})` : ""}`;
  });
  return `Doctor — exit ${r.exit}\n\n${rows.join("\n")}`;
}

export function formatCheck(agentId: string, r: CheckReport): string {
  const head = r.violations.length === 0
    ? `✅ **${agentId}** — backend-neutral (${r.passes.length} check(s) passed)`
    : `❌ **${agentId}** — ${r.violations.length} violation(s)`;
  const viol = r.violations.map((v) => `- ${v}`).join("\n");
  return r.violations.length === 0 ? head : `${head}\n\n${viol}`;
}

export function formatRun(r: RunResult): string {
  return [
    `**${r.agent}** — exit ${r.exitCode} · ${r.durationMs}ms`,
    "",
    r.output.trim() || "_(no output)_",
  ].join("\n");
}

// ── Tool specs ───────────────────────────────────────────────────────────────

/** One LM tool: name matches the package.json `languageModelTools` entry.
 *  `run` produces the text result; `confirm`, when present, gates the tool
 *  behind a user confirmation (write/control tools). */
export interface ToolSpec {
  name: string;
  run: (client: BwocClient, input: Record<string, unknown>) => Promise<string>;
  confirm?: (input: Record<string, unknown>) => { title: string; message: string };
  /** Progress line shown while running (optional). */
  progress?: (input: Record<string, unknown>) => string;
  /** Only works against a local workspace — the bwocd remote backend refuses it
   *  (agent-daemon lifecycle / host diagnostics). Over a remote host the tool
   *  short-circuits with a clear message instead of a scary confirm-then-error. */
  localOnly?: boolean;
}

const str = (input: Record<string, unknown>, key: string): string =>
  typeof input[key] === "string" ? (input[key] as string).trim() : "";

const optStr = (input: Record<string, unknown>, key: string): string | undefined => {
  const v = str(input, key);
  return v.length > 0 ? v : undefined;
};

export const TOOL_SPECS: ToolSpec[] = [
  // ── Read (auto-invoke) ──
  {
    name: "bwoc_list",
    run: async (c) => formatAgentList(await c.list()),
  },
  {
    name: "bwoc_agentStatus",
    run: async (c, i) => formatAgentStatus(await c.status(str(i, "agentId"))),
  },
  {
    name: "bwoc_teams",
    run: async (c) => formatTeams(await c.teams()),
  },
  {
    name: "bwoc_teamTasks",
    run: async (c, i) => {
      const team = str(i, "team");
      return formatTasks(team, await c.tasks(team));
    },
  },
  {
    name: "bwoc_memoryList",
    run: async (c) => formatMemoryList(await c.memories()),
  },
  {
    name: "bwoc_memoryRead",
    run: async (c, i) => (await c.memoryContent(str(i, "name"))).trim(),
  },
  {
    name: "bwoc_inbox",
    run: async (c, i) => {
      const id = str(i, "agentId");
      return formatInbox(id, await c.inbox(id));
    },
  },
  {
    name: "bwoc_doctor",
    run: async (c) => formatDoctor(await c.doctor()),
  },
  {
    name: "bwoc_checkAgent",
    run: async (c, i) => {
      const id = str(i, "agentId");
      const detail = await c.status(id);
      return formatCheck(id, await c.check(detail.path));
    },
  },
  // ── Write / control (confirmed) ──
  {
    name: "bwoc_sendMessage",
    run: async (c, i) => (await c.send(str(i, "to"), str(i, "message"))) || "sent",
    confirm: (i) => ({
      title: "Send message",
      message: `Send a message to **${str(i, "to")}**?`,
    }),
    progress: (i) => `Sending to ${str(i, "to")}…`,
  },
  {
    name: "bwoc_broadcast",
    run: async (c, i) => c.broadcast(str(i, "message"), optStr(i, "team")),
    confirm: (i) => {
      const team = optStr(i, "team");
      return {
        title: "Broadcast message",
        message: team
          ? `Broadcast a message to **every member of team \`${team}\`**?`
          : "Broadcast a message to **every agent in the workspace**?",
      };
    },
    progress: (i) => (optStr(i, "team") ? `Broadcasting to team ${str(i, "team")}…` : "Broadcasting to the fleet…"),
  },
  {
    name: "bwoc_runTask",
    run: async (c, i) => formatRun(await c.run(str(i, "agentId"), str(i, "task"))),
    confirm: (i) => ({
      title: "Run task",
      message: `Run a task on **${str(i, "agentId")}** (headless, one turn)?`,
    }),
    progress: (i) => `Running task on ${str(i, "agentId")}…`,
  },
  {
    name: "bwoc_taskAdd",
    run: async (c, i) => {
      const team = str(i, "team");
      await c.taskAdd(team, str(i, "title"));
      return `Added task to team **${team}**.`;
    },
    confirm: (i) => ({
      title: "Add task",
      message: `Add a task to team **${str(i, "team")}**?`,
    }),
  },
  {
    name: "bwoc_taskClaim",
    run: async (c, i) => {
      const team = str(i, "team");
      const id = str(i, "taskId");
      await c.taskClaim(team, id);
      return `Claimed \`${id}\` in team **${team}**.`;
    },
    confirm: (i) => ({
      title: "Claim task",
      message: `Claim task \`${str(i, "taskId")}\` in team **${str(i, "team")}**?`,
    }),
  },
  {
    name: "bwoc_taskComplete",
    run: async (c, i) => {
      const team = str(i, "team");
      const id = str(i, "taskId");
      await c.taskComplete(team, id);
      return `Completed \`${id}\` in team **${team}**.`;
    },
    confirm: (i) => ({
      title: "Complete task",
      message: `Mark task \`${str(i, "taskId")}\` complete in team **${str(i, "team")}**?`,
    }),
  },
  {
    name: "bwoc_startAgent",
    run: async (c, i) => await c.start(str(i, "agentId")),
    confirm: (i) => ({
      title: "Start agent daemon",
      message: `Start the daemon for **${str(i, "agentId")}**?`,
    }),
    progress: (i) => `Starting ${str(i, "agentId")}…`,
  },
  {
    name: "bwoc_stopAgent",
    run: async (c, i) => await c.stop(str(i, "agentId")),
    confirm: (i) => ({
      title: "Stop agent daemon",
      message: `Stop the daemon for **${str(i, "agentId")}**?`,
    }),
    progress: (i) => `Stopping ${str(i, "agentId")}…`,
  },
  {
    name: "bwoc_outboxFlush",
    run: async (c, i) => c.outboxFlush(optStr(i, "peer")),
    confirm: (i) => {
      const peer = optStr(i, "peer");
      return {
        title: "Flush outbox",
        message: peer
          ? `Retry spooled messages for **${peer}**?`
          : "Retry all spooled outbox messages?",
      };
    },
    progress: () => "Flushing the outbox…",
  },
  {
    name: "bwoc_newAgent",
    run: async (c, i) => await c.newAgent(str(i, "name"), str(i, "backend")),
    confirm: (i) => ({
      title: "Incarnate new agent",
      message: `Create a new agent **${str(i, "name")}** on backend \`${str(i, "backend")}\`? This writes files and registers the agent.`,
    }),
    progress: (i) => `Incarnating ${str(i, "name")}…`,
  },
  {
    name: "bwoc_retireAgent",
    run: async (c, i) => await c.retire(str(i, "agentId")),
    confirm: (i) => ({
      title: "Retire agent",
      message: `⚠️ Retire **${str(i, "agentId")}** — remove it from the registry and delete its files? This cannot be undone.`,
    }),
    progress: (i) => `Retiring ${str(i, "agentId")}…`,
  },
];

// Agent-daemon lifecycle + host diagnostics: the bwocd remote backend refuses
// these (they mutate the daemon / probe the host), so mark them local-only for
// the remote short-circuit below.
for (const s of TOOL_SPECS) {
  if (
    [
      "bwoc_startAgent",
      "bwoc_stopAgent",
      "bwoc_newAgent",
      "bwoc_retireAgent",
      "bwoc_doctor",
      "bwoc_checkAgent",
    ].includes(s.name)
  ) {
    s.localOnly = true;
  }
}

// ── Registration (vscode-coupled glue) ───────────────────────────────────────

/** Register every BWOC tool with the editor's Language Model Tools API so
 *  Copilot agent-mode and `#bwoc_*` chat references can drive the fleet. No-ops
 *  on editors without the API. */
export function registerBwocTools(
  context: vscode.ExtensionContext,
  getClient: () => BwocClient,
): void {
  const lm = vscode.lm as typeof vscode.lm & {
    registerTool?: typeof vscode.lm.registerTool;
  };
  if (typeof lm.registerTool !== "function") {
    return;
  }
  // A local-only tool is unavailable when the active host is a remote bwocd.
  const remoteBlocks = (spec: ToolSpec) =>
    !!spec.localOnly && getClient() instanceof BwocdBackend;
  const remoteMsg = (spec: ToolSpec) =>
    `⚠️ ${spec.name.replace(/^bwoc_/, "")} isn't available over a remote bwocd host ` +
    `(agent-daemon lifecycle / host diagnostics are local-CLI only). Switch to the ` +
    `Local CLI host, or run it on the host.`;

  for (const spec of TOOL_SPECS) {
    const tool: vscode.LanguageModelTool<Record<string, unknown>> = {
      async invoke(options) {
        // Short-circuit local-only tools on a remote host — a clear message,
        // not a confirm-then-localOnly-error.
        if (remoteBlocks(spec)) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(remoteMsg(spec)),
          ]);
        }
        const input = (options.input ?? {}) as Record<string, unknown>;
        try {
          const text = await spec.run(getClient(), input);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`⚠️ ${errText(err)}`),
          ]);
        }
      },
      prepareInvocation(options) {
        // No scary confirmation for a tool that can't run on this host.
        if (remoteBlocks(spec)) {
          return { invocationMessage: remoteMsg(spec) };
        }
        const input = (options.input ?? {}) as Record<string, unknown>;
        const confirmationMessages = spec.confirm?.(input);
        const invocationMessage = spec.progress?.(input);
        if (confirmationMessages) {
          return { invocationMessage, confirmationMessages };
        }
        return invocationMessage ? { invocationMessage } : undefined;
      },
    };
    context.subscriptions.push(lm.registerTool(spec.name, tool));
  }
}
