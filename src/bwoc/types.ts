// Shapes returned by the `bwoc … --json` verbs, normalized to camelCase for the
// extension. Kept minimal for P1 (read-only fleet) — extend as verbs are added.

/** One row of `bwoc list --json` → `agents[]`. */
export interface AgentSummary {
  id: string;
  backend: string;
  status: string;
  running: boolean;
  inboxCount: number;
  incarnated: string;
  path: string;
}

/** One row of `bwoc status <id> --json` → `agents[]` (a superset of the summary). */
export interface AgentDetail extends AgentSummary {
  health: string;
  healthDetail: string | null;
  primaryModel: string;
  scope: string;
  outOfScope: string;
  resources: { memories: number; mindsets: number; skills: number };
}

/** Transport-agnostic view of the fleet. P1 ships only the CLI backend; a bwocd
 *  (signed-HTTP) backend lands in P2 behind the same interface. */
/** Result of `bwoc run --task … <agent> --json` — one headless task. */
export interface RunResult {
  agent: string;
  exitCode: number;
  durationMs: number;
  output: string;
}

export type Capability = "read" | "write" | "exec" | "dangerous";

/** bwocd `GET /whoami` — this controller's approved identity + capabilities. */
export interface WhoAmI {
  controllerId: string;
  caps: Capability[];
  bwocdVersion: string;
}

/** A Saṅgha team from `bwoc team list --json`. */
export interface Team {
  name: string;
  members: string[];
  createdAt: string;
}

/** One shared-task-list entry from `bwoc task list <team> --json`. */
export interface Task {
  id: string;
  plan: string;
  claimedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  state: "done" | "claimed" | "open";
}

/** One workspace-level memory entry from `bwoc memory list --json`. */
export interface MemoryEntry {
  name: string;
  sizeBytes: number;
}

export interface BwocClient {
  list(): Promise<AgentSummary[]>;
  status(agentId: string): Promise<AgentDetail>;
  /** Saṅgha teams in the workspace. */
  teams(): Promise<Team[]>;
  /** A team's shared task list. */
  tasks(team: string): Promise<Task[]>;
  /** Workspace-level memory entries (`.bwoc/memory/`). */
  memories(): Promise<MemoryEntry[]>;
  /** The contents of one memory entry. */
  memoryContent(name: string): Promise<string>;
  /** Append a message to an agent's inbox (as the human operator). Returns the
   *  backend's confirmation line. */
  send(to: string, message: string): Promise<string>;
  /** Run a single task on an agent non-interactively and capture the result. */
  run(agentId: string, task: string): Promise<RunResult>;
}
