import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AgentDetail,
  AgentSummary,
  BwocClient,
  RunResult,
  Task,
  Team,
} from "./types";

const execFileAsync = promisify(execFile);

/** Raised when the CLI cannot be run or returns non-JSON / non-zero. Carries a
 *  user-facing message the extension surfaces via a notification. */
export class BwocCliError extends Error {}

// ── Pure parsers (unit-tested without spawning) ─────────────────────────────

interface RawSummary {
  id: string;
  backend: string;
  status: string;
  running: boolean;
  inbox_count: number;
  incarnated: string;
  path: string;
}

export function parseList(stdout: string): AgentSummary[] {
  const doc = JSON.parse(stdout) as { agents?: RawSummary[] };
  const rows = doc.agents ?? [];
  return rows.map((r) => ({
    id: r.id,
    backend: r.backend,
    status: r.status,
    running: r.running,
    inboxCount: r.inbox_count ?? 0,
    incarnated: r.incarnated,
    path: r.path,
  }));
}

interface RawDetail extends RawSummary {
  health: string;
  health_detail: string | null;
  primary_model: string;
  scope: string;
  out_of_scope: string;
  resources: { memories: number; mindsets: number; skills: number };
}

export function parseStatus(stdout: string): AgentDetail {
  const doc = JSON.parse(stdout) as { agents?: RawDetail[] };
  const r = doc.agents?.[0];
  if (!r) {
    throw new BwocCliError("bwoc status returned no agent");
  }
  return {
    id: r.id,
    backend: r.backend,
    status: r.status,
    running: r.running,
    inboxCount: r.inbox_count ?? 0,
    incarnated: r.incarnated,
    path: r.path,
    health: r.health,
    healthDetail: r.health_detail ?? null,
    primaryModel: r.primary_model,
    scope: r.scope,
    outOfScope: r.out_of_scope,
    resources: r.resources ?? { memories: 0, mindsets: 0, skills: 0 },
  };
}

export function parseTeams(stdout: string): Team[] {
  const arr = JSON.parse(stdout) as Array<{
    team: string;
    members?: string[];
    created_at?: string;
  }>;
  return (arr ?? []).map((t) => ({
    name: t.team,
    members: t.members ?? [],
    createdAt: t.created_at ?? "",
  }));
}

export function parseTasks(stdout: string): Task[] {
  const arr = JSON.parse(stdout) as Array<{
    id: string;
    plan?: string;
    claimed_by?: string | null;
    completed_at?: string | null;
    created_at?: string;
  }>;
  return (arr ?? []).map((t) => ({
    id: t.id,
    plan: t.plan ?? "",
    claimedBy: t.claimed_by ?? null,
    completedAt: t.completed_at ?? null,
    createdAt: t.created_at ?? "",
    state: t.completed_at ? "done" : t.claimed_by ? "claimed" : "open",
  }));
}

export function parseRunResult(stdout: string): RunResult {
  const doc = JSON.parse(stdout) as {
    agent?: string;
    exit_code?: number;
    duration_ms?: number;
    output?: string;
  };
  return {
    agent: doc.agent ?? "",
    exitCode: doc.exit_code ?? 0,
    durationMs: doc.duration_ms ?? 0,
    output: doc.output ?? "",
  };
}

// ── CLI backend ─────────────────────────────────────────────────────────────

export interface CliOptions {
  /** Path to the `bwoc` binary (default `bwoc` on PATH). */
  binaryPath: string;
  /** Workspace root to run in (`--workspace`); empty = let bwoc resolve. */
  workspace: string;
}

export class CliBackend implements BwocClient {
  constructor(private readonly opts: CliOptions) {}

  /** Run a `bwoc` verb and capture stdout. `timeoutMs` bounds quick read/write
   *  verbs; the long-running `run` task passes its own generous bound. */
  private async exec(args: string[], timeoutMs = 15_000): Promise<string> {
    const full = this.opts.workspace
      ? [...args, "--workspace", this.opts.workspace]
      : args;
    try {
      const { stdout } = await execFileAsync(this.opts.binaryPath, full, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: timeoutMs,
      });
      return stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        throw new BwocCliError(
          `bwoc not found at "${this.opts.binaryPath}". Set "bwoc.binaryPath" in Settings.`,
        );
      }
      throw new BwocCliError(`bwoc ${args.join(" ")} failed: ${e.message}`);
    }
  }

  async list(): Promise<AgentSummary[]> {
    return parseList(await this.exec(["list", "--json"]));
  }

  async status(agentId: string): Promise<AgentDetail> {
    return parseStatus(await this.exec(["status", agentId, "--json"]));
  }

  async send(to: string, message: string): Promise<string> {
    // `bwoc send <to> <message>` — the default sender is the human operator.
    // Non-`--json` verb: the stdout confirmation line is returned verbatim.
    return (await this.exec(["send", to, message])).trim();
  }

  async run(agentId: string, task: string): Promise<RunResult> {
    // `bwoc run --task <task> <agent> --json` — a single headless task, captured.
    // Tasks are long-running, so use a generous 15-minute host timeout on top of
    // whatever `bwoc run --timeout` the fleet enforces.
    return parseRunResult(
      await this.exec(["run", "--task", task, agentId, "--json"], 15 * 60 * 1000),
    );
  }

  async teams(): Promise<Team[]> {
    return parseTeams(await this.exec(["team", "list", "--json"]));
  }

  async tasks(team: string): Promise<Task[]> {
    return parseTasks(await this.exec(["task", "list", team, "--json"]));
  }
}
