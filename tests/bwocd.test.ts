import { afterEach, describe, expect, it, vi } from "vitest";

import { BwocdBackend, BwocdError } from "../src/bwoc/bwocd";
import { Signer } from "../src/bwoc/signer";

/** A signer backed by real in-memory maps so buildSignedHeaders can actually
 *  generate + persist a key and sign each request. */
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
  stubFetchText(JSON.stringify(body), init);
}

/** Stub global fetch with a raw response body. */
function stubFetchText(text: string, init: { ok?: boolean; status?: number } = {}): void {
  const res = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    text: async () => text,
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

describe("BwocdBackend malformed responses", () => {
  const b = () => new BwocdBackend("http://127.0.0.1:9", memorySigner());

  it("wraps invalid JSON as BwocdError", async () => {
    stubFetchText("<html>proxy error</html>");
    await expect(b().list()).rejects.toThrow(BwocdError);
  });

  it("an empty /fleet body is a BwocdError, not a TypeError", async () => {
    stubFetchText("  ");
    await expect(b().list()).rejects.toThrow(BwocdError);
  });

  it("whoami without a controller_id fails instead of reporting a blank identity", async () => {
    stubFetch({ caps: ["read"] });
    await expect(b().whoami()).rejects.toThrow(/controller_id/);
  });

  it("whoami keeps unknown future caps", async () => {
    stubFetch({ controller_id: "vscode-1", caps: ["read", "admin"], bwocd_version: "9" });
    expect((await b().whoami()).caps).toEqual(["read", "admin"]);
  });

  it("a /cli result without exit_code / stdout fails closed", async () => {
    stubFetch({ ok: true });
    await expect(b().send("agent-x", "hi")).rejects.toThrow(/malformed/);
  });

  it("a run envelope without exit_code is an error, not exit 0", async () => {
    stubFetch({ agent: "agent-x", output: "" });
    await expect(b().run("agent-x", "t")).rejects.toThrow(BwocdError);
  });
});
