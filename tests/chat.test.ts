import { describe, expect, it } from "vitest";

import { inputLine, isChatInput, parseEventLine } from "../src/chat/proto";
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
  it("treats forward-slash paths as paths and keeps a Windows .exe", () => {
    const at = (bwocBinaryPath: string) =>
      buildChatSpawn({ bwocBinaryPath, agentDir: "/x", backend: "b", model: "m" }).command;
    expect(at("C:/tools/bwoc.exe")).toBe("C:/tools/bwoc-harness.exe");
    expect(at("C:\\tools\\bwoc.EXE")).toBe("C:\\tools\\bwoc-harness.EXE");
    expect(at("bwoc.exe")).toBe("bwoc-harness.exe");
    expect(at("./bin/bwoc")).toBe("./bin/bwoc-harness");
  });
  it("passes --skip-model-check only for the unresolved 'auto' model (B3 mitigation)", () => {
    const auto = buildChatSpawn({ bwocBinaryPath: "bwoc", agentDir: "/x", backend: "b", model: "auto" });
    expect(auto.args).toEqual(["--chat", "--backend", "b", "--model", "auto", "--skip-model-check"]);
    const pinned = buildChatSpawn({ bwocBinaryPath: "bwoc", agentDir: "/x", backend: "b", model: "m1" });
    expect(pinned.args).not.toContain("--skip-model-check");
  });
});

describe("isChatInput", () => {
  it("accepts typed objects only", () => {
    expect(isChatInput({ type: "user", text: "hi" })).toBe(true);
    expect(isChatInput(null)).toBe(false);
    expect(isChatInput("user")).toBe(false);
    expect(isChatInput({ text: "hi" })).toBe(false);
    expect(isChatInput({ type: 1 })).toBe(false);
  });
});

/** Run `script` under the current Node as a fake harness; collect what the session emits. */
async function runFake(script: string): Promise<{ events: ChatEvent[]; stderr: string[] }> {
  const session = new ChatSession({ command: process.execPath, args: ["-e", script], cwd: "." });
  const events: ChatEvent[] = [];
  const stderr: string[] = [];
  session.onEvent((e) => events.push(e));
  session.onStderr((l) => stderr.push(l));
  await new Promise<void>((resolve) => {
    session.onExit(() => resolve());
    session.start();
  });
  return { events, stderr };
}

describe("ChatSession", () => {
  it("line-buffers NDJSON stdout into events, even when a line is split across chunks", async () => {
    // First write: a full `ready` line + the START of a `token` line. After a
    // pause the second write emits the rest — so the token event arrives split
    // across two stdout chunks, exercising the line buffer.
    const script =
      `process.stdout.write('{"type":"ready","agent":"a","model":"m","backend":"b","tools":[]}\\n{"type":"to');` +
      `setTimeout(() => process.stdout.write('ken","text":"hi"}\\n'), 50);`;
    const { events } = await runFake(script);
    expect(events.map((e) => e.type)).toEqual(["ready", "token"]);
    expect(events[1]).toEqual({ type: "token", text: "hi" });
  });

  it("flushes a final stdout line without a newline before reporting exit", async () => {
    const { events } = await runFake(`process.stdout.write('{"type":"bye"}');`);
    expect(events).toEqual([{ type: "bye" }]);
  });

  it("line-buffers stderr so a split line is emitted once, whole", async () => {
    const script =
      `process.stderr.write('first half ');` +
      `setTimeout(() => process.stderr.write('second half\\ntail'), 50);`;
    const { stderr } = await runFake(script);
    expect(stderr).toEqual(["first half second half", "tail"]);
  });

  it("send() after the child exited is a silent no-op", async () => {
    const session = new ChatSession({ command: process.execPath, args: ["-e", ""], cwd: "." });
    await new Promise<void>((resolve) => {
      session.onExit(() => resolve());
      session.start();
    });
    expect(() => session.send({ type: "user", text: "late" })).not.toThrow();
  });
});
