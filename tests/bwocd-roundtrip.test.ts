import { createPublicKey, verify, type KeyObject } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { BwocdBackend } from "../src/bwoc/bwocd";
import { canonicalPath, signingPayload } from "../src/bwoc/canonical";
import { Signer, type ConfigStore, type KeyStore } from "../src/bwoc/signer";

// End-to-end proof that the signing layer and the HTTP layer actually meet: a
// real http.Server reconstructs the canonical payload from the X-BWOC-* headers
// and Ed25519-verifies it exactly as bwocd's Rust verifier would, then returns a
// canned response the backend must map. This is the test that would have caught
// B1 (the wrapped-status-envelope mis-parse) — see the status test below.

function stores(): { secrets: KeyStore; config: ConfigStore } {
  const secret = new Map<string, string>();
  const cfg = new Map<string, string>();
  return {
    secrets: {
      get: async (k) => secret.get(k),
      store: async (k, v) => {
        secret.set(k, v);
      },
    },
    config: {
      get: (k) => cfg.get(k),
      update: async (k, v) => {
        cfg.set(k, v);
      },
    },
  };
}

function publicKeyFromRawHex(hex: string): KeyObject {
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), // ed25519 SPKI prefix
    Buffer.from(hex, "hex"),
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/** A server that verifies the request signature against `verifyPubHex`, then
 *  serves `routes` by pathname. */
async function startServer(
  verifyPubHex: string,
  routes: Record<string, unknown>,
): Promise<{ base: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const [pathname, query] = (req.url ?? "").split("?", 2);
    const payload = signingPayload(
      String(req.headers["x-bwoc-agent"] ?? ""),
      req.method ?? "GET",
      canonicalPath(pathname, query ?? null),
      String(req.headers["x-bwoc-nonce"] ?? ""),
      String(req.headers["x-bwoc-timestamp"] ?? ""),
      String(req.headers["x-bwoc-body-sha256"] ?? ""),
    );
    const ok = verify(
      null,
      Buffer.from(payload),
      publicKeyFromRawHex(verifyPubHex),
      Buffer.from(String(req.headers["x-bwoc-signature"] ?? ""), "hex"),
    );
    if (!ok) {
      res.writeHead(401);
      res.end("bad signature");
      return;
    }
    if (!(pathname in routes)) {
      res.writeHead(404);
      res.end("no route");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(routes[pathname]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe("BwocdBackend signed HTTP round-trip", () => {
  let closer: (() => void) | undefined;
  afterEach(() => closer?.());

  it("signs a request the server accepts and maps /fleet → list()", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/fleet": {
        agents: [
          {
            id: "agent-anna",
            backend: "claude",
            status: "active",
            running: true,
            inbox_count: 2,
            path: "agents/agent-anna",
            incarnated: "x",
          },
        ],
      },
    });
    closer = srv.close;

    const list = await new BwocdBackend(srv.base, signer).list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "agent-anna", inboxCount: 2, running: true });
  });

  it("unwraps the verbatim `{workspace,agents:[…]}` status envelope → status() (guards B1)", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    // bwocd returns `bwoc status --json` VERBATIM, wrapped. A flat read (the B1
    // bug) would default every field.
    const srv = await startServer(publicKeyHex, {
      "/agents/agent-anna/status": {
        workspace: "/ws",
        agents: [
          {
            id: "agent-anna",
            backend: "claude",
            health: "ok",
            primary_model: "claude-opus-4-8",
            inbox_count: 5,
            path: "agents/agent-anna",
            resources: { memories: 3, mindsets: 0, skills: 1 },
          },
        ],
      },
    });
    closer = srv.close;

    const d = await new BwocdBackend(srv.base, signer).status("agent-anna");
    expect(d.backend).toBe("claude");
    expect(d.health).toBe("ok");
    expect(d.primaryModel).toBe("claude-opus-4-8");
    expect(d.inboxCount).toBe(5);
    expect(d.resources.memories).toBe(3);
  });

  it("maps /whoami → { controllerId, caps, bwocdVersion }", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/whoami": { controller_id: "vscode-abc123", caps: ["read", "write"], bwocd_version: "0.3.0" },
    });
    closer = srv.close;

    const me = await new BwocdBackend(srv.base, signer).whoami();
    expect(me).toEqual({
      controllerId: "vscode-abc123",
      caps: ["read", "write"],
      bwocdVersion: "0.3.0",
    });
  });

  it("runs a task via the signed POST /agents/:id/chat and maps the run envelope", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/agents/agent-anna/chat": {
        agent: "agent-anna",
        backend: "claude",
        exit_code: 0,
        duration_ms: 4200,
        output: "task done",
      },
    });
    closer = srv.close;

    const result = await new BwocdBackend(srv.base, signer).run("agent-anna", "do the thing");
    expect(result).toMatchObject({ agent: "agent-anna", exitCode: 0, durationMs: 4200, output: "task done" });
  });

  it("drives teams() through the signed POST /cli proxy and parses stdout", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/cli": {
        ok: true,
        exit_code: 0,
        tier: "read",
        stdout: JSON.stringify([
          { team: "tianting", members: ["agent-yudi"], created_at: "x" },
        ]),
        stderr: "",
      },
    });
    closer = srv.close;

    const teams = await new BwocdBackend(srv.base, signer).teams();
    expect(teams).toEqual([{ name: "tianting", members: ["agent-yudi"], createdAt: "x" }]);
  });

  it("returns send() confirmation from /cli stdout", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/cli": { ok: true, exit_code: 0, tier: "write", stdout: "Sent to agent-anna.\n", stderr: "" },
    });
    closer = srv.close;
    expect(await new BwocdBackend(srv.base, signer).send("agent-anna", "hi")).toBe("Sent to agent-anna.");
  });

  it("throws with stderr when a /cli verb exits non-zero", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    const { publicKeyHex } = await signer.ensureIdentity();
    const srv = await startServer(publicKeyHex, {
      "/cli": { ok: false, exit_code: 2, tier: "write", stdout: "", stderr: "no such agent" },
    });
    closer = srv.close;
    await expect(new BwocdBackend(srv.base, signer).send("nope", "hi")).rejects.toThrow(/no such agent/);
  });

  it("surfaces a rejected signature (401) as BwocdError", async () => {
    const { secrets, config } = stores();
    const signer = new Signer(secrets, config);
    await signer.ensureIdentity();
    // Verify against a DIFFERENT identity's key so the real signature fails.
    const other = new Signer(stores().secrets, stores().config);
    const { publicKeyHex: wrongPub } = await other.ensureIdentity();
    const srv = await startServer(wrongPub, { "/fleet": { agents: [] } });
    closer = srv.close;

    await expect(new BwocdBackend(srv.base, signer).list()).rejects.toThrow(/rejected|401/i);
  });
});
