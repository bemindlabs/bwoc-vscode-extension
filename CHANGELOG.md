# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.4] — 2026-08-08

### Fixed

- **Teams & Memory views no longer swallow remote errors.** bwocd now proxies `team list` / `task list` / `memory list` via `/cli`, but the views still discarded every `BwocdError` on the stale "no remote route" rationale — a 401 / timeout / malformed response rendered as a blank panel. They now surface the error like the Fleet view.
- **Local-only LM tools short-circuit on a remote host instead of confirm-then-error.** The daemon-lifecycle + host-diagnostic tools (`#bwocStartAgent`, `StopAgent`, `NewAgent`, `RetireAgent`, `Doctor`, `CheckAgent`) can't run over a remote `bwocd`. They now return a clear "switch to Local CLI" message with **no** scary confirmation, rather than prompting (e.g. retire's "cannot be undone") and then failing.

## [0.9.3] — 2026-08-08

### Fixed

- **Check Agent (backend-neutrality) audited the wrong directory → spurious violations.** The command and the `#bwocCheckAgent` tool pass `bwoc check` a workspace-*relative* agent path, but the CLI was spawned with no `cwd`, so `bwoc check` resolved that path against VS Code's working directory (usually not the workspace) and audited a nonexistent dir. The `bwoc` process now runs with `cwd` set to the workspace, so positional-path verbs like `check` hit the right agent.

## [0.9.2] — 2026-08-08

### Fixed

- **Fleet view showed the wrong state — every agent read "active" even when nothing was running.** The row printed the registry *lifecycle* status (`active`) whenever the agent wasn't running, which reads as "online". It now shows real liveness from `bwoc list`'s pid probe: **`running`** or **`offline`** (the registry status + backend + a "start it" hint moved to the row tooltip). Same honest label in the `@bwoc` chat participant (`⚪ offline`, not `⚪ active`).

## [0.9.1] — 2026-08-08

### Fixed

- **Memory entries now open the real file, not an untitled copy.** Clicking an entry in the **Memory** view opened a fresh unsaved document built from the CLI's output, so edits didn't save back. `bwoc memory list --json` reports `workspace_memory_dir`, so each entry now carries its absolute `path`; `bwoc.openMemory` opens that file with `vscode.open` (like the Agent Profiles slots) — edits save to disk. Falls back to the read-only content view only when the file isn't local (a remote `bwocd` host).

## [0.9.0] — 2026-08-08

### Added

- **JSON schema for `config.manifest.json` — editing an agent's manifest now has autocomplete, hover docs, and inline validation.** A `jsonValidation` contribution binds `schemas/config.manifest.schema.json` to `**/agents/**/config.manifest.json`, so opening a manifest from the **Agent Profiles** view (it was already editable — a click opens the real file) gains field completion, type-checking (e.g. `maxTokens` must be a number, `thinking` a boolean, `autoModels` a string array), and hover descriptions sourced from the framework manifest. The schema is intentionally lenient (`additionalProperties: true`, minimal `required`) so it assists without false-flagging valid files that carry extra sections like `skills`; `bwoc check` remains the source of truth for neutrality + completeness.

## [0.8.0] — 2026-08-08

### Added

**Native Language Model Tools — Copilot agent-mode can now fully manage and control the fleet, no separate `bwoc-mcp` server required.** The extension contributes 20 native tools over the existing `BwocClient`, so Copilot (and `#bwoc*` references in chat) can read *and* drive the fleet directly:

- **Read (auto-invoke):** `#bwocList`, `#bwocAgentStatus`, `#bwocTeams`, `#bwocTeamTasks`, `#bwocMemoryList`, `#bwocMemoryRead`, `#bwocInbox`, `#bwocDoctor`, `#bwocCheckAgent`.
- **Write / control (each behind a user confirmation):** `#bwocSendMessage`, `#bwocBroadcast`, `#bwocRunTask`, `#bwocTaskAdd`, `#bwocTaskClaim`, `#bwocTaskComplete`, `#bwocStartAgent`, `#bwocStopAgent`, `#bwocOutboxFlush`, `#bwocNewAgent`, `#bwocRetireAgent`.
- Anything that changes the fleet asks the user to confirm first (`prepareInvocation` → `confirmationMessages`); reads run without a prompt. Results come back as friendly Markdown (state icons, agent ids, task marks).
- `BwocClient` gained `broadcast(message, team?)` (`bwoc send --all` / `--team`) and `outboxFlush(peer?)` (`bwoc outbox flush`), wired on both the local-CLI and remote-`bwocd` backends.
- The `@bwoc` chat participant got a warmer capability hint that points at the new tools.

## [0.7.0] — 2026-07-25

### Added

Agent-authoring / lifecycle-management actions (the remaining CLI gaps that fit a fleet control surface):

