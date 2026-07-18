import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { BwocdBackend } from "./bwocd";
import { CliBackend } from "./cli";
import { Signer } from "./signer";
import type { BwocClient } from "./types";

export * from "./types";
export { BwocCliError } from "./cli";
export { BwocdError } from "./bwocd";

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

/** Build the active client from settings: a signed-HTTP bwocd backend when
 *  `bwoc.remote.url` is set (remote / tailnet fleets), otherwise the local CLI.
 *  `context` supplies SecretStorage (the controller private key) and globalState
 *  (the controller id + public key) for the bwocd signer. */
export function createClient(context: vscode.ExtensionContext): BwocClient {
  const cfg = vscode.workspace.getConfiguration("bwoc");
  const remote = (cfg.get<string>("remote.url", "") || "").trim();
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
