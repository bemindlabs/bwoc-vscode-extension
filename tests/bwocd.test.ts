import { describe, expect, it } from "vitest";

import { BwocdBackend } from "../src/bwoc/bwocd";
import { Signer } from "../src/bwoc/signer";

const dummySigner = new Signer(
  { get: async () => undefined, store: async () => {} },
  { get: () => undefined, update: async () => {} },
);

describe("BwocdBackend.send", () => {
  it("rejects with a clear message — remote send is not wired yet", async () => {
    const b = new BwocdBackend("http://127.0.0.1:9", dummySigner);
    await expect(b.send("agent-x", "hi")).rejects.toThrow(/not supported yet/i);
  });
});