- **Check (backend-neutrality).** Fleet + **Agent Profiles** context menu (and palette) runs `bwoc check <agent-path> --json` and renders the neutrality audit (violations + passes) in a document. Tolerates the non-zero exit `check` returns when there are violations (the JSON report is still emitted). Natural on the Profiles view for agent authors.
- **New Agent (incarnate).** `BWOC: New Agent` prompts a name + backend and runs `bwoc new <name> --backend <backend>` (the workspace resolves the default target/template), then refreshes the fleet.
- **Retire Agent.** Fleet context menu (and palette), behind a **modal** confirmation, runs `bwoc retire <name> --yes --json` to remove an agent from the registry + files, then refreshes.
- All three are local-CLI only (not in bwocd's `/cli` allowlist); a remote host surfaces a clear "switch to Local CLI" note.

The operator-action gaps between the extension and the `bwoc` CLI — the surface was read-heavy (view fleet/teams/memory) but couldn't drive the common day-to-day actions:

- **Agent lifecycle — Start / Stop daemon.** Fleet tree context menu (and palette) run `bwoc start` / `bwoc stop` (`--yes --json`) to spawn/stop an agent's `bwoc-agent --serve` daemon, then refresh the fleet. Local-CLI only (lifecycle isn't in bwocd's `/cli` capability allowlist; a remote host reports a clear "switch to Local CLI" note).
- **View Inbox.** Fleet context menu (and palette) opens an agent's queued inbox messages (`bwoc inbox <id> --json`) in a markdown document — complements the existing inbox *notifications*, which only alerted. Works remotely too, over bwocd's dedicated `GET /agents/:id/inbox` route.
- **Task actions.** Teams view context menu: **Add Task** (on a team), **Claim** (on an open task), **Complete** (on a claimed task) — `bwoc task add/claim/complete`, over the local CLI or bwocd's capability-gated `/cli` (write). The Teams view was read-only before.
- **Doctor.** `BWOC: Doctor` runs `bwoc doctor --json` and renders the environment/workspace diagnosis in a document. Local-CLI only.


## [0.6.0] — 2026-07-20

### Added

- **Multi-host fleet switching** — `bwoc.remote.hosts` (a list of `{ name, url }` bwocd daemons) plus a **BWOC: Switch Fleet Host** command (also a Fleet view-title button) let you target more than one fleet and switch the active one from a QuickPick; the selection persists across sessions and rebinds every view. The legacy single `bwoc.remote.url` folds in as an unnamed host, so existing settings resolve unchanged, and **Local CLI** is always a switch target. The status bar now names the active fleet in its tooltip. Completes the multi-host half of #13 (the `/whoami` enrolled/caps half shipped in 0.3.0).

## [0.5.0] — 2026-07-20

### Added

- **Agent Profiles view** — a fourth activity-bar tree that opens each agent's editable profile slots: expand an agent to see its `persona/`, `mindsets/`, `skills/`, `memories/`, `interconnect/` slot dirs (only those with editable files) plus top-level `config.manifest.json` / `AGENTS.md` / `MEMORY.md`; clicking any file opens it in the editor. Files are read from the local `<workspace>/agents/<id>/` (via `bwoc list` for the agent set), backend symlinks and non-editable clutter hidden — this surfaces the *profile*, not the whole directory.

## [0.4.0] — 2026-07-19

### Added

- **Remote fleets are no longer read-only.** `send`, `teams`, `tasks`, and `memory` now work over a remote `bwocd` host via its capability-gated `POST /cli` proxy (the extension posts the verb argv; bwocd runs it capability-gated and the same parsers map the returned stdout). Combined with remote `run` (v0.3.x, via `POST /agents/:id/chat`), **every fleet action now works over the tailnet**, not just locally. A missing capability or unenrolled controller surfaces the enroll guidance. Requires a `bwocd` build that includes `/cli` (bemindlabs/bwoc-control-center#33).

## [0.3.0] — 2026-07-19

### Added

- **Memory board view** — a third activity-bar tree listing workspace memory entries (`.bwoc/memory/`) with size; clicking one opens its contents in a markdown document. Completes the P5 "memory boards" scope.
- **Remote status / who-am-I** — `BWOC: Remote Status / Who Am I` calls bwocd `/whoami` to show the controller's approved id + capabilities, and now distinguishes "not enrolled" (401/403, actionable) from "host unreachable" instead of collapsing both into one generic error.

### Changed

- **Test/CI hardening** — a bwocd signed-HTTP **round-trip test** (a real `http.Server` Ed25519-verifies the request exactly as bwocd's Rust verifier would, then the backend maps the response — this would have caught the B1 status mis-parse), plus an **ESLint gate** and report-only **v8 coverage** wired into CI.

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
