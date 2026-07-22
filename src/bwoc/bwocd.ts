// bwocd backend — drive a remote/tailnet fleet over the control daemon's
// ed25519-signed HTTP API (the same wire contract the chrome-extension and the
// desktop control-center use). Selected when `bwoc.remote.url` is set; otherwise
// the CLI backend runs locally. Reads go to dedicated routes (GET /fleet, GET
// /agents/:id/status); `run` uses POST /agents/:id/chat; and send/teams/tasks/
// memory flow through the capability-gated POST /cli verb proxy.

import { canonicalPath } from "./canonical";
import { parseMemories, parseTasks, parseTeams } from "./cli";
import { Signer } from "./signer";
import type {
  AgentDetail,
  AgentSummary,
  BwocClient,
  DoctorReport,
  InboxMessage,
  MemoryEntry,
  Task,
  Team,
} from "./types";

/** Surfaced to the UI as an actionable notification. */
export class BwocdError extends Error {}

/** Bound every bwocd request the same way the CLI backend bounds itself (15s),
 *  so a hung daemon can't wedge list()/status()/inbox forever. */
const REQUEST_TIMEOUT_MS = 15000;

interface RawAgent {
  id: string;
  backend?: string;
  status?: string;
  running?: boolean;
  inbox_count?: number;
  incarnated?: string;
  path?: string;
}

interface RawDetail extends RawAgent {
  health?: string;
  health_detail?: string | null;
  primary_model?: string;
  scope?: string;
  out_of_scope?: string;
  resources?: { memories?: number; mindsets?: number; skills?: number };
}

