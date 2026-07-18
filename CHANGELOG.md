# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **P1 — read-only fleet control surface.** Activity-bar **Fleet** tree view over
  `bwoc list --json` with lazy per-agent detail (`bwoc status --json`), a fleet
  status-bar item, and a refresh command. CLI-first transport (`CliBackend`)
  behind a `BwocClient` interface, with workspace auto-detection and configurable
  `bwoc.binaryPath`. bwocd remote transport and Copilot/MCP integration are
  scaffolded for later phases.
