// Byte-identical port of cc-signing (bwoc-control-center/cc-signing/src/lib.rs),
// via the chrome-extension's canonical.ts. The Rust verifier (bwocd) signs/checks
// over EXACTLY these strings, so any drift here breaks auth. The golden-vector
// test asserts the payload equals cc-signing's literal — change neither side alone.
//
// Node port: uses node:crypto for the hash/nonce (the browser version used
// WebCrypto); the pure string logic is identical.

import { createHash, randomBytes } from "node:crypto";

/**
 * The canonical payload both sides sign: a flat JSON object with
 * lexicographically sorted keys and an UPPERCASE method. Built by manual string
 * templating (NOT JSON.stringify) so key order/escaping can never drift from the
 * Rust `format!`.
 */
export function signingPayload(
  sender: string,
  method: string,
  path: string,
  nonce: string,
  ts: string,
  bodyHash: string,
): string {
  const m = method.toUpperCase();
  return `{"bodyHash":"${bodyHash}","method":"${m}","nonce":"${nonce}","path":"${path}","sender":"${sender}","ts":"${ts}"}`;
}

/** Canonical request path: pathname + query entries sorted by key then value. */
export function canonicalPath(path: string, query?: string | null): string {
  if (!query) return path;
  const entries = query
    .split("&")
    .filter((s) => s.length > 0)
    .map((kv): [string, string] => {
      const i = kv.indexOf("=");
      return i === -1 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)];
    });
  // Sort by key, then value — matches Rust's tuple sort (sorts on .0 then .1).
  entries.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const qs = entries.map(([k, v]) => `${k}=${v}`).join("&");
  return `${path}?${qs}`;
}

/** sha256 hex of a request body (matches cc_signing::sha256_hex). */
export function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/** 16 random bytes as hex — the per-request nonce. */
export function randomNonceHex(): string {
  return randomBytes(16).toString("hex");
}
