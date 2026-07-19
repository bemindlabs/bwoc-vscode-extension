import { afterEach, describe, expect, it, vi } from "vitest";

import { BwocdBackend, BwocdError } from "../src/bwoc/bwocd";
import { Signer } from "../src/bwoc/signer";

/** A signer backed by real in-memory maps so buildSignedHeaders can actually
 *  generate + persist a key (the dummy above throws once signing is reached). */
function memorySigner(): Signer {
  const secrets = new Map<string, string>();
  const config = new Map<string, string>();
  return new Signer(
    { get: async (k) => secrets.get(k), store: async (k, v) => void secrets.set(k, v) },
    { get: (k) => config.get(k), update: async (k, v) => void config.set(k, v) },
  );
}

/** Stub global fetch with a single JSON response. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  const res = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  } as Response;
  vi.stubGlobal("fetch", vi.fn(async () => res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BwocdBackend.send", () => {
  it("returns the confirmation from the /cli proxy stdout", async () => {
    stubFetch({ ok: true, exit_code: 0, stdout: "Sent to agent-x.\n", stderr: "", tier: "write" });
    const b = new BwocdBackend("http://127.0.0.1:9", memorySigner());
    expect(await b.send("agent-x", "hi")).toBe("Sent to agent-x.");
  });

  it("throws BwocdError with stderr on a non-zero /cli exit", async () => {
    stubFetch({ ok: false, exit_code: 2, stdout: "", stderr: "no such agent", tier: "write" });
    const b = new BwocdBackend("http://127.0.0.1:9", memorySigner());
    await expect(b.send("ghost", "hi")).rejects.toThrow(/no such agent/);
  });
});

describe("BwocdBackend.status", () => {
  it("reads agents[0] from the verbatim `bwoc status --json` envelope", async () => {
    // /agents/:id/status returns the CLI output UNWRAPPED: { workspace, agents: [ … ] }.
    // A flat read here would silently default every field (blank backend/path).
    stubFetch({
      workspace: "/ws",
      agents: [
        {
          id: "agent-x",
          backend: "claude",
          status: "active",
          running: true,
          inbox_count: 2,
          incarnated: "2026-01-01",
          path: "agents/agent-x",
          health: "ok",
          health_detail: null,
          primary_model: "claude-opus-4-8",
          scope: "fleet",
          out_of_scope: "",
          resources: { memories: 3, mindsets: 4, skills: 5 },
        },
      ],
    });
    const b = new BwocdBackend("http://127.0.0.1:9", memorySigner());
    const d = await b.status("agent-x");
    expect(d).toMatchObject({
      id: "agent-x",
      backend: "claude",
      path: "agents/agent-x",
      primaryModel: "claude-opus-4-8",
      health: "ok",
      resources: { memories: 3, mindsets: 4, skills: 5 },
    });
  });

  it("throws a clear BwocdError when agents[] is empty", async () => {
    stubFetch({ workspace: "/ws", agents: [] });
    const b = new BwocdBackend("http://127.0.0.1:9", memorySigner());
    await expect(b.status("ghost")).rejects.toThrow(BwocdError);
    await expect(b.status("ghost")).rejects.toThrow(/no status for ghost/i);
  });
});
