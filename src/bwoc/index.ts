import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { BwocdBackend } from "./bwocd";
import { CliBackend } from "./cli";
import {
  ACTIVE_HOST_KEY,
  type FoldedHost,
  foldHosts,
  type RemoteHost,
  resolveActiveUrl,
} from "./hosts";
import { Signer } from "./signer";
import type { BwocClient } from "./types";

export * from "./types";
export { BwocCliError } from "./cli";
export { BwocdBackend, BwocdError } from "./bwocd";
export { ACTIVE_HOST_KEY, LOCAL_SENTINEL, type FoldedHost } from "./hosts";

/** The active workspace root using the same resolution as the CLI backend:
 *  `bwoc.workspace` setting → first folder with `.bwoc/` → first folder → "".
 *  Exposed for callers (e.g. the chat command) that need the agent directory. */
export function activeWorkspaceRoot(): string {
  const cfg = vscode.workspace.getConfiguration("bwoc");
  return resolveWorkspace(cfg.get<string>("workspace", ""));
}

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

/** The folded, deduped list of remote fleet hosts (configured `remote.hosts` +
 *  the legacy single `remote.url`). Empty means CLI-only. */
export function remoteHosts(): FoldedHost[] {
  const cfg = vscode.workspace.getConfiguration("bwoc");
  return foldHosts(cfg.get<RemoteHost[]>("remote.hosts", []), cfg.get<string>("remote.url", ""));
}

/** The active remote url ("" = local CLI), from the folded host list + the
 *  operator's persisted selection (globalState). */
export function activeRemoteUrl(context: vscode.ExtensionContext): string {
  return resolveActiveUrl(remoteHosts(), context.globalState.get<string>(ACTIVE_HOST_KEY, ""));
}

/** Build the active client: a signed-HTTP bwocd backend when a remote host is
 *  active (from `remote.hosts`/`remote.url` + the selected host), otherwise the
 *  local CLI. `context` supplies SecretStorage (the controller private key) and
 *  globalState (the controller id + public key, and the active-host selection). */
export function createClient(context: vscode.ExtensionContext): BwocClient {
  const cfg = vscode.workspace.getConfiguration("bwoc");
  const remote = activeRemoteUrl(context);
  if (remote) {
    const signer = new Signer(context.secrets, {
      get: (k) => context.globalState.get<string>(k),
      update: (k, v) => context.globalState.update(k, v),
    });
    return new BwocdBackend(remote, signer);
  }
  const binaryPath = cfg.get<string>("binaryPath", "bwoc") || "bwoc";
  const workspace = resolveWorkspace(cfg.get<string>("workspace", ""));
  return new CliBackend({ binaryPath, workspace });
}
