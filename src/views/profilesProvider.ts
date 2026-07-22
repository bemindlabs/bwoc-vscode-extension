import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { activeWorkspaceRoot, BwocCliError, type BwocClient } from "../bwoc";

/** The profile slots worth surfacing for editing (in display order). Backend
 *  symlinks (CLAUDE.md → AGENTS.md, …), `.bwoc/`, docs, scripts, connectors are
 *  intentionally hidden — this is the *profile*, not the whole directory. */
const SLOT_DIRS = ["persona", "mindsets", "skills", "memories", "interconnect"];
const TOP_FILES = ["config.manifest.json", "AGENTS.md", "MEMORY.md"];
const EDITABLE = /\.(md|json|toml|ya?ml)$/i;

type ProfileNode =
  | { kind: "agent"; id: string; dir: string }
  | { kind: "dir"; label: string; dir: string }
  | { kind: "file"; label: string; file: string };

/** Tree of each agent's editable profile slots (persona/mindsets/skills/… +
 *  config.manifest.json / AGENTS.md). Clicking a file opens it in the editor.
 *  Local-workspace only — the files live under `<workspace>/agents/<id>/`. */
export class ProfilesProvider implements vscode.TreeDataProvider<ProfileNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: BwocClient) {}

  setClient(client: BwocClient): void {
    this.client = client;
    this.refresh();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: ProfileNode): vscode.TreeItem {
    if (node.kind === "agent") {
      const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("person");
      item.contextValue = "bwocProfileAgent";
      return item;
    }
    if (node.kind === "dir") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("folder");
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(node.file);
    item.command = {
      command: "vscode.open",
      title: "Edit",
      arguments: [vscode.Uri.file(node.file)],
    };
    return item;
  }

  async getChildren(node?: ProfileNode): Promise<ProfileNode[]> {
    if (!node) {
      const root = activeWorkspaceRoot();
      if (!root) {
        return [];
      }
      let agents;
      try {
        agents = await this.client.list();
      } catch (err) {
        const msg = err instanceof BwocCliError ? err.message : String(err);
        vscode.window.showErrorMessage(`BWOC: ${msg}`);
        return [];
      }
      return agents
        .map((a) => ({ kind: "agent" as const, id: a.id, dir: path.join(root, a.path) }))
        .filter((n) => isDir(n.dir));
    }

    if (node.kind === "agent") {
      const out: ProfileNode[] = [];
      for (const d of SLOT_DIRS) {
        const p = path.join(node.dir, d);
        if (isDir(p) && hasEditable(p)) {
          out.push({ kind: "dir", label: d, dir: p });
        }
      }
      for (const f of TOP_FILES) {
        const p = path.join(node.dir, f);
        if (isFile(p)) {
          out.push({ kind: "file", label: f, file: p });
        }
      }
      return out;
    }

    if (node.kind === "dir") {
      return listEditableFiles(node.dir).map((f) => ({
        kind: "file",
        label: f,
        file: path.join(node.dir, f),
      }));
    }

    return []; // file nodes have no children
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listEditableFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && EDITABLE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function hasEditable(dir: string): boolean {
  return listEditableFiles(dir).length > 0;
}
