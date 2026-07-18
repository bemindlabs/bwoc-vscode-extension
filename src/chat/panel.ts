import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { ChatSession } from "./session";

/** One live chat webview bound to one ChatSession (one agent). */
export class ChatPanel {
  private readonly panel: vscode.WebviewPanel;

  constructor(agent: string, session: ChatSession) {
    this.panel = vscode.window.createWebviewPanel(
      "bwocChat",
      `BWOC · ${agent}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = renderHtml(agent);

    // ext → webview: every ChatEvent, plus stderr as a diagnostic line.
    session.onEvent((e) => void this.panel.webview.postMessage(e));
    session.onStderr((line) => void this.panel.webview.postMessage({ type: "stderr", line }));
    session.onExit((code) =>
      void this.panel.webview.postMessage({ type: "exit", code }),
    );

    // webview → ext: ChatInput (user text, permission answer, mode, quit).
    this.panel.webview.onDidReceiveMessage((msg) => session.send(msg));

    this.panel.onDidDispose(() => session.dispose());
    session.start();
  }

  reveal(): void {
    this.panel.reveal();
  }
}

function renderHtml(agent: string): string {
  const nonce = randomBytes(16).toString("hex");
  const csp = [
    `default-src 'none'`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
  #log { flex: 1; overflow-y: auto; padding: 10px; }
  .msg { margin: 6px 0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  .user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .assistant { background: var(--vscode-editorWidget-background); }
  .tool { font-size: 0.85em; opacity: 0.85; border-left: 3px solid var(--vscode-charts-blue); padding-left: 8px; }
  .err { color: var(--vscode-errorForeground); }
  .sys { font-size: 0.8em; opacity: 0.6; }
  .perm { background: var(--vscode-inputValidation-warningBackground, #5a4a00); padding: 8px 10px; border-radius: 6px; margin: 6px 0; }
  .perm button { margin-right: 6px; }
  #toolbar { display: flex; gap: 10px; align-items: center; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border); font-size: 0.85em; opacity: 0.9; }
  #toolbar select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, #0000); border-radius: 4px; padding: 2px 4px; font: inherit; }
  #bar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
           border: 1px solid var(--vscode-input-border, #0000); padding: 6px 8px; border-radius: 4px; font: inherit; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: 0; padding: 6px 12px; border-radius: 4px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div id="log"><div class="sys">Starting chat with ${escapeHtml(agent)}…</div></div>
  <div id="toolbar">
    <label>mode
      <select id="mode">
        <option value="default">default</option>
        <option value="accept_edits">accept edits</option>
        <option value="plan">plan</option>
        <option value="bypass">bypass</option>
      </select>
    </label>
    <button id="forget" title="Reset the conversation context">Forget context</button>
  </div>
  <div id="bar">
    <input id="input" type="text" placeholder="Message ${escapeHtml(agent)}… (Enter to send)" autofocus />
    <button id="send">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  let current = null; // the in-progress assistant bubble for token streaming

  function add(cls, text) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function send() {
    const text = input.value.trim();
    if (!text) return;
    add("user", text);
    vscode.postMessage({ type: "user", text });
    input.value = "";
    current = null;
  }
  document.getElementById("send").addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  document.getElementById("mode").addEventListener("change", (e) => {
    vscode.postMessage({ type: "set_mode", mode: e.target.value });
  });
  document.getElementById("forget").addEventListener("click", () => {
    vscode.postMessage({ type: "forget" });
    add("sys", "context forget requested");
    current = null;
  });

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    switch (m.type) {
      case "ready": add("sys", "ready · " + m.model + " (" + m.backend + ") · " + (m.tools||[]).length + " tools"); break;
      case "token":
        if (!current) current = add("assistant", "");
        current.textContent += m.text; log.scrollTop = log.scrollHeight; break;
      case "message":
        if (current) { current.textContent = m.text; current = null; } else add("assistant", m.text); break;
      case "tool_call": add("tool", "→ " + m.name + " " + JSON.stringify(m.args)); break;
      case "tool_result": add("tool", (m.ok ? "✓ " : "✗ ") + m.name + ": " + m.output); break;
      case "permission_request": {
        const p = document.createElement("div");
        p.className = "perm";
        p.textContent = "Allow " + m.tool + "? " + (m.detail||"");
        const yes = document.createElement("button"); yes.textContent = "Allow";
        const no = document.createElement("button"); no.textContent = "Deny";
        yes.addEventListener("click", () => { vscode.postMessage({ type: "permission", id: m.id, allow: true }); p.remove(); });
        no.addEventListener("click", () => { vscode.postMessage({ type: "permission", id: m.id, allow: false }); p.remove(); });
        p.appendChild(document.createElement("br")); p.appendChild(yes); p.appendChild(no);
        log.appendChild(p); log.scrollTop = log.scrollHeight; break;
      }
      case "mode_changed": add("sys", "mode → " + m.mode); break;
      case "team_message": add("sys", "👥 " + m.from + ": " + m.text); break;
      case "compacted": add("sys", "context compacted — removed " + m.removed + " message(s)"); break;
      case "turn_end": current = null; break;
      case "error": add("err", "error: " + m.message); break;
      case "stderr": add("sys", m.line); break;
      case "bye": case "exit": add("sys", "session ended"); input.disabled = true; break;
    }
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
