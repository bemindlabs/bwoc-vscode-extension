// bwocd backend — drive a remote/tailnet fleet over the control daemon's
// ed25519-signed HTTP API (the same wire contract the chrome-extension and the
// desktop control-center use). Selected when `bwoc.remote.url` is set; otherwise
// the CLI backend runs locally. Read-only for P2 (GET /fleet, GET /agents/:id/status).

import { canonicalPath } from "./canonical";
import { Signer } from "./signer";
import type { AgentDetail, AgentSummary, BwocClient } from "./types";

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
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
        // Guard against a hung daemon — the CLI backend bounds itself the same way.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new BwocdError(
          `bwocd at ${this.base} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s — is the daemon reachable over the tailnet?`,
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

  async send(_to: string, _message: string): Promise<string> {
    // The bwocd inbox-write route is capability-gated and lands with the P2
    // mutation slice; until then remote send is not wired.
    throw new BwocdError(
      "sending over a remote bwocd host is not supported yet — run against a local workspace, or use bwoc send in a terminal.",
    );
  }

  async run(_agentId: string, _task: string): Promise<import("./types").RunResult> {
    // Headless task execution over a remote host is a capability-gated mutation
    // (the /cli proxy slice); not wired yet.
    throw new BwocdError(
      "running a task over a remote bwocd host is not supported yet — run against a local workspace.",
    );
  }
}
