// autumn — Wave-3 handlers: autopilot (6 dispatchable + 1 push; docs/architecture/autopilot.md).
//
// Autumn runs a *team* of agents under one node: an
// operation binds several agent slots to a reviewed plan, materializes one
// terminal per member, launches the real harness CLI in it, watches the
// workers' reports and can stop, retry or release each member.
//
// autumn keeps the shape and makes it LOCAL:
//   * the gate is local (there is no server to ask): team staffing is on by
//     default and can be turned off from the user's own settings file;
//   * the plan is validated exactly like the contract's (a `team_proposal`
//     envelope, unique candidate ids, bounded payloads);
//   * the repository is a REAL local Git repo (the resolves the same way:
//     `git rev-parse --show-toplevel` + the HEAD sha);
//   * every member is a REAL agent process: the harness CLI is resolved on
//     PATH and launched in a PTY, and the worker reports the vocabulary
//     are read out of the terminal's own output.
//
// The contract (docs/architecture/autopilot.md):
//   operation statuses  starting | running | stopping | stopped | completed |
//                       failed | interrupted
//   member statuses     queued | isolating | launching | connecting |
//                       needs-setup | ready | working | needs-input | stuck |
//                       done | failed | stopped | released
//   optimize values     speed | cost | quality | balanced
//   max active slots    20
//   member node ids     "opterm-<uuid>"   (the member's canvas is the tail)
//   worker reports      checkpoint | needs input | stuck | done, written as
//                       "[worker status: <state>] <text>"
//   storage             <userData>/autopilot-operations.json
//                       {schemaVersion: 1, operations: [...]}
//   gate                remoteConfigSnapshot().autopilotStaffing — enabled OR
//                       (not packaged AND not operator-disabled)
//
// autumn's IPC shapes (the ipcMain handlers):
//   autopilot.start(input)          input: {canvasId, proposal, candidates, repoRoot}
//   autopilot.stop(operationId)
//   autopilot.retryMember(operationId, nodeId)
//   autopilot.stopMember(operationId, nodeId)
//   autopilot.snapshot({operationId?, canvasId?})
//   autopilot.releaseTerminal(operationId, nodeId)
//   event: autopilot-changed  → the public snapshot

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { userDataDir } from "./store";
import { paramsOf } from "./params";

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

