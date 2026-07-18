import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AgentDetail, AgentSummary, BwocClient } from "./types";

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

// ── CLI backend ─────────────────────────────────────────────────────────────

export interface CliOptions {
  /** Path to the `bwoc` binary (default `bwoc` on PATH). */
  binaryPath: string;
  /** Workspace root to run in (`--workspace`); empty = let bwoc resolve. */
  workspace: string;
}

export class CliBackend implements BwocClient {
  constructor(private readonly opts: CliOptions) {}

  private async run(args: string[]): Promise<string> {
    const full = this.opts.workspace
      ? [...args, "--workspace", this.opts.workspace]
      : args;
    try {
      const { stdout } = await execFileAsync(this.opts.binaryPath, full, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15_000,
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
    return parseList(await this.run(["list", "--json"]));
  }

  async status(agentId: string): Promise<AgentDetail> {
    return parseStatus(await this.run(["status", agentId, "--json"]));
  }
}
