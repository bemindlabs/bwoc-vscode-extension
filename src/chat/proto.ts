// TS mirror of bwoc_core::chat_proto (bwoc-framework/crates/bwoc-core/src/chat_proto.rs),
// via the chrome-extension's chat-proto.ts. Internally-tagged on `type`. Unknown
// variants MUST be ignored (forward-compatible) — the harness skips unknown
// ChatInput and clients skip unknown ChatEvent.

export type ChatEvent =
  | { type: "ready"; agent: string; model: string; backend: string; tools: string[] }
  | { type: "token"; text: string }
  | { type: "message"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string }
  | { type: "permission_request"; id: string; tool: string; detail: string }
  | { type: "mode_changed"; mode: string }
  | { type: "turn_end"; prompt_tokens?: number; completion_tokens?: number }
  | { type: "team_message"; from: string; text: string; ts: string }
  | { type: "compacted"; removed: number }
  | { type: "error"; message: string }
  | { type: "bye" };

export type ChatInput =
  | { type: "user"; text: string; principal?: string }
  | { type: "permission"; id: string; allow: boolean }
  | { type: "set_mode"; mode: "default" | "accept_edits" | "bypass" | "plan" }
  | { type: "forget" }
  | { type: "quit" };

/** Parse one stdout line into a ChatEvent, or null for blank/garbage/unknown
 *  (forward-compatible: a well-formed object with a string `type` is accepted). */
export function parseEventLine(line: string): ChatEvent | null {
  const t = line.trim();
  if (!t) {
    return null;
  }
  try {
    const v = JSON.parse(t) as { type?: unknown };
    return v && typeof v.type === "string" ? (v as ChatEvent) : null;
  } catch {
    return null;
  }
}

/** Serialize a ChatInput to a single newline-terminated stdin line. */
export function inputLine(input: ChatInput): string {
  return `${JSON.stringify(input)}\n`;
}
