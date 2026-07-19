import { describe, expect, it } from "vitest";

import { foldHosts, LOCAL_SENTINEL, resolveActiveUrl } from "../src/bwoc/hosts";

describe("foldHosts", () => {
  it("returns [] for no hosts and no legacy url", () => {
    expect(foldHosts([], "")).toEqual([]);
    expect(foldHosts(undefined, undefined)).toEqual([]);
  });

  it("defaults a missing name to the url and trims", () => {
    expect(foldHosts([{ url: "  http://a:1  " }], "")).toEqual([
      { name: "http://a:1", url: "http://a:1" },
    ]);
    expect(foldHosts([{ name: "  Alpha ", url: "http://a:1" }], "")).toEqual([
      { name: "Alpha", url: "http://a:1" },
    ]);
  });

  it("drops blank/invalid entries", () => {
    const hosts = [
      { url: "" },
      { url: "   " },
      { name: "x" } as unknown as { url: string },
      { url: "http://ok:1" },
    ];
    expect(foldHosts(hosts, "")).toEqual([{ name: "http://ok:1", url: "http://ok:1" }]);
  });

  it("prepends the legacy url when not already present", () => {
    expect(foldHosts([{ name: "B", url: "http://b:2" }], "http://legacy:9")).toEqual([
      { name: "http://legacy:9", url: "http://legacy:9" },
      { name: "B", url: "http://b:2" },
    ]);
  });

  it("does not duplicate a legacy url already in the list", () => {
    const out = foldHosts([{ name: "B", url: "http://b:2" }], "http://b:2");
    expect(out).toEqual([{ name: "B", url: "http://b:2" }]);
  });
});

describe("resolveActiveUrl", () => {
  const hosts = [
    { name: "A", url: "http://a:1" },
    { name: "B", url: "http://b:2" },
  ];

  it("returns '' when no hosts are configured", () => {
    expect(resolveActiveUrl([], "")).toBe("");
    expect(resolveActiveUrl([], "http://x:1")).toBe("");
  });

  it("defaults to the first host when nothing is saved", () => {
    expect(resolveActiveUrl(hosts, "")).toBe("http://a:1");
    expect(resolveActiveUrl(hosts, undefined)).toBe("http://a:1");
  });

  it("honours a saved selection that matches a host", () => {
    expect(resolveActiveUrl(hosts, "http://b:2")).toBe("http://b:2");
  });

  it("falls back to the first host when the saved url is stale", () => {
    expect(resolveActiveUrl(hosts, "http://gone:9")).toBe("http://a:1");
  });

  it("forces local when the sentinel is saved, even with hosts", () => {
    expect(resolveActiveUrl(hosts, LOCAL_SENTINEL)).toBe("");
  });
});
