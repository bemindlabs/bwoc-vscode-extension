import { describe, expect, it } from "vitest";

import { canonicalPath, sha256Hex, signingPayload } from "../src/bwoc/canonical";

describe("signingPayload", () => {
  it("matches the cc-signing literal — sorted keys, uppercase method", () => {
    // Golden vector: the Rust verifier (bwocd) signs over EXACTLY this string.
    expect(
      signingPayload("ctrl", "get", "/fleet", "n1", "2026-01-01T00:00:00Z", "abc"),
    ).toBe(
      '{"bodyHash":"abc","method":"GET","nonce":"n1","path":"/fleet","sender":"ctrl","ts":"2026-01-01T00:00:00Z"}',
    );
  });
});

describe("canonicalPath", () => {
  it("returns the path unchanged with no query", () => {
    expect(canonicalPath("/fleet", null)).toBe("/fleet");
    expect(canonicalPath("/fleet")).toBe("/fleet");
  });

  it("sorts query entries by key then value (matches the Rust tuple sort)", () => {
    expect(canonicalPath("/x", "b=2&a=1&a=0")).toBe("/x?a=0&a=1&b=2");
  });

  it("tolerates valueless and empty entries", () => {
    expect(canonicalPath("/x", "flag&a=1")).toBe("/x?a=1&flag=");
  });
});

describe("sha256Hex", () => {
  it("hashes the empty body to the known sha256 (bwocd's empty-GET body hash)", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
