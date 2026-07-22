import * as path from "node:path";

import * as vscode from "vscode";

import { activeWorkspaceRoot, BwocCliError, BwocdBackend, type BwocClient } from "./bwoc";
import { BwocdError } from "./bwoc";
import { ChatPanel } from "./chat/panel";
import { buildChatSpawn, ChatSession } from "./chat/session";

/** Message shown for any backend failure, unwrapped to its clean text. */
function errText(err: unknown): string {
  if (err instanceof BwocCliError || err instanceof BwocdError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Pick an agent id from the live fleet via a QuickPick. Returns undefined if
 *  the user dismisses it or the fleet can't be read. */
async function pickAgent(client: BwocClient, placeHolder: string): Promise<string | undefined> {
  let agents;
  try {
    agents = await client.list();
  } catch (err) {
    vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    return undefined;
  }
  if (agents.length === 0) {
    vscode.window.showInformationMessage("BWOC: no agents in this workspace.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.id,
      description: `${a.running ? "running" : a.status}${a.inboxCount > 0 ? ` · inbox ${a.inboxCount}` : ""}`,
    })),
    { placeHolder, matchOnDescription: true },
  );
  return pick?.label;
}

/** Resolve an agent id from a command argument that may be a plain id (a tree
 *  item's click command passes the id string) or the Fleet tree node itself
 *  (a right-click `view/item/context` menu passes the node). */
function agentIdFrom(arg: unknown): string | undefined {
  if (typeof arg === "string") {
    return arg;
  }
  const node = arg as { agent?: { id?: string } } | undefined;
  return typeof node?.agent?.id === "string" ? node.agent.id : undefined;
}

