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
`bwocd` backend (for remote / tailnet fleets) and Copilot / MCP integration slot in later
without touching the views.

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

## Settings

| Key | Default | Purpose |
| --- | --- | --- |
| `bwoc.binaryPath` | `bwoc` | Path to the `bwoc` CLI binary |
| `bwoc.workspace` | *(auto)* | Workspace root; empty = first folder with `.bwoc/` |
| `bwoc.remote.url` | *(empty)* | Reserved for P2 — `bwocd` URL for remote fleets |

## Status — phased

| Phase | Scope | State |
| --- | --- | --- |
| **P1** | Read-only fleet tree + agent detail + status bar, over the local `bwoc` CLI | ✅ this scaffold |
| P2 | Command palette over `--json` verbs + `bwocd` signed-HTTP remote transport | planned |
| P3 | Streaming agent chat webview (`chat_proto` NDJSON) + permission prompts | planned |
| P4 | `@bwoc` Copilot chat participant + MCP server registration | planned |
| P5 | Teams / tasks / memory boards + inbox notifications + Marketplace publish | planned |

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest — pure --json parsers
pnpm build       # esbuild bundle → dist/extension.js
pnpm package     # vsce package → .vsix
```

---

<div align="center">
<sub>Owner: <code>agent-qianliyan</code> · part of the <a href="https://github.com/bemindlabs">BWOC</a> fleet-control family.</sub>
</div>
