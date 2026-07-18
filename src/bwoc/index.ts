import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { CliBackend } from "./cli";
import type { BwocClient } from "./types";

export * from "./types";
export { BwocCliError } from "./cli";

/** Resolve the workspace root: explicit setting → first folder containing
 *  `.bwoc/` → first workspace folder → "" (let bwoc resolve from cwd/env). */
function resolveWorkspace(configured: string): string {
  if (configured.trim()) {
    return configured.trim();
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const withBwoc = folders.find((f) =>
    fs.existsSync(path.join(f.uri.fsPath, ".bwoc")),
  );
  if (withBwoc) {
    return withBwoc.uri.fsPath;
  }
  return folders[0]?.uri.fsPath ?? "";
}

/** Build the active client from settings. P1 is CLI-only; P2 selects a bwocd
 *  backend when `bwoc.remote.url` is set. */
export function createClient(): BwocClient {
  const cfg = vscode.workspace.getConfiguration("bwoc");
  const binaryPath = cfg.get<string>("binaryPath", "bwoc") || "bwoc";
  const workspace = resolveWorkspace(cfg.get<string>("workspace", ""));
  return new CliBackend({ binaryPath, workspace });
}
