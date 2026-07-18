// bwocd backend — drive a remote/tailnet fleet over the control daemon's
// ed25519-signed HTTP API (the same wire contract the chrome-extension and the
// desktop control-center use). Selected when `bwoc.remote.url` is set; otherwise
// the CLI backend runs locally. Read-only for P2 (GET /fleet, GET /agents/:id/status).

import { canonicalPath } from "./canonical";
import { Signer } from "./signer";
import type { AgentDetail, AgentSummary, BwocClient } from "./types";

/** Surfaced to the UI as an actionable notification. */
export class BwocdError extends Error {}

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
    const [pathname, query] = path.split("?", 2);
    const canonical = canonicalPath(pathname, query ?? null);
    const headers = await this.signer.buildSignedHeaders("GET", canonical, new Uint8Array(0));

    let res: Response;
    try {
      res = await fetch(this.base + path, { method: "GET", headers });
    } catch (e) {
      throw new BwocdError(`bwocd unreachable at ${this.base}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new BwocdError(
          `bwocd rejected this controller (${res.status}). Enroll it and have the operator approve it with the caps you need.`,
        );
      }
      throw new BwocdError(`bwocd ${res.status}: ${body || res.statusText}`);
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
    const d = await this.get<RawDetail>(`/agents/${encodeURIComponent(agentId)}/status`);
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

  async send(_to: string, _message: string): Promise<string> {
    // The bwocd inbox-write route is capability-gated and lands with the P2
    // mutation slice; until then remote send is not wired.
    throw new BwocdError(
      "sending over a remote bwocd host is not supported yet — run against a local workspace, or use bwoc send in a terminal.",
    );
  }
}
