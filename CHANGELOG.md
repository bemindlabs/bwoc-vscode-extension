# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-07-19

### Added

The four feature gaps from the post-P5 investigation:

- **Run a task on an agent** — `BWOC: Run Task on Agent` (pick agent → task → progress → output) runs `bwoc run --task … <agent>` headless and captures the result. `send` only appended to an inbox; this actually runs and returns output.
- **Fleet tree context menu** — right-clicking an agent now offers **Chat / Run / Send / Show Detail** (the tree's `contextValue` was previously dead, so every action was palette-only).
- **Chat webview: team & context events + controls** — the chat panel now renders `team_message` and `compacted` (previously silently dropped), and adds a **mode selector** (default / accept_edits / plan / bypass) and a **Forget context** button (the `set_mode` / `forget` inputs were receive-only before).
- **Teams & Tasks view** — a second activity-bar tree of Saṅgha teams → their shared task lists, each task showing **done / claimed / open** state and its claimant. Completes the P5 "teams / tasks" scope that had shipped inbox-only.

## [0.1.1] — 2026-07-19

### Fixed

Six bugs surfaced by an investigation of the rapid P1–P5 build (the local/CLI path was unaffected; these harden the remote / chat / inbox surfaces):

- **bwocd `status()` parsed the response flat** — bwocd's `/agents/:id/status` returns `bwoc status --json` verbatim (`{ workspace, agents: [ … ] }`), so every field silently defaulted (blank remote detail; remote chat spawned with an empty backend/cwd). Now reads `agents[0]` and errors on an empty envelope.
- **bwocd requests had no timeout** — a hung daemon hung `list()`/`status()`/inbox forever. All signed requests now use `AbortSignal.timeout(15s)`, matching the CLI path.
- **Chat subprocess could crash the extension host (EPIPE)** — the `exit` handler now nulls the child, `send()`/`dispose()` guard against an exited child, and a `stdin` error listener swallows EPIPE; the trailing stdout line is flushed on exit.
- **Inbox poller could overlap and race** — an `inFlight` guard skips a tick while one is running, and swallowed poll errors now log to the BWOC output channel.
- **No controller enrollment path** — a fresh key could never be approved, so remote bwocd returned 401 forever. Added `BwocdBackend.enroll()` (POST `/enroll`) and a `BWOC: Enroll Controller` command that shows the controller id + public key (copyable) and self-enrolls.
- **Auto-model chat mitigation** — for `primaryModel: "auto"` agents the harness `--chat` path doesn't resolve the sentinel; the extension now passes `--skip-model-check` and surfaces a note. The real fix is a framework follow-up ([BWOC-Framework #347](https://github.com/bemindlabs/BWOC-Framework/issues/347)).

## [0.1.0] — 2026-07-18

### Added

- **P5 — inbox notifications + publish-ready.** An `InboxWatcher` polls the fleet
  (`bwoc.inbox.pollSeconds`, default 60; 0 disables) and raises a VS Code
  notification when an agent gains inbox messages (pure `diffInbox` never spams
  on priming or on new agents). Marketplace metadata verified + a Publishing guide
  in the README (actual publish needs the operator's publisher PAT).

- **P4 — Copilot integration.** An `@bwoc` chat participant for Copilot Chat
  (`@bwoc /list`, `@bwoc /status <agent>`) streaming fleet info as markdown, and
  a `bwoc-mcp` MCP server provider so the whole workspace becomes callable in
  Copilot agent-mode (server command configurable via `bwoc.mcp.command`). Both
  no-op gracefully on editors without the API. Requires VS Code ^1.101.

- **P3 — streaming chat webview.** `BWOC: Chat with Agent` opens a webview that
  drives a local `bwoc-harness --chat` subprocess over the `chat_proto` NDJSON
  protocol: token streaming, tool calls/results, inline permission prompts
  (Allow/Deny), and mode/turn markers. CSP-locked (nonce) and theme-aware. The
  extension host line-buffers stdout so events split across chunks never drop.

- **P2 (part 2) — command palette.** `BWOC: Send Message to Agent` (QuickPick the
  agent → InputBox the message → `bwoc send`) and a `BWOC: Commands…` action hub,
  with results in a shared **BWOC** output channel. Extends `BwocClient` with
  `send()` (CLI implemented; bwocd remote-send lands with the gated mutation slice).

- **P2 (part 1) — bwocd remote transport.** A signed-HTTP `BwocdBackend` behind
  the same `BwocClient` interface, selected when `bwoc.remote.url` is set (remote
  / tailnet fleets), else the local CLI. Ports the cc-signing wire contract to
  Node (`canonical.ts` byte-identical to the Rust verifier; `signer.ts` uses
  Node Ed25519 with the controller key in VS Code SecretStorage). Golden-vector
  and sign/verify parity tests included. Command palette lands in P2 part 2.
- **P1 — read-only fleet control surface.** Activity-bar **Fleet** tree view over
  `bwoc list --json` with lazy per-agent detail (`bwoc status --json`), a fleet
  status-bar item, and a refresh command. CLI-first transport (`CliBackend`)
  behind a `BwocClient` interface, with workspace auto-detection and configurable
  `bwoc.binaryPath`. bwocd remote transport and Copilot/MCP integration are
  scaffolded for later phases.
