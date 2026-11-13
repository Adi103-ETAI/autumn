// autumn — Wave-2 handlers: cues (8 dispatchable; docs/architecture/backend.md-2).
//
// The semantics:
//   cues.save(list item) / cues.list / cues.read(id) / cues.remove(id)
//   cues.prepareCommand(id)  — validate + resolve a saved command before running it
//   cues.cancelCommand(id)   — drop a prepared command
//   cues.invoke(id, args?)   — run the prepared command (real child_process; tracked)
//   cues.cancelInvoke(id)    — kill a running invocation
//
// A "cue" is a saved, named command definition: { id, name, command, args?, cwd?, notes?,
// createdAt, updatedAt }. Invocation is REAL: child_process.spawn injected via deps.spawn
// (fake in tests). CancelInvoke kills the tracked child.

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

export interface Cue {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

const cueFile = () => dbPath("cues.json");

function readCues(): Cue[] {
  return loadJson(cueFile(), []);
}
function writeCues(cues: Cue[]) {
  saveJson(cueFile(), cues);
}

class CueStore { static cueFile() { return cueFile(); } }

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function mkCue(p: Record<string, any>, nowMs: number): Cue {
  return {
    id: String(p.id ?? `cue-${nowMs.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`),
    name: String(p.name).slice(0, 120),
    command: String(p.command).slice(0, 512),
    args: Array.isArray(p.args) ? p.args.map((a: unknown) => String(a).slice(0, 512)) : [],
    cwd: typeof p.cwd === "string" ? p.cwd : undefined,
    notes: typeof p.notes === "string" ? p.notes.slice(0, 1024) : undefined,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

/** Shape validation shared by save + schema. */
function invalidCue(p: Record<string, any> | null | undefined): string | null {
  if (!p || typeof p !== "object") return "cue object required";
  if (typeof p.name !== "string" || p.name.trim().length === 0) return "name (non-empty string) required";
  if (typeof p.command !== "string" || p.command.trim().length === 0) return "command (non-empty string) required";
  if (p.args !== undefined && !Array.isArray(p.args)) return "args must be an array when given";
  if (p.cwd !== undefined && typeof p.cwd !== "string") return "cwd must be a string when given";
  if (p.id !== undefined && (typeof p.id !== "string" || !ID_RE.test(p.id))) return "id, if given, must match [a-zA-Z0-9._-]{1,128}";
  return null;
}

export function makeCuesHandlers(deps: W1Deps): RegisteredHandler[] {
  const { spawn, now } = deps;

  /** Live invocations: id -> child. Process record only — never fabricated. */
  const live = new Map<string, { proc: ChildProcLike | { kill: (s?: string) => void }; startedAt: number }>();

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "cues.save",
      description:
        "create or update a saved command; params: { id?, name, command, args?, cwd?, notes? } -> cue row",
      schema: (p) => {
        if (typeof p?.id === "string" && !ID_RE.test(p.id)) return { ok: false, message: "id must match [a-zA-Z0-9._-]{1,128}" };
        if (typeof p?.name !== "string" || p.name.trim().length === 0) return { ok: false, message: "name (non-empty string) required" };
        if (typeof p?.command !== "string" || p.command.trim().length === 0) return { ok: false, message: "command (non-empty string) required" };
        if (p?.args !== undefined && !Array.isArray(p.args)) return { ok: false, message: "args must be an array when given" };
        if (p?.cwd !== undefined && typeof p.cwd !== "string") return { ok: false, message: "cwd must be a string when given" };
        return { ok: true };
      },
      handler: (p) => {
        const problem = invalidCue(p);
        if (problem) return badParams(problem);
        const cues = readCues();
        const idx = p.id ? cues.findIndex((c) => c.id === p.id) : -1;
        if (idx >= 0) {
          cues[idx] = { ...mkCue({ ...p, createdAt: cues[idx].createdAt }, now()), id: cues[idx].id, updatedAt: now() };
          writeCues(cues);
          return cues[idx];
        }
        const cue = mkCue(p!, now());
        cues.push(cue);
        writeCues(cues);
        return cue;
      },
    },
    {
      kind: "bridge",
      id: "cues.list",
      description: "list all saved cues; params: {} -> { cues: [...] }",
      schema: () => ({ ok: true }),
      handler: () => ({ cues: readCues() }),
    },
    {
      kind: "bridge",
      id: "cues.read",
      description: "read one cue; params: { id } -> cue row | not-found",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        const cue = readCues().find((c) => c.id === p.id);
        if (!cue) return notFound(`cue not found: ${p.id}`);
        return cue;
      },
    },
    {
      kind: "bridge",
      id: "cues.remove",
      description: "delete a cue (kills its live invocation first if any); params: { id } -> { ok: true }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        const cues = readCues();
        const idx = cues.findIndex((c) => c.id === p.id);
        if (idx < 0) return notFound(`cue not found: ${p.id}`);
        live.get(p.id)?.proc.kill();
        live.delete(p.id);
        cues.splice(idx, 1);
        writeCues(cues);
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "cues.prepareCommand",
      description:
        "resolve + validate a cue for invocation; params: { id } -> { id, command, args, cwd?, valid, issues? }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        const cue = readCues().find((c) => c.id === p.id);
        if (!cue) return notFound(`cue not found: ${p.id}`);
        const issues: string[] = [];
        if (!cue.command.trim()) issues.push("empty command");
        if (!/^[a-zA-Z0-9._/\\:-]+$/.test(cue.command.split(" ")[0])) issues.push("command looks invalid");
        if (cue.cwd && require("node:path").isAbsolute(cue.cwd) === false) issues.push("cwd must be absolute");
        return {
          id: cue.id,
          command: cue.command,
          args: cue.args,
          ...(cue.cwd ? { cwd: cue.cwd } : {}),
          valid: issues.length === 0,
          issues,
        };
      },
    },
    {
      kind: "bridge",
      id: "cues.cancelCommand",
      description:
        "drop a prepared cue command (documented no-op: autumn materializes no preparation state; the cue row remains); params: { id } -> { ok: true }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        return { ok: true, note: "cancelCommand is a no-op in autumn — preparation is computed at invoke time" };
      },
    },
    {
      kind: "bridge",
      id: "cues.invoke",
      description:
        "run a cue's command as a child process; params: { id, stdin?: string } -> { id, running: true } | handler-error on spawn failure",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        const cue = readCues().find((c) => c.id === p.id);
        if (!cue) return notFound(`cue not found: ${p.id}`);
        if (live.has(p.id)) {
          return { ok: false, error: { code: "handler-error", message: `already running: ${p.id} — cancel it first` } };
        }
        const proc = spawn.spawn(cue.command, cue.args ?? [], { cwd: cue.cwd });
        live.set(p.id, { proc, startedAt: now() });
        ;(proc as ChildProcLike).on?.("exit", () => {
          if (live.get(p.id)?.proc === proc) live.delete(p.id);
        });
        return { id: p.id, running: true };
      },
    },
    {
      kind: "bridge",
      id: "cues.cancelInvoke",
      description:
        "kill a running cue invocation; params: { id } -> { ok: true } | not-found when idle",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        if (typeof p?.id !== "string") return badParams("id required");
        const rec = live.get(p.id);
        if (!rec) return notFound(`no live invocation for cue: ${p.id}`);
        rec.proc.kill();
        live.delete(p.id);
        return { ok: true };
      },
    },
  ];

  return handlers;
}