export const OPERATION_STATUSES = [
  "starting",
  "running",
  "stopping",
  "stopped",
  "completed",
  "failed",
  "interrupted",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const MEMBER_STATUSES = [
  "queued",
  "isolating",
  "launching",
  "connecting",
  "needs-setup",
  "ready",
  "working",
  "needs-input",
  "stuck",
  "done",
  "failed",
  "stopped",
  "released",
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const OPTIMIZE_VALUES = ["speed", "cost", "quality", "balanced"] as const;
export type Optimize = (typeof OPTIMIZE_VALUES)[number];

/** The cap on approved operation slots. */
export const MAX_ACTIVE_SLOTS = 20;
/** The cap on the candidate binding. */
export const MAX_CANDIDATES = 64;
export const MAX_CANDIDATE_BYTES = 256 * 1024;
/** The cap on the members of one operation. */
export const MAX_SLOTS = 20;

/** The worker-report vocabulary. */
export const WORKER_REPORT_STATES = ["checkpoint", "needs_input", "stuck", "done"] as const;
export const WORKER_STATE_TEXT: Record<(typeof WORKER_REPORT_STATES)[number], string> = {
  checkpoint: "checkpoint",
  needs_input: "needs input",
  stuck: "stuck",
  done: "done",
};

/** The member statuses that can still work. */
const TERMINAL_MEMBER_STATUSES: MemberStatus[] = ["stopped", "released", "failed", "done"];
const memberCanWork = (member: AutopilotMember): boolean => !TERMINAL_MEMBER_STATUSES.includes(member.status);
const operationIsActive = (record: AutopilotOperation): boolean =>
  record.status === "starting" || record.status === "running" || record.status === "stopping";

const cleanText = (value: unknown, max = 600): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

// ---------------------------------------------------------------------------
// the record shapes
// ---------------------------------------------------------------------------

export interface AutopilotMember {
  slotId: string;
  nodeId: string;
  canvasId: string;
  role: string;
  harness: string;
  model?: string;
  task: string;
  dependsOn?: string[];
  status: MemberStatus;
  summary?: string;
  error?: string;
  accountId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutopilotConnection {
  from: string;
  to: string;
}

export interface AutopilotOperation {
  id: string;
  canvasId: string;
  objective: string;
  optimize: Optimize;
  status: OperationStatus;
  repoRoot: string;
  baseSha: string;
  createdAt: number;
  updatedAt: number;
  connections: AutopilotConnection[];
  members: AutopilotMember[];
}

/** The proposal the plan parser produces (`team_proposal`). */
export interface TeamProposal {
  version: 1;
  kind: "team_proposal";
  objective: string;
  optimize: Optimize;
  agents: Array<{ slotId: string; role: string; harness: string; model?: string; candidateId: string }>;
  assignments: Array<{ slotId: string; task: string; dependsOn?: string[] }>;
  connections: AutopilotConnection[];
}

export interface Candidate {
  candidateId: string;
  accountId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

const operationsPath = () => join(userDataDir(), "autopilot-operations.json");
const gatePath = () => join(userDataDir(), "db", "autopilot-gate.json");

interface Gate {
  enabled: boolean;
  operatorDisabled: boolean;
  message?: string;
}

/**
 * The gate is local: there is no server to ask (`remoteConfigSnapshot()`); autumn has no
 * server, so the gate is a local file — enabled unless the operator (or the
 * user) turned it off.
 */
export function readGate(): Gate {
  try {
    if (!existsSync(gatePath())) return { enabled: true, operatorDisabled: false };
    const raw = JSON.parse(readFileSync(gatePath(), "utf8")) as Partial<Gate>;
    return {
      enabled: raw.enabled !== false,
      operatorDisabled: raw.operatorDisabled === true,
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
    };
  } catch {
    return { enabled: true, operatorDisabled: false };
  }
}

export function writeGate(gate: Gate): void {
  mkdirSync(dirname(gatePath()), { recursive: true });
  writeFileSync(gatePath(), JSON.stringify(gate, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// plan parsing (the rules)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parse the `team_proposal` envelope (the `parseProjectChatPlan`). */
export function parseTeamProposal(raw: unknown): { ok: true; proposal: TeamProposal } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "The reviewed proposal is not a valid envelope." };
  if (raw.version !== 1) return { ok: false, error: "The reviewed proposal is no longer valid." };
  if (raw.kind !== "team_proposal") return { ok: false, error: "The reviewed proposal is not a team proposal." };
  const objective = cleanText(raw.objective, 600);
  if (!objective) return { ok: false, error: "The reviewed proposal has no objective." };
  const optimize = OPTIMIZE_VALUES.includes(raw.optimize as Optimize) ? (raw.optimize as Optimize) : "balanced";
  if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > MAX_SLOTS) {
    return { ok: false, error: "The reviewed proposal has no usable team." };
  }
  const agents: TeamProposal["agents"] = [];
  const slotIds = new Set<string>();
  for (const agent of raw.agents) {
    if (!isRecord(agent)) return { ok: false, error: "The reviewed proposal has an invalid team member." };
    const slotId = cleanText(agent.slotId, 64);
    const role = cleanText(agent.role, 120);
    const harness = cleanText(agent.harness, 64);
    const candidateId = cleanText(agent.candidateId, 128);
    if (!slotId || !role || !harness || !candidateId) {
      return { ok: false, error: "The reviewed proposal has an invalid team member." };
    }
    if (slotIds.has(slotId)) return { ok: false, error: "The reviewed proposal has duplicate team slots." };
    slotIds.add(slotId);
    agents.push({
      slotId,
      role,
      harness,
      ...(typeof agent.model === "string" && agent.model ? { model: agent.model.slice(0, 128) } : {}),
      candidateId,
    });
  }
  const assignments: TeamProposal["assignments"] = [];
  if (Array.isArray(raw.assignments)) {
    for (const assignment of raw.assignments) {
      if (!isRecord(assignment)) return { ok: false, error: "The reviewed proposal has an invalid assignment." };
      const slotId = cleanText(assignment.slotId, 64);
      const task = cleanText(assignment.task, 16_000);
      if (!slotId || !task) return { ok: false, error: "The reviewed proposal has an invalid assignment." };
      if (!slotIds.has(slotId)) return { ok: false, error: "The reviewed proposal assigns a task to an unknown slot." };
      assignments.push({
        slotId,
        task,
        ...(Array.isArray(assignment.dependsOn)
          ? { dependsOn: assignment.dependsOn.map((d) => cleanText(d, 64)).filter(Boolean) }
          : {}),
      });
    }
  }
  const connections: AutopilotConnection[] = [];
  if (Array.isArray(raw.connections)) {
    for (const edge of raw.connections) {
      if (!isRecord(edge)) continue;
      const from = cleanText(edge.from, 64);
      const to = cleanText(edge.to, 64);
      if (!from || !to || !slotIds.has(from) || !slotIds.has(to)) continue;
      connections.push({ from, to });
    }
  }
  return {
    ok: true,
    proposal: { version: 1, kind: "team_proposal", objective, optimize, agents, assignments, connections },
  };
}

/** The `validateStart` (adapted: autumn's canvas ids are not UUIDs). */
export function validateStart(input: {
  canvasId?: unknown;
  candidates?: unknown;
}): string | null {
  if (typeof input.canvasId !== "string" || !CANVAS_ID_RE.test(input.canvasId)) {
    return "The active canvas identity is invalid.";
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0 || input.candidates.length > MAX_CANDIDATES) {
    return "The local candidate binding is missing or too large.";
  }
  if (Buffer.byteLength(JSON.stringify(input.candidates)) > MAX_CANDIDATE_BYTES) {
    return "The local candidate binding is too large.";
  }
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (!isRecord(candidate) || typeof candidate.candidateId !== "string" || ids.has(candidate.candidateId)) {
      return "The local candidate binding contains a duplicate or invalid id.";
    }
    ids.add(candidate.candidateId);
    if (candidate.accountId !== undefined && !ACCOUNT_ID_RE.test(String(candidate.accountId))) {
      return "The local candidate binding contains an invalid account pointer.";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// the worker report (the vocabulary, read from the terminal's output)
// ---------------------------------------------------------------------------

export interface WorkerReport {
  state: (typeof WORKER_REPORT_STATES)[number];
  text: string;
}

/** Parse a worker report out of the agent's own output. */
export function parseWorkerReport(chunk: string): WorkerReport | null {
  const m = /\[worker status:\s*(checkpoint|needs input|needs_input|stuck|done)\]\s*([^\n]*)/i.exec(chunk);
  if (!m) return null;
  const raw = m[1].toLowerCase().replace(/_/g, " ");
  const state = (raw === "needs input" ? "needs_input" : raw) as (typeof WORKER_REPORT_STATES)[number];
  return { state, text: cleanText(m[2], 600) };
}

/** Map a worker report onto the member status (the REPORTED_MEMBER_STATUS). */
export function memberStatusForReport(state: WorkerReport["state"]): MemberStatus {
  switch (state) {
    case "checkpoint":
      return "working";
    case "needs_input":
      return "needs-input";
    case "stuck":
      return "stuck";
    case "done":
      return "done";
  }
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeAutopilotHandlers(deps: W1Deps): RegisteredHandler[] {
  const { pty, spawner, busStore, git, db, emit, now } = deps;

  /** The live operations (loaded from disk on first use). */
  const operations = new Map<string, AutopilotOperation>();
  let loaded = false;
  let storageFault: string | null = null;
  /** The PTY unsubscribe per member. */
  const observers = new Map<string, () => void>();

  const persist = (): void => {
    const file = operationsPath();
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, operations: [...operations.values()] }, null, 2), "utf8");
    renameSync(tmp, file);
  };

  const publicSnapshot = (record: AutopilotOperation): AutopilotOperation => ({
    ...record,
    members: record.members.map((member) => ({ ...member })),
  });

  const emitChange = (record: AutopilotOperation): void => {
    emit("autopilot.onChanged", publicSnapshot(record));
  };

  const ensureLoaded = (): void => {
    if (loaded) return;
    loaded = true;
    const file = operationsPath();
    if (!existsSync(file)) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        schemaVersion?: number;
        operations?: AutopilotOperation[];
      };
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.operations)) throw new Error("invalid operation file");
      for (const record of parsed.operations) {
        if (!record?.id || !Array.isArray(record.members)) continue;
        operations.set(record.id, record);
      }
    } catch (e) {
      storageFault = cleanText((e as Error)?.message ?? e, 240) || "unreadable storage";
    }
  };

  const findOperation = (operationId: string): AutopilotOperation | undefined => {
    ensureLoaded();
    return operations.get(operationId);
  };

  const findMember = (record: AutopilotOperation, nodeId: string): AutopilotMember | undefined =>
    record.members.find((m) => m.nodeId === nodeId);

  /** The slot accounting (a released member does not hold a slot). */
  const activeSlotCount = (): number => {
    let count = 0;
    for (const record of operations.values()) {
      if (!["starting", "running", "stopping", "completed"].includes(record.status)) continue;
      count += record.members.filter((m) => m.status !== "released").length;
    }
    return count;
  };

  const gateAllows = (): boolean => {
    const gate = readGate();
    return gate.enabled || (!gate.operatorDisabled && !process.env.AUTUMN_PACKAGED);
  };

  /** Stop the agent process of a member (the PTY is the agent's terminal). */
  const retireMember = (member: AutopilotMember): void => {
    const off = observers.get(member.nodeId);
    if (off) {
      off();
      observers.delete(member.nodeId);
    }
    try {
      if (pty.ptyExists(member.nodeId)) pty.killPty(member.nodeId);
    } catch {
      /* already gone */
    }
  };

  /** Read the member's worker reports out of its terminal output. */
  const observeMember = (record: AutopilotOperation, member: AutopilotMember): void => {
    if (observers.has(member.nodeId)) return;
    const off = pty.subscribePty(member.nodeId, (chunk: string) => {
      const report = parseWorkerReport(chunk);
      if (!report) return;
      const live = findMember(record, member.nodeId);
      if (!live || TERMINAL_MEMBER_STATUSES.includes(live.status)) return;
      live.status = memberStatusForReport(report.state);
      live.summary = report.text || live.summary;
      live.updatedAt = now();
      record.updatedAt = now();
      if (live.status === "done") {
        record.status = record.members.every((m) => m.status === "done" || m.status === "released")
          ? "completed"
          : record.status;
      }
      try {
        persist();
      } catch {
        /* the change is still reported */
      }
      emitChange(record);
    });
    observers.set(member.nodeId, off);
  };

  /**
   * Launch a member for real: resolve the harness CLI and run it in a PTY
   * rooted at the operation's repository. A harness that is not installed
   * leaves the member in `needs-setup` — the honest answer.
   */
  const launchMember = async (record: AutopilotOperation, member: AutopilotMember): Promise<void> => {
    member.status = "launching";
    member.updatedAt = now();
    emitChange(record);
    let resolved: { command: string; args: string[]; env: NodeJS.ProcessEnv } | null = null;
    try {
      resolved = await spawner.resolveAgentCommand(member.harness, member.task, {
        canvasId: member.canvasId,
        nodeId: member.nodeId,
      });
    } catch {
      resolved = null;
    }
    if (!resolved) {
      member.status = "needs-setup";
      member.error = `The ${member.harness} CLI is not installed on this machine.`;
      member.updatedAt = now();
      emitChange(record);
      return;
    }
    let ok = false;
    try {
      ok = pty.createPty({
        nodeId: member.nodeId,
        dir: record.repoRoot,
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      member.status = "needs-setup";
      member.error = "The agent terminal could not be started.";
      member.updatedAt = now();
      emitChange(record);
      return;
    }
    member.status = "working";
    member.error = undefined;
    member.updatedAt = now();
    // The member joins the canvas bus, so the team can talk to each other.
    try {
      await busStore.ensurePeer(record.canvasId, member.nodeId, member.role, "working" as never);
    } catch {
      /* the bus is best-effort here */
    }
    observeMember(record, member);
    emitChange(record);
  };

  /** Start every member of an operation. */
  const startMembers = async (record: AutopilotOperation): Promise<void> => {
    for (const member of record.members) {
      if (member.status !== "queued") continue;
      if (!operationIsActive(record)) break;
      await launchMember(record, member);
    }
    if (record.status === "starting") record.status = "running";
    record.updatedAt = now();
    try {
        persist();
      } catch {
        /* reported through the snapshot */
      }
    emitChange(record);
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "autopilot.start",
      description:
        "start a team of agents on a canvas; params: {canvasId, proposal, candidates, repoRoot} -> {ok:true, operation} | {ok:false, error} — the plan is validated like the contract's (a team_proposal envelope + a bounded candidate binding), the repository must be a real local Git repo, and every member is a real agent process launched in its own terminal",
      schema: (p) => {
        const { obj } = paramsOf(p);
        const ok =
          typeof obj.canvasId === "string" &&
          obj.canvasId.length > 0 &&
          Array.isArray(obj.candidates) &&
          obj.proposal !== undefined &&
          typeof obj.repoRoot === "string" &&
          obj.repoRoot.length > 0;
        return ok ? { ok: true } : { ok: false, message: "canvasId, proposal, candidates and repoRoot required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        ensureLoaded();
        if (storageFault) {
          return { ok: false, error: `Operation storage needs recovery before a team can start: ${storageFault}` };
        }
        if (!gateAllows()) {
          return { ok: false, error: readGate().message ?? "Team staffing is disabled." };
        }
        const inputError = validateStart({ canvasId: obj.canvasId, candidates: obj.candidates });
        if (inputError) return { ok: false, error: inputError };

        const parsed = parseTeamProposal(obj.proposal);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const proposal = parsed.proposal;

        const canvasId = obj.canvasId as string;
        for (const record of operations.values()) {
          if (record.canvasId === canvasId && ["starting", "running", "stopping", "completed"].includes(record.status)) {
            return { ok: false, error: "Stop the current team on this canvas before starting another." };
          }
        }
        if (activeSlotCount() + proposal.agents.length > MAX_ACTIVE_SLOTS) {
          return { ok: false, error: `This device can run at most ${MAX_ACTIVE_SLOTS} approved operation slots at once.` };
        }

        // The repository must be a REAL local Git repo (the resolves it the
        // same way: the work-tree root plus the HEAD sha).
        const repoRootInput = obj.repoRoot as string;
        let repoRoot = "";
        let baseSha = "";
        try {
          const toplevel = await git(repoRootInput).raw(["rev-parse", "--show-toplevel"]);
          const head = await git(repoRootInput).raw(["rev-parse", "HEAD"]);
          const root = toplevel.trim();
          const sha = head.trim();
          if (root && /^[0-9a-f]{40,64}$/i.test(sha)) {
            repoRoot = root;
            baseSha = sha;
          }
        } catch {
          repoRoot = "";
          baseSha = "";
        }
        if (!repoRoot) {
          return { ok: false, error: "Team operations need one existing local Git repository." };
        }

        const candidates = obj.candidates as Candidate[];
        const candidateById = new Map(candidates.map((c) => [c.candidateId, c]));
        const assignments = new Map(proposal.assignments.map((a) => [a.slotId, a]));
        const stamp = now();
        const record: AutopilotOperation = {
          id: `operation-${randomUUID()}`,
          canvasId,
          objective: proposal.objective,
          optimize: proposal.optimize,
          status: "starting",
          repoRoot,
          baseSha,
          createdAt: stamp,
          updatedAt: stamp,
          connections: proposal.connections,
          members: proposal.agents.map((agent) => {
            const assignment = assignments.get(agent.slotId);
            const nodeId = `opterm-${randomUUID()}`;
            const accountId = candidateById.get(agent.candidateId)?.accountId;
            return {
              slotId: agent.slotId,
              nodeId,
              canvasId: nodeId.slice(7),
              role: agent.role,
              harness: agent.harness,
              ...(agent.model ? { model: agent.model } : {}),
              task: assignment?.task ?? agent.role,
              ...(assignment?.dependsOn?.length ? { dependsOn: assignment.dependsOn } : {}),
              status: "queued" as MemberStatus,
              ...(accountId ? { accountId } : {}),
              createdAt: stamp,
              updatedAt: stamp,
            };
          }),
        };
        operations.set(record.id, record);
        try {
          persist();
        } catch (e) {
          operations.delete(record.id);
          return {
            ok: false,
            error: `autumn could not reserve the team safely: ${cleanText((e as Error)?.message ?? e)}`,
          };
        }
        emitChange(record);
        await startMembers(record);
        return { ok: true, operation: publicSnapshot(record) };
      },
    },
    {
      kind: "bridge",
      id: "autopilot.stop",
      description:
        "stop a running team; params: {operationId} -> {ok:true, operation} (every member's agent process is really stopped)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        const id = obj.operationId ?? obj.operation;
        return typeof id === "string" && id.length > 0
          ? { ok: true }
          : { ok: false, message: "operationId required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const operationId = (obj.operationId ?? obj.operation) as string;
        ensureLoaded();
        const record = operations.get(operationId);
        if (!record) return { ok: false, error: "Team operation not found." };
        if (record.status === "stopped" || record.status === "interrupted" || record.status === "failed") {
          return { ok: true, operation: publicSnapshot(record) };
        }
        record.status = "stopping";
        record.updatedAt = now();
        for (const member of record.members) {
          if (member.status === "released") continue;
          retireMember(member);
          if (member.status !== "done") member.status = "stopped";
          member.updatedAt = now();
        }
        record.status = "stopped";
        record.updatedAt = now();
        try {
          persist();
        } catch {
          /* reported through the snapshot */
        }
        emitChange(record);
        return { ok: true, operation: publicSnapshot(record) };
      },
    },
    {
      kind: "bridge",
      id: "autopilot.retryMember",
      description:
        "retry a team member that needs setup or failed; params: {operationId, nodeId} -> {ok:true, operation} | {ok:false, error} (the member's agent process is really launched again)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.operationId === "string" && typeof obj.nodeId === "string"
          ? { ok: true }
          : { ok: false, message: "operationId and nodeId required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        ensureLoaded();
        const record = operations.get(obj.operationId as string);
        const member = record ? findMember(record, obj.nodeId as string) : undefined;
        if (!record || !member) return { ok: false, error: "Team member not found." };
        if (!operationIsActive(record)) return { ok: false, error: "This team is no longer running." };
        if (!["needs-setup", "failed"].includes(member.status)) {
          return { ok: false, error: "This agent does not need a retry." };
        }
        member.status = "queued";
        member.error = undefined;
        member.updatedAt = now();
        record.updatedAt = now();
        emitChange(record);
        await launchMember(record, member);
        try {
          persist();
        } catch {
          /* reported through the snapshot */
        }
        emitChange(record);
        return { ok: true, operation: publicSnapshot(record) };
      },
    },
    {
      kind: "bridge",
      id: "autopilot.stopMember",
      description:
        "stop one team member; params: {operationId, nodeId} -> {ok:true, operation} | {ok:false, error} (that member's agent process is really stopped; the rest of the team keeps working)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.operationId === "string" && typeof obj.nodeId === "string"
          ? { ok: true }
          : { ok: false, message: "operationId and nodeId required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        ensureLoaded();
        const record = operations.get(obj.operationId as string);
        const member = record ? findMember(record, obj.nodeId as string) : undefined;
        if (!record || !member || member.status === "released") {
          return { ok: false, error: "Team member not found." };
        }
        member.status = "stopped";
        member.updatedAt = now();
        record.updatedAt = now();
        retireMember(member);
        try {
          persist();
        } catch {
          /* reported through the snapshot */
        }
        emitChange(record);
        return { ok: true, operation: publicSnapshot(record) };
      },
    },
    {
      kind: "bridge",
      id: "autopilot.snapshot",
      description:
        "the team snapshot; params: {operationId?, canvasId?} -> the operation snapshot or null (the newest operation for the canvas when no id is given)",
      handler: async (params) => {
        const { obj } = paramsOf(params);
        ensureLoaded();
        const operationId = typeof obj.operationId === "string" ? obj.operationId : undefined;
        const canvasId = typeof obj.canvasId === "string" ? obj.canvasId : undefined;
        const record = operationId
          ? operations.get(operationId)
          : [...operations.values()]
              .filter((candidate) => !canvasId || candidate.canvasId === canvasId)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        return record ? publicSnapshot(record) : null;
      },
    },
    {
      kind: "bridge",
      id: "autopilot.releaseTerminal",
      description:
        "release a stopped team member's terminal back to the user; params: {operationId, nodeId} -> {ok:true, operation} | {ok:false, error} (the team must be stopped first)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.operationId === "string" && typeof obj.nodeId === "string"
          ? { ok: true }
          : { ok: false, message: "operationId and nodeId required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        ensureLoaded();
        const record = operations.get(obj.operationId as string);
        const member = record ? findMember(record, obj.nodeId as string) : undefined;
        if (!record || !member) return { ok: false, error: "Operation terminal not found." };
        if (!["stopped", "interrupted", "failed"].includes(record.status)) {
          return { ok: false, error: "Stop the team before releasing a terminal." };
        }
        if (member.status === "released") return { ok: true, operation: publicSnapshot(record) };
        member.status = "released";
        member.updatedAt = now();
        record.updatedAt = now();
        retireMember(member);
        try {
          persist();
        } catch (e) {
          return {
            ok: false,
            error: `autumn could not safely release this terminal: ${cleanText((e as Error)?.message ?? e)}`,
          };
        }
        emitChange(record);
        return { ok: true, operation: publicSnapshot(record) };
      },
    },
  ];

  return handlers;
}

/** The members of an operation that are still allowed to work. */
export function workingMembers(record: AutopilotOperation): AutopilotMember[] {
  return record.members.filter((member) => memberCanWork(member));
}
