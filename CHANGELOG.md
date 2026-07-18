# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