export class BwocdBackend implements BwocClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly signer: Signer,
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  /** Signed GET. `path` may carry a query string; it is canonicalized for signing. */
  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /** Signed request. `path` may carry a query string; it is canonicalized for
   *  signing. `body`, when present, is JSON-encoded and its hash is signed. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const [pathname, query] = path.split("?", 2);
    const canonical = canonicalPath(pathname, query ?? null);
    const bodyBytes =
      body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body));
    const headers = await this.signer.buildSignedHeaders(method, canonical, bodyBytes);
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : bodyBytes,
        // Guard against a hung daemon — the CLI backend bounds itself the same
        // way. Long-running verbs (a remote `run`) pass a generous override.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new BwocdError(
          `bwocd at ${this.base} did not respond within ${timeoutMs / 1000}s — is the daemon reachable over the tailnet?`,
        );
      }
      throw new BwocdError(`bwocd unreachable at ${this.base}: ${err.message}`);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new BwocdError(
          `bwocd rejected this controller (${res.status}). Enroll it (BWOC: Enroll This Controller) and have the operator approve it with the caps you need.`,
        );
      }
      throw new BwocdError(`bwocd ${res.status}: ${errBody || res.statusText}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async list(): Promise<AgentSummary[]> {
    const snap = await this.get<{ agents: RawAgent[] | null }>("/fleet");
    return (snap.agents ?? []).map((a) => ({
      id: a.id,
      backend: a.backend ?? "",
      status: a.status ?? "",
      running: a.running ?? false,
      inboxCount: a.inbox_count ?? 0,
      incarnated: a.incarnated ?? "",
      path: a.path ?? "",
    }));
  }

  async status(agentId: string): Promise<AgentDetail> {
    // Unlike /fleet, bwocd's /agents/:id/status returns `bwoc status --json`
    // VERBATIM — `{ workspace, agents: [ {…the real fields…} ] }` — it does NOT
    // unwrap. Read agents[0]; a flat read here silently defaults every field.
    const snap = await this.get<{ agents?: RawDetail[] | null }>(
      `/agents/${encodeURIComponent(agentId)}/status`,
    );
    const d = snap.agents?.[0];
    if (!d) {
      throw new BwocdError(`bwocd returned no status for ${agentId} (empty agents[]).`);
    }
    return {
      id: d.id ?? agentId,
      backend: d.backend ?? "",
      status: d.status ?? "",
      running: d.running ?? false,
      inboxCount: d.inbox_count ?? 0,
      incarnated: d.incarnated ?? "",
      path: d.path ?? "",
      health: d.health ?? "unknown",
      healthDetail: d.health_detail ?? null,
      primaryModel: d.primary_model ?? "",
      scope: d.scope ?? "",
      outOfScope: d.out_of_scope ?? "",
      resources: {
        memories: d.resources?.memories ?? 0,
        mindsets: d.resources?.mindsets ?? 0,
        skills: d.resources?.skills ?? 0,
      },
    };
  }

  /**
   * Self-enroll this controller identity: POST /enroll with the controller id
   * and its ed25519 public key so the operator can approve it. Without this a
   * fresh controller key can never be approved and bwocd 401s forever (remote
   * backend dead-on-arrival). Returns the identity so the caller can show the
   * id + public key the operator must approve.
   */
  async enroll(): Promise<{ controllerId: string; publicKeyHex: string }> {
    const { controllerId, publicKeyHex } = await this.signer.ensureIdentity();
    await this.request<null>("POST", "/enroll", {
      id: controllerId,
      public_key: publicKeyHex,
    });
    return { controllerId, publicKeyHex };
  }

  /**
   * `GET /whoami` — the caller's approved identity + capabilities on this host.
   * A 401/403 here means the controller isn't enrolled/approved yet (distinct
   * from an unreachable host, which throws a network `BwocdError`).
   */
  async whoami(): Promise<import("./types").WhoAmI> {
    const raw = await this.get<{
      controller_id?: string;
      caps?: string[];
      bwocd_version?: string;
    }>("/whoami");
    return {
      controllerId: raw.controller_id ?? "",
      caps: (raw.caps ?? []) as import("./types").Capability[],
      bwocdVersion: raw.bwocd_version ?? "",
    };
  }

  /**
   * Drive one `bwoc` verb through bwocd's capability-gated `POST /cli` proxy.
   * bwocd runs `bwoc <argv> --workspace <host-ws>` and returns
   * `{ ok, exit_code, stdout, stderr, tier }`; we return stdout for the caller's
   * own parser, or throw with stderr on a non-zero exit. A 401/403 (unenrolled
   * or missing capability) is mapped to a clear `BwocdError` by `request()`.
   */
  private async cli(argv: string[]): Promise<string> {
    const res = await this.request<{
      ok?: boolean;
      exit_code?: number;
      stdout?: string;
      stderr?: string;
    }>("POST", "/cli", { argv });
    if (res.ok === false || (res.exit_code ?? 0) !== 0) {
      const detail = res.stderr ? `: ${res.stderr}` : "";
      throw new BwocdError(`bwoc ${argv.join(" ")} failed (exit ${res.exit_code ?? "?"})${detail}`);
    }
    return res.stdout ?? "";
  }

  async send(to: string, message: string): Promise<string> {
    return (await this.cli(["send", to, message])).trim();
  }

  async run(agentId: string, task: string): Promise<import("./types").RunResult> {
    // bwocd's `POST /agents/:id/chat` runs `bwoc run <id> --task <prompt> --json`
    // on the host and returns the run envelope verbatim — remote headless task
    // execution. (send / teams / tasks / memory over remote still await bwocd's
    // generic /cli gated proxy — see the extension issue.)
    const raw = await this.request<{
      agent?: string;
      exit_code?: number;
      duration_ms?: number;
      output?: string;
    }>("POST", `/agents/${encodeURIComponent(agentId)}/chat`, { prompt: task }, 15 * 60 * 1000);
    return {
      agent: raw.agent ?? agentId,
      exitCode: raw.exit_code ?? 0,
      durationMs: raw.duration_ms ?? 0,
      output: raw.output ?? "",
    };
  }

  async teams(): Promise<Team[]> {
    return parseTeams(await this.cli(["team", "list", "--json"]));
  }

  async tasks(team: string): Promise<Task[]> {
    return parseTasks(await this.cli(["task", "list", team, "--json"]));
  }

  async memories(): Promise<MemoryEntry[]> {
    return parseMemories(await this.cli(["memory", "list", "--json"]));
  }

  async memoryContent(name: string): Promise<string> {
    return this.cli(["memory", "show", name]);
  }

  async inbox(agentId: string): Promise<InboxMessage[]> {
    // Dedicated read route — bwocd exposes GET /agents/:id/inbox returning
    // `bwoc inbox <id> --json` verbatim ({ agent, inbox, messages[] }).
    const raw = await this.get<{
      messages?: Array<{
        from?: string;
        message?: string;
        subject?: string | null;
        type?: string | null;
      }> | null;
    }>(`/agents/${encodeURIComponent(agentId)}/inbox`);
    return (raw.messages ?? []).map((m) => ({
      from: m.from ?? "?",
      message: m.message ?? "",
      subject: m.subject ?? null,
      type: m.type ?? null,
    }));
  }

  async taskAdd(team: string, title: string): Promise<void> {
    await this.cli(["task", "add", team, title, "--json"]);
  }

  async taskClaim(team: string, taskId: string): Promise<void> {
    await this.cli(["task", "claim", team, taskId, "--json"]);
  }

  async taskComplete(team: string, taskId: string): Promise<void> {
    await this.cli(["task", "complete", team, taskId, "--json"]);
  }

  // Agent-lifecycle + diagnostics are not exposed over bwocd's capability-gated
  // /cli allowlist (start/stop mutate the daemon; doctor probes the host env), so
  // they are local-CLI-only. Surface a clear reason instead of a bwocd refusal.
  private localOnly(verb: string): never {
    throw new BwocdError(
      `${verb} is not available over a remote bwocd host — switch to the Local CLI (BWOC: Switch Fleet Host) to run it, or run it in a terminal on the host.`,
    );
  }

  async start(_agentId: string): Promise<string> {
    this.localOnly("Start agent");
  }

  async stop(_agentId: string): Promise<string> {
    this.localOnly("Stop agent");
  }

  async doctor(): Promise<DoctorReport> {
    this.localOnly("Doctor");
  }

  async check(_agentPath: string): Promise<import("./types").CheckReport> {
    this.localOnly("Check agent");
  }

  async newAgent(_name: string, _backend: string): Promise<string> {
    this.localOnly("New agent");
  }

  async retire(_name: string): Promise<string> {
    this.localOnly("Retire agent");
  }
}
