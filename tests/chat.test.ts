import { describe, expect, it } from "vitest";

import { inputLine, parseEventLine } from "../src/chat/proto";
import { buildChatSpawn, ChatSession } from "../src/chat/session";
import type { ChatEvent } from "../src/chat/proto";

describe("parseEventLine", () => {
  it("parses a tagged event", () => {
    expect(parseEventLine('{"type":"token","text":"hi"}')).toEqual({
      type: "token",
      text: "hi",
    });
  });
  it("ignores blank / non-JSON / untyped lines (forward-compatible)", () => {
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
    expect(parseEventLine("not json")).toBeNull();
    expect(parseEventLine('{"notype":1}')).toBeNull();
  });
});

describe("inputLine", () => {
  it("serializes a ChatInput with a trailing newline", () => {
    expect(inputLine({ type: "user", text: "hi" })).toBe('{"type":"user","text":"hi"}\n');
  });
});

describe("buildChatSpawn", () => {
  it("resolves bwoc-harness beside a full bwoc path", () => {
    const s = buildChatSpawn({
      bwocBinaryPath: "/usr/local/bin/bwoc",
      agentDir: "/ws/agents/a",
      backend: "claude",
      model: "m1",
    });
    expect(s.command).toBe("/usr/local/bin/bwoc-harness");
    expect(s.args).toEqual(["--chat", "--backend", "claude", "--model", "m1"]);
    expect(s.cwd).toBe("/ws/agents/a");
  });
  it("uses a bare bwoc-harness when bwoc is on PATH", () => {
    expect(
      buildChatSpawn({ bwocBinaryPath: "bwoc", agentDir: "/x", backend: "b", model: "m" })
        .command,
    ).toBe("bwoc-harness");
  });
  it("passes --skip-model-check only for the unresolved 'auto' model (B3 mitigation)", () => {
    const auto = buildChatSpawn({ bwocBinaryPath: "bwoc", agentDir: "/x", backend: "b", model: "auto" });
    expect(auto.args).toEqual(["--chat", "--backend", "b", "--model", "auto", "--skip-model-check"]);
    const pinned = buildChatSpawn({ bwocBinaryPath: "bwoc", agentDir: "/x", backend: "b", model: "m1" });
    expect(pinned.args).not.toContain("--skip-model-check");
  });
});

describe("ChatSession", () => {
  it("line-buffers NDJSON stdout into events, even when a line is split across chunks", async () => {
    if (process.platform === "win32") {
      return; // uses /bin/sh to emit the fake stream
    }
    // First printf: a full `ready` line + the START of a `token` line.
    // After a pause, the SECOND printf emits the rest — so the token event
    // arrives split across two stdout chunks, exercising the line buffer.
    const script =
      `printf '{"type":"ready","agent":"a","model":"m","backend":"b","tools":[]}\\n{"type":"to'; ` +
      `sleep 0.05; ` +
      `printf 'ken","text":"hi"}\\n'`;
    const session = new ChatSession({ command: "/bin/sh", args: ["-c", script], cwd: "." });
    const events: ChatEvent[] = [];
    session.onEvent((e) => events.push(e));
    await new Promise<void>((resolve) => {
      session.onExit(() => resolve());
      session.start();
    });
    expect(events.map((e) => e.type)).toEqual(["ready", "token"]);
    expect(events[1]).toEqual({ type: "token", text: "hi" });
  });
});
