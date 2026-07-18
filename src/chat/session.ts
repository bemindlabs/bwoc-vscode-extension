import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as path from "node:path";

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
  const command =
    bin === "bwoc" || !bin.includes(path.sep)
      ? "bwoc-harness"
      : path.join(path.dirname(bin), "bwoc-harness");
  return {
    command,
    args: ["--chat", "--backend", cfg.backend, "--model", cfg.model],
    cwd: cfg.agentDir,
  };
}

/**
 * Drives one `bwoc-harness --chat` subprocess: parses its stdout NDJSON into
 * [`ChatEvent`]s and forwards [`ChatInput`] to its stdin. Line-buffers partial
 * reads so a chunk split mid-line never drops an event.
 */
export class ChatSession {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuf = "";
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
    child.stderr.on("data", (d: string) => {
      for (const line of d.split("\n")) {
        if (line.trim()) {
          this.emitter.emit("stderr", line);
        }
      }
    });
    child.on("error", (e) =>
      this.emitter.emit("event", {
        type: "error",
        message: `${command} error: ${e.message}`,
      } satisfies ChatEvent),
    );
    child.on("exit", (code) => this.emitter.emit("exit", code));
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

  send(input: ChatInput): void {
    this.child?.stdin.write(inputLine(input));
  }

  dispose(): void {
    if (this.child) {
      this.send({ type: "quit" });
      this.child.stdin.end();
      this.child.kill();
      this.child = undefined;
    }
    this.emitter.removeAllListeners();
  }
}
