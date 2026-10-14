import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { type ChatEvent, type ChatInput, inputLine, parseEventLine } from "./proto";

/** A spawn spec for the chat subprocess. Kept generic (command/args/cwd) so the
 *  flag-building is a separate pure function and the session is testable with a
 *  fake NDJSON emitter. */
export interface ChatSpawn {
  command: string;
  args: string[];
  cwd: string;
}

/** Where to resolve the chat backend for one agent. */
export interface ChatConfig {
  /** Path to the `bwoc` CLI (from `bwoc.binaryPath`) — the harness sits beside it. */
  bwocBinaryPath: string;
  /** Absolute agent directory; becomes the harness cwd (it reads the agent from cwd). */
  agentDir: string;
  backend: string;
  model: string;
}

/** Build the `bwoc-harness --chat` spawn spec. The harness binary lives beside
 *  `bwoc` (same dir, or on PATH when `bwoc` is bare). Pure + unit-tested. */
export function buildChatSpawn(cfg: ChatConfig): ChatSpawn {
  const bin = cfg.bwocBinaryPath || "bwoc";
  // Either separator counts as a path (Windows accepts both); keep a Windows
  // `.exe` so `…\bwoc.exe` resolves `…\bwoc-harness.exe`.
  const dir = bin.slice(0, Math.max(bin.lastIndexOf("/"), bin.lastIndexOf("\\")) + 1);
  const ext = /\.exe$/i.test(bin) ? bin.slice(-4) : "";
  const command = `${dir}bwoc-harness${ext}`;
  const args = ["--chat", "--backend", cfg.backend, "--model", cfg.model];
  // B3 mitigation: the harness --chat path validates the raw model string and
  // does NOT resolve "auto" the way the batch path does, so an auto-model agent
  // fails to start. Skip the check here so chat launches. FRAMEWORK FOLLOW-UP:
  // teach bwoc-harness --chat to resolve "auto" like the batch path (then this
  // special-case can be dropped).
  if (cfg.model === "auto") {
    args.push("--skip-model-check");
  }
  return { command, args, cwd: cfg.agentDir };
}

/**
 * Drives one `bwoc-harness --chat` subprocess: parses its stdout NDJSON into
 * [`ChatEvent`]s and forwards [`ChatInput`] to its stdin. Line-buffers partial
 * reads so a chunk split mid-line never drops an event.
 */
export class ChatSession {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuf = "";
  private stderrBuf = "";
  private readonly emitter = new EventEmitter();

  constructor(private readonly spawnSpec: ChatSpawn) {}

  onEvent(fn: (e: ChatEvent) => void): void {
    this.emitter.on("event", fn);
  }
  onStderr(fn: (line: string) => void): void {
    this.emitter.on("stderr", fn);
  }
  onExit(fn: (code: number | null) => void): void {
    this.emitter.on("exit", fn);
  }

  start(): void {
    const { command, args, cwd } = this.spawnSpec;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, { cwd });
    } catch (e) {
      this.emitter.emit("event", {
        type: "error",
        message: `failed to launch ${command}: ${(e as Error).message}`,
      } satisfies ChatEvent);
      return;
    }
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => this.ingest(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => this.ingestStderr(d));
    // Swallow stdin stream errors (e.g. EPIPE when the child exits mid-write):
    // an unhandled 'error' on stdin would crash the extension host. send() and
    // dispose() are already guarded, but a write racing the exit lands here.
    child.stdin.on("error", () => {});
    child.on("error", (e) =>
      this.emitter.emit("event", {
        type: "error",
        message: `${command} error: ${e.message}`,
      } satisfies ChatEvent),
    );
    child.on("exit", () => {
      // Drop the handle at once so send()/dispose() never write to closed stdin.
      if (this.child === child) {
        this.child = undefined;
      }
    });
    child.on("close", (code) => {
      // Streams are only guaranteed drained on "close" (not "exit"): flush any
      // trailing non-newline output first so a final event isn't lost.
      this.flushTail();
      this.emitter.emit("exit", code);
    });
  }

  /** Feed a stdout chunk through the line buffer, emitting each complete event. */
  private ingest(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, nl);
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      const ev = parseEventLine(line);
      if (ev) {
        this.emitter.emit("event", ev);
      }
    }
  }

  /** Line-buffer stderr the same way, so a long line split across chunks is
   *  emitted once, whole. */
  private ingestStderr(chunk: string): void {
    this.stderrBuf += chunk;
    let nl: number;
    while ((nl = this.stderrBuf.indexOf("\n")) !== -1) {
      this.emitStderr(this.stderrBuf.slice(0, nl));
      this.stderrBuf = this.stderrBuf.slice(nl + 1);
    }
  }

  private emitStderr(line: string): void {
    if (line.trim()) {
      this.emitter.emit("stderr", line);
    }
  }

  /** Emit any buffered, non-newline-terminated final lines (called on close). */
  private flushTail(): void {
    const line = this.stdoutBuf;
    this.stdoutBuf = "";
    if (line) {
      const ev = parseEventLine(line);
      if (ev) {
        this.emitter.emit("event", ev);
      }
    }
    const err = this.stderrBuf;
    this.stderrBuf = "";
    this.emitStderr(err);
  }

  /** True while the child is live and its stdin is safe to write. */
  private isWritable(): boolean {
    const c = this.child;
    return (
      !!c && c.exitCode === null && !c.killed && c.stdin.writable && !c.stdin.destroyed
    );
  }

  send(input: ChatInput): void {
    if (!this.isWritable()) {
      return; // child has exited — writing would raise EPIPE.
    }
    try {
      this.child?.stdin.write(inputLine(input));
    } catch (e) {
      // A write racing the child's exit can still throw synchronously; report
      // it in the chat instead of crashing the extension host.
      this.emitter.emit("event", {
        type: "error",
        message: `could not send to the chat process: ${(e as Error).message}`,
      } satisfies ChatEvent);
    }
  }

  dispose(): void {
    const child = this.child;
    this.child = undefined;
    if (child) {
      if (child.exitCode === null && !child.killed) {
        // Ask the harness to quit, then close stdin and reap. Guarded so a
        // stdin already torn down by the child's exit can't throw EPIPE.
        try {
          child.stdin.write(inputLine({ type: "quit" }));
          child.stdin.end();
        } catch {
          /* stdin already closed */
        }
        child.kill();
      }
    }
    this.emitter.removeAllListeners();
  }
}