/**
 * Register the command-palette actions. `getClient` returns the *current*
 * backend (it is rebuilt when settings change), so commands always run against
 * the active client. `output` is a shared channel for verb results.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  getClient: () => BwocClient,
  output: vscode.OutputChannel,
): void {
  const sendMessage = async (arg?: unknown) => {
    const client = getClient();
    const to = agentIdFrom(arg) ?? (await pickAgent(client, "Send a message to which agent?"));
    if (!to) {
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: `Message to ${to}`,
      placeHolder: "Type the message to append to the agent's inbox…",
      validateInput: (v) => (v.trim().length === 0 ? "Message cannot be empty" : undefined),
    });
    if (message === undefined || message.trim().length === 0) {
      return;
    }
    try {
      const confirmation = await client.send(to, message);
      output.appendLine(`[send → ${to}] ${confirmation}`);
      vscode.window.showInformationMessage(`BWOC: sent to ${to}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const openChat = async (arg?: unknown) => {
    // Chat drives a local `bwoc-harness --chat` subprocess in the agent's dir,
    // so it needs a local workspace — not a remote bwocd host.
    const cfg = vscode.workspace.getConfiguration("bwoc");
    if ((cfg.get<string>("remote.url", "") || "").trim()) {
      vscode.window.showInformationMessage(
        "BWOC: chat runs against a local workspace; it isn't wired for a remote bwoc.remote.url host yet.",
      );
      return;
    }
    const client = getClient();
    const to = agentIdFrom(arg) ?? (await pickAgent(client, "Open a chat with which agent?"));
    if (!to) {
      return;
    }
    let detail;
    try {
      detail = await client.status(to);
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
      return;
    }
    const wsRoot = activeWorkspaceRoot();
    if (!wsRoot) {
      vscode.window.showErrorMessage("BWOC: no workspace root — open a folder containing .bwoc/.");
      return;
    }
    const model = detail.primaryModel || "auto";
    if (model === "auto") {
      // B3: harness --chat can't resolve "auto" yet, so buildChatSpawn passes
      // --skip-model-check as a mitigation. Surface it so the operator knows the
      // model wasn't validated. FRAMEWORK FOLLOW-UP: resolve "auto" in --chat.
      output.appendLine(
        `[chat → ${to}] model is "auto"; launching with --skip-model-check (harness --chat can't resolve "auto" yet).`,
      );
    }
    const spawnSpec = buildChatSpawn({
      bwocBinaryPath: cfg.get<string>("binaryPath", "bwoc") || "bwoc",
      agentDir: path.join(wsRoot, detail.path),
      backend: detail.backend,
      model,
    });
    new ChatPanel(to, new ChatSession(spawnSpec)).reveal();
  };

  const enrollController = async () => {
    // Remote (bwocd) only: the CLI backend needs no enrollment. A fresh
    // controller key can never be approved without this POST /enroll step, so
    // without it the remote backend 401s forever (dead-on-arrival).
    const client = getClient();
    if (!(client instanceof BwocdBackend)) {
      vscode.window.showInformationMessage(
        "BWOC: enrollment applies to a remote bwocd host. Set bwoc.remote.url first.",
      );
      return;
    }
    try {
      const { controllerId, publicKeyHex } = await client.enroll();
      output.appendLine(
        `[enroll] requested — approve on the bwocd host:\n  controller id: ${controllerId}\n  public key:    ${publicKeyHex}`,
      );
      output.show(true);
      const copy = "Copy public key";
      const choice = await vscode.window.showInformationMessage(
        `BWOC: enrollment requested for "${controllerId}". Have the operator approve it on the bwocd host (details in the BWOC output channel).`,
        copy,
      );
      if (choice === copy) {
        await vscode.env.clipboard.writeText(publicKeyHex);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const runTask = async (arg?: unknown) => {
    const client = getClient();
    const to = agentIdFrom(arg) ?? (await pickAgent(client, "Run a task on which agent?"));
    if (!to) {
      return;
    }
    const task = await vscode.window.showInputBox({
      prompt: `Task for ${to}`,
      placeHolder: "Describe the task to run headless (captured, non-interactive)…",
      validateInput: (v) => (v.trim().length === 0 ? "Task cannot be empty" : undefined),
    });
    if (task === undefined || task.trim().length === 0) {
      return;
    }
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `BWOC: running task on ${to}…`,
          cancellable: false,
        },
        () => client.run(to, task),
      );
      output.appendLine(
        `[run → ${to}] exit ${result.exitCode} · ${result.durationMs}ms\n${result.output}`,
      );
      output.show(true);
      vscode.window.showInformationMessage(
        `BWOC: task on ${to} finished (exit ${result.exitCode}) — output in the BWOC channel.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const remoteStatus = async () => {
    const client = getClient();
    if (!(client instanceof BwocdBackend)) {
      vscode.window.showInformationMessage(
        "BWOC: running against the local CLI — there is no remote host to check. Set bwoc.remote.url for a bwocd host.",
      );
      return;
    }
    try {
      const me = await client.whoami();
      output.appendLine(
        `[whoami] enrolled as ${me.controllerId} · caps [${me.caps.join(", ") || "none"}] · bwocd ${me.bwocdVersion}`,
      );
      vscode.window.showInformationMessage(
        `BWOC: connected as ${me.controllerId} — caps: ${me.caps.join(", ") || "none"}.`,
      );
    } catch (err) {
      // A BwocdError here is either "not enrolled" (401/403, with an actionable
      // message) or "host unreachable" — both already phrased by the backend.
      vscode.window.showWarningMessage(`BWOC: ${errText(err)}`);
    }
  };

  const startAgent = async (arg?: unknown) => {
    const client = getClient();
    const id = agentIdFrom(arg) ?? (await pickAgent(client, "Start which agent's daemon?"));
    if (!id) {
      return;
    }
    try {
      const outcome = await client.start(id);
      output.appendLine(`[start → ${id}] ${outcome}`);
      vscode.window.showInformationMessage(`BWOC: ${id} — ${outcome}.`);
      await vscode.commands.executeCommand("bwoc.refreshFleet");
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const stopAgent = async (arg?: unknown) => {
    const client = getClient();
    const id = agentIdFrom(arg) ?? (await pickAgent(client, "Stop which agent's daemon?"));
    if (!id) {
      return;
    }
    try {
      const outcome = await client.stop(id);
      output.appendLine(`[stop → ${id}] ${outcome}`);
      vscode.window.showInformationMessage(`BWOC: ${id} — ${outcome}.`);
      await vscode.commands.executeCommand("bwoc.refreshFleet");
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const viewInbox = async (arg?: unknown) => {
    const client = getClient();
    const id = agentIdFrom(arg) ?? (await pickAgent(client, "View which agent's inbox?"));
    if (!id) {
      return;
    }
    try {
      const messages = await client.inbox(id);
      const header = `# Inbox — ${id}\n\n${messages.length} message${messages.length === 1 ? "" : "s"}\n`;
      const body = messages
        .map((m, i) => {
          const subj = m.subject ? ` · ${m.subject}` : "";
          const kind = m.type ? ` _(${m.type})_` : "";
          return `\n## ${i + 1}. from **${m.from}**${subj}${kind}\n\n${m.message}\n`;
        })
        .join("\n");
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: header + (messages.length ? body : "\n_(empty)_\n"),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  // Teams-view node extractors: the team node carries `team.name`; the task node
  // carries `team` (string) + `task.id`.
  const teamNameFrom = (arg: unknown): string | undefined => {
    const n = arg as { kind?: string; team?: { name?: string } | string } | undefined;
    if (n?.kind === "team" && typeof n.team === "object") {
      return n.team?.name;
    }
    if (n?.kind === "task" && typeof n.team === "string") {
      return n.team;
    }
    return undefined;
  };
  const taskRefFrom = (arg: unknown): { team: string; id: string } | undefined => {
    const n = arg as { kind?: string; team?: string; task?: { id?: string } } | undefined;
    if (n?.kind === "task" && typeof n.team === "string" && typeof n.task?.id === "string") {
      return { team: n.team, id: n.task.id };
    }
    return undefined;
  };

  const taskAdd = async (arg?: unknown) => {
    const client = getClient();
    let team = teamNameFrom(arg);
    if (!team) {
      try {
        const teams = await client.teams();
        if (teams.length === 0) {
          vscode.window.showInformationMessage("BWOC: no teams in this workspace.");
          return;
        }
        const pick = await vscode.window.showQuickPick(
          teams.map((t) => t.name),
          { placeHolder: "Add a task to which team?" },
        );
        team = pick;
      } catch (err) {
        vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
        return;
      }
    }
    if (!team) {
      return;
    }
    const title = await vscode.window.showInputBox({
      prompt: `New task for team ${team}`,
      placeHolder: "Task description…",
      validateInput: (v) => (v.trim().length === 0 ? "Task cannot be empty" : undefined),
    });
    if (title === undefined || title.trim().length === 0) {
      return;
    }
    try {
      await client.taskAdd(team, title);
      vscode.window.showInformationMessage(`BWOC: added task to ${team}.`);
      await vscode.commands.executeCommand("bwoc.refreshTeams");
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const taskClaim = async (arg?: unknown) => {
    const ref = taskRefFrom(arg);
    if (!ref) {
      vscode.window.showInformationMessage("BWOC: pick an open task in the Teams view to claim.");
      return;
    }
    try {
      await getClient().taskClaim(ref.team, ref.id);
      vscode.window.showInformationMessage(`BWOC: claimed ${ref.id} in ${ref.team}.`);
      await vscode.commands.executeCommand("bwoc.refreshTeams");
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const taskComplete = async (arg?: unknown) => {
    const ref = taskRefFrom(arg);
    if (!ref) {
      vscode.window.showInformationMessage("BWOC: pick a claimed task in the Teams view to complete.");
      return;
    }
    try {
      await getClient().taskComplete(ref.team, ref.id);
      vscode.window.showInformationMessage(`BWOC: completed ${ref.id} in ${ref.team}.`);
      await vscode.commands.executeCommand("bwoc.refreshTeams");
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const doctor = async () => {
    try {
      const report = await getClient().doctor();
      const lines = report.results
        .map((r) => {
          const mark = r.status === "pass" ? "✓" : r.status === "warn" ? "!" : "✗";
          return `- ${mark} **${r.name}** — ${r.status}${r.detail ? `: ${r.detail}` : ""}`;
        })
        .join("\n");
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: `# BWOC Doctor\n\nexit ${report.exit}\n\n${lines}\n`,
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      vscode.window.showErrorMessage(`BWOC: ${errText(err)}`);
    }
  };

  const commandPalette = async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(comment-discussion) Chat with an agent", cmd: "bwoc.openChat" },
        { label: "$(play) Run a task on an agent", cmd: "bwoc.runTask" },
        { label: "$(comment) Send message to an agent", cmd: "bwoc.sendMessage" },
        { label: "$(mail) View an agent's inbox", cmd: "bwoc.viewInbox" },
        { label: "$(debug-start) Start an agent's daemon", cmd: "bwoc.startAgent" },
        { label: "$(debug-stop) Stop an agent's daemon", cmd: "bwoc.stopAgent" },
        { label: "$(add) Add a task to a team", cmd: "bwoc.taskAdd" },
        { label: "$(stethoscope) Doctor — diagnose environment", cmd: "bwoc.doctor" },
        { label: "$(refresh) Refresh fleet", cmd: "bwoc.refreshFleet" },
        { label: "$(key) Enroll this controller (remote bwocd)", cmd: "bwoc.enrollController" },
        { label: "$(account) Remote status / who am I (bwocd)", cmd: "bwoc.remoteStatus" },
      ],
      { placeHolder: "BWOC — pick an action" },
    );
    if (pick) {
      await vscode.commands.executeCommand(pick.cmd);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("bwoc.sendMessage", sendMessage),
    vscode.commands.registerCommand("bwoc.openChat", openChat),
    vscode.commands.registerCommand("bwoc.runTask", runTask),
    vscode.commands.registerCommand("bwoc.enrollController", enrollController),
    vscode.commands.registerCommand("bwoc.remoteStatus", remoteStatus),
    vscode.commands.registerCommand("bwoc.startAgent", startAgent),
    vscode.commands.registerCommand("bwoc.stopAgent", stopAgent),
    vscode.commands.registerCommand("bwoc.viewInbox", viewInbox),
    vscode.commands.registerCommand("bwoc.taskAdd", taskAdd),
    vscode.commands.registerCommand("bwoc.taskClaim", taskClaim),
    vscode.commands.registerCommand("bwoc.taskComplete", taskComplete),
    vscode.commands.registerCommand("bwoc.doctor", doctor),
    vscode.commands.registerCommand("bwoc.commandPalette", commandPalette),
  );
}
