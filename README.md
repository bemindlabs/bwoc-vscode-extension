<div align="center">

# 🛰️ bwoc-vscode-extension

**Operate your whole BWOC agent fleet from VS Code.**

A native VS Code extension that drives the [`bwoc`](https://github.com/bemindlabs/BWOC-Framework)
CLI — a live fleet tree, per-agent detail, and a status-bar pulse, right in the editor.
Because the extension host is Node, it execs `bwoc … --json` directly; no daemon needed
for a local workspace.

[![CI](https://github.com/bemindlabs/bwoc-vscode-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/bemindlabs/bwoc-vscode-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## How it works

Unlike the [browser extension](https://github.com/bemindlabs/bwoc-chrome-extension) (which
must proxy through `bwocd`), the VS Code host can run the CLI itself. P1 is **CLI-first**:

```
Activity Bar ── TreeDataProvider ──▶ execFile `bwoc list|status --json`
  (Fleet view + status bar)          (cwd = detected BWOC workspace)
```

The transport lives behind a single `BwocClient` interface (`src/bwoc/`), so a signed-HTTP
`bwocd` backend (for remote / tailnet fleets) and the Copilot integration are layered on top
without touching the views.

## Copilot agent-mode: drive the fleet with tools

The extension contributes **native VS Code Language Model Tools**, so **Copilot agent-mode
can fully manage and control the fleet** — no separate `bwoc-mcp` server required. Ask in
plain language, or `#`-reference a tool directly:

- **Read (run automatically):** `#bwocList`, `#bwocAgentStatus`, `#bwocTeams`,
  `#bwocTeamTasks`, `#bwocMemoryList`, `#bwocMemoryRead`, `#bwocInbox`, `#bwocDoctor`,
  `#bwocCheckAgent`.
- **Write / control (ask you to confirm first):** `#bwocSendMessage`, `#bwocBroadcast`,
  `#bwocRunTask`, `#bwocTaskAdd` / `Claim` / `Complete`, `#bwocStartAgent` / `StopAgent`,
  `#bwocOutboxFlush`, `#bwocNewAgent`, `#bwocRetireAgent`.

Each tool wraps the same `bwoc` CLI the views use, so it works against a local workspace out
of the box. (The standalone `bwoc-mcp` MCP server is still offered for editors that prefer
MCP.)

## Setup

1. **Build + run the extension:**
   ```bash
   pnpm install && pnpm build
   ```
   Press <kbd>F5</kbd> in VS Code (Run → *Start Debugging*) to launch an Extension
   Development Host with the extension loaded.

2. **Open a BWOC workspace** (a folder containing `.bwoc/`). The **BWOC** icon appears in
   the Activity Bar; the **Fleet** view lists every agent with a live health dot. Expand an
   agent for its detail, or click it to open the full `bwoc status` JSON.

3. **If `bwoc` isn't on `PATH`**, set `bwoc.binaryPath` (and optionally `bwoc.workspace`)
   in Settings.

4. **Edit agent config** from the **Agent Profiles** view — click `config.manifest.json`
   (or `AGENTS.md`, persona/mindset/skill files) to open the real file. Manifests get JSON
   **autocomplete, hover docs, and inline validation** from a bundled schema; `bwoc check`
   stays the source of truth for backend-neutrality.

## Settings

| Key | Default | Purpose |
| --- | --- | --- |
| `bwoc.binaryPath` | `bwoc` | Path to the `bwoc` CLI binary |
| `bwoc.workspace` | *(auto)* | Workspace root; empty = first folder with `.bwoc/` |
| `bwoc.remote.url` | *(empty)* | Single `bwocd` URL for a remote / tailnet fleet; empty = local CLI |
| `bwoc.remote.hosts` | `[]` | Multiple `{ name, url }` fleets to switch between (**BWOC: Switch Fleet Host**); `remote.url` folds in |
| `bwoc.mcp.command` | `bwoc-mcp` | Command that launches the `bwoc-mcp` server for Copilot agent-mode |
| `bwoc.inbox.pollSeconds` | `60` | Inbox-notification poll interval; `0` disables |

## Status — phased

| Phase | Scope | State |
| --- | --- | --- |
| **P1** | Read-only fleet tree + agent detail + status bar, over the local `bwoc` CLI | ✅ |
| **P2** | Command palette (send message) + `bwocd` signed-HTTP remote transport | ✅ |
| **P3** | Streaming agent chat webview (`chat_proto` NDJSON) + permission prompts | ✅ |
| **P4** | `@bwoc` Copilot chat participant + `bwoc-mcp` server registration | ✅ |
| **P5** | Inbox notifications (Marketplace: publish-ready, not yet published — needs a PAT) | 🟡 |
| **P6** | Operator + agent-authoring actions — Start/Stop daemon, View Inbox, Task add/claim/complete, Doctor, Check, New Agent, Retire (v0.7.0) | ✅ |

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest — pure logic (parsers, signing, chat proto, formatters)
pnpm build       # esbuild bundle → dist/extension.js
pnpm package     # vsce package → .vsix
```

### Publishing

The extension is publish-ready (`publisher`, `repository`, `license`, and
`engines` are set; `pnpm package` produces a clean `.vsix`). Publishing to the
Marketplace needs a **`bemindlabs` publisher Personal Access Token** — an
operator step, not automated:

```bash
pnpm package                         # sanity-check the .vsix
npx vsce login bemindlabs            # once, with the PAT
npx vsce publish                     # or: npx vsce publish patch
```

---

<div align="center">
<sub>Owner: <code>agent-qianliyan</code> · part of the <a href="https://github.com/bemindlabs">BWOC</a> fleet-control family.</sub>
</div>
