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
  /** Absolute path to the entry's file (`<workspace_memory_dir>/<name>`). On a
   *  remote (bwocd) host this is the *remote* path, so callers that open it must
   *  check it exists locally first (see `bwoc.openMemory`). Empty when the CLI
   *  didn't report a memory dir. */
  path: string;
}

/** One message from `bwoc inbox <agent> --json` → `messages[]`. */
export interface InboxMessage {
  from: string;
  message: string;
  subject: string | null;
  type: string | null;
}

/** One check from `bwoc doctor --json` → `results[]`. */
export interface DoctorCheck {
  name: string;
  status: string;
  detail: string | null;
}

/** `bwoc doctor --json` — environment + workspace diagnosis. */
export interface DoctorReport {
  exit: number;
  results: DoctorCheck[];
}

/** `bwoc check <path> --json` — backend-neutrality audit of one agent. */
export interface CheckReport {
  passes: string[];
  violations: string[];
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
  /** Read an agent's queued inbox messages (`.bwoc/inbox.jsonl`). */
  inbox(agentId: string): Promise<InboxMessage[]>;
  /** Start an agent's daemon (`bwoc start`). Returns a one-line outcome. */
  start(agentId: string): Promise<string>;
  /** Stop an agent's daemon (`bwoc stop`). Returns a one-line outcome. */
  stop(agentId: string): Promise<string>;
  /** Add a task to a team's shared list. */
  taskAdd(team: string, title: string): Promise<void>;
  /** Claim an open task for the operator (or the configured agent). */
  taskClaim(team: string, taskId: string): Promise<void>;
  /** Mark a claimed task complete. */
  taskComplete(team: string, taskId: string): Promise<void>;
  /** Diagnose the environment + workspace (`bwoc doctor`). */
  doctor(): Promise<DoctorReport>;
  /** Backend-neutrality audit of one agent (`bwoc check <path>`). */
  check(agentPath: string): Promise<CheckReport>;
  /** Incarnate a new agent (`bwoc new <name> --backend <backend>`). Returns a
   *  one-line outcome. */
  newAgent(name: string, backend: string): Promise<string>;
  /** Retire an agent — remove from the registry + files (`bwoc retire`). */
  retire(name: string): Promise<string>;
  /** Broadcast one message to every workspace agent (`team` omitted →
   *  `bwoc send --all`) or to a Saṅgha team's members (`bwoc send --team`).
   *  Returns the CLI's fan-out summary. */
  broadcast(message: string, team?: string): Promise<string>;
  /** Retry spooled outbox messages (`bwoc outbox flush`), optionally for one
   *  peer. Returns the flush summary line. */
  outboxFlush(peer?: string): Promise<string>;
}
