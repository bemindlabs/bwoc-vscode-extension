import { createPublicKey, verify, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signingPayload } from "../src/bwoc/canonical";
import { Signer, type ConfigStore, type KeyStore } from "../src/bwoc/signer";

/** In-memory KeyStore/ConfigStore doubles (no VS Code, no disk). */
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

/** Rebuild an Ed25519 public KeyObject from the 32-byte raw hex (SPKI wrap). */
function publicKeyFromRawHex(hex: string): KeyObject {
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), // ed25519 SPKI prefix
    Buffer.from(hex, "hex"),
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

describe("Signer", () => {
  it("generates a stable identity; ensureIdentity is idempotent", async () => {
    const { secrets, config } = stores();
    const s = new Signer(secrets, config);
    const a = await s.ensureIdentity();
    const b = await s.ensureIdentity();
    expect(a).toEqual(b);
    expect(a.controllerId).toMatch(/^vscode-[0-9a-f]{8}$/);
    expect(a.publicKeyHex).toHaveLength(64); // 32 bytes
  });

  it("emits the five X-BWOC headers with a signature that verifies", async () => {
    const { secrets, config } = stores();
    const s = new Signer(secrets, config);
    const { controllerId, publicKeyHex } = await s.ensureIdentity();

    const h = await s.buildSignedHeaders("GET", "/fleet", new Uint8Array(0));
    expect(h["X-BWOC-Agent"]).toBe(controllerId);
    expect(h["X-BWOC-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["X-BWOC-Body-SHA256"]).toHaveLength(64);

    // Reconstruct the canonical payload and verify the Ed25519 signature — this
    // is exactly what bwocd's Rust verifier does, so a pass proves wire parity.
    const payload = signingPayload(
      controllerId,
      "GET",
      "/fleet",
      h["X-BWOC-Nonce"],
      h["X-BWOC-Timestamp"],
      h["X-BWOC-Body-SHA256"],
    );
    const ok = verify(
      null,
      Buffer.from(payload),
      publicKeyFromRawHex(publicKeyHex),
      Buffer.from(h["X-BWOC-Signature"], "hex"),
    );
    expect(ok).toBe(true);
  });
});
