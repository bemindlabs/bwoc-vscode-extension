import * as vscode from "vscode";

import { BwocCliError, BwocdError, type BwocClient, type MemoryEntry } from "../bwoc";

/** Flat tree of workspace-level memory entries (`bwoc memory list`). Clicking an
 *  entry opens its contents (see `bwoc.openMemory` in extension.ts). */
export class MemoryProvider implements vscode.TreeDataProvider<MemoryEntry> {
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

  getTreeItem(entry: MemoryEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${(entry.sizeBytes / 1024).toFixed(1)} KB`;
    item.iconPath = new vscode.ThemeIcon("book");
    if (entry.path) {
      item.resourceUri = vscode.Uri.file(entry.path);
    }
    item.command = {
      command: "bwoc.openMemory",
      title: "Open Memory Entry",
      arguments: [entry],
    };
    return item;
  }

  async getChildren(): Promise<MemoryEntry[]> {
    try {
      return await this.client.memories();
    } catch (err) {
      // bwocd now proxies `memory list` via /cli, so surface real failures
      // (401/timeout/malformed) instead of rendering a silent blank panel —
      // consistent with the Fleet view.
      const msg =
        err instanceof BwocCliError || err instanceof BwocdError
          ? err.message
          : String(err);
      vscode.window.showErrorMessage(`BWOC: ${msg}`);
      return [];
    }
  }
}
