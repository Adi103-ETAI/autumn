// autumn — Wave-1 handlers: canvas command queue (docs/architecture/backend.md).
//
// The renderer stages a command against a canvas, reports progress on it, and
// finally resolves it with a result; queued commands live INSIDE the canvas
// row's `state` JSON (Prisma `Canvas.state`, a JSON string) under a
// `pendingCommands` array. exportCanvas/importCanvas round-trip that document
// (no file I/O — the payload IS the document).
//
// canvas.load / canvas.save are Wave-0 (handlers.ts) — NOT re-registered here.
// Envelope contract (docs/architecture/backend.md): plain payload on success, {ok:false,error}
// with code bad-params / not-found / handler-error otherwise.
// Emitters (docs/architecture/backend.md): events.onCanvasCommand after a real stage,
// events.onCanvasCommandResolved after a real commandResult — nothing else.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

/** One queued command, persisted at state.pendingCommands[i]. */
interface QueuedCommand {
  id: string;
  ts: number;
  status: string;
  command: string;
  args?: unknown;
  progress?: number;
  result?: unknown;
}

/** Deliberate failure envelope (registry passes these through untouched). */
interface Err {
  ok: false;
  error: { code: string; message: string };
}

const bad = (message: string): Err => ({ ok: false, error: { code: "bad-params", message } });
const notFound = (message: string): Err => ({ ok: false, error: { code: "not-found", message } });
const handlerErr = (message: string): Err => ({ ok: false, error: { code: "handler-error", message } });

/** The subset of a Canvas row this module touches. */
interface CanvasRow {
  id: string;
  name?: string | null;
  state?: unknown;
  updatedAt?: unknown;
}

type RowResult = { ok: true; row: CanvasRow } | Err;
type StateResult = { ok: true; state: Record<string, unknown> } | Err;
type StateStrResult = { ok: true; state: string } | Err;

/** Canvas targeted by a call: the `canvas` param or the shared "default" row. */
const canvasIdOf = (p: Record<string, any>): string =>
  typeof p.canvas === "string" && p.canvas ? p.canvas : "default";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function makeCanvasHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;
  let seq = 0; // per-factory counter -> unique ids even inside one millisecond

  async function loadRow(id: string): Promise<RowResult> {
    const row = (await deps.db.canvas.findUnique({ where: { id } })) as CanvasRow | null | undefined;
    return row ? { ok: true, row } : notFound(`canvas not found: ${id}`);
  }

  /** Parse the row's state JSON into a mutable object; corrupt storage is a real failure. */
  function readState(row: CanvasRow): StateResult {
    const raw = typeof row.state === "string" ? row.state : "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return handlerErr(`canvas state is not valid JSON: ${row.id}`);
    }
    if (!isPlainObject(parsed)) return handlerErr(`canvas state is not a JSON object: ${row.id}`);
    return { ok: true, state: parsed };
  }

  function queueOf(state: Record<string, unknown>): QueuedCommand[] {
    return Array.isArray(state.pendingCommands) ? (state.pendingCommands as QueuedCommand[]) : [];
  }

  async function persist(id: string, state: Record<string, unknown>): Promise<void> {
    await deps.db.canvas.update({ where: { id }, data: { state: JSON.stringify(state) } });
  }

  /** Validate a payload state: JSON string (parse-checked) or object (stringified). */
  function normaliseState(value: unknown, label: string): StateStrResult {
    if (typeof value === "string") {
      try {
        JSON.parse(value);
      } catch {
        return bad(`${label} is not valid JSON`);
      }
      return { ok: true, state: value };
    }
    if (isPlainObject(value)) return { ok: true, state: JSON.stringify(value) };
    return bad(`${label} must be a JSON string or object`);
  }

  const handlers: RegisteredHandler[] = [
    // ---------------- command queue ----------------
    {
      kind: "bridge",
      id: "canvas.stageCommand",
      description: "queue a command on the canvas; params: {canvas?, command, args?} -> {id, status}",
      schema: (p) =>
        p && typeof p.command === "string" && p.command.trim() !== ""
          ? { ok: true }
          : { ok: false, message: "command required (non-empty string)" },
      handler: async (p = {}) => {
        if (typeof p.command !== "string" || p.command.trim() === "") {
          return bad("command required (non-empty string)");
        }
        const canvasId = canvasIdOf(p);
        const r = await loadRow(canvasId);
        if (!r.ok) return r;
        const s = readState(r.row);
        if (!s.ok) return s;

        const ts = now();
        const entry: QueuedCommand = {
          id: `cmd-${ts}-${++seq}`,
          ts,
          status: "pending",
          command: p.command,
        };
        if (p.args !== undefined) entry.args = p.args;
        s.state.pendingCommands = [...queueOf(s.state), entry];
        await persist(canvasId, s.state);

        emit("events.onCanvasCommand", { canvas: canvasId, id: entry.id, command: p.command });
        return { id: entry.id, status: entry.status };
      },
    },
    {
      kind: "bridge",
      id: "canvas.pendingCommands",
      description: "list queued canvas commands; params: {canvas?} -> {commands}",
      handler: async (p = {}) => {
        const canvasId = canvasIdOf(p);
        const r = await loadRow(canvasId);
        if (!r.ok) return r;
        const s = readState(r.row);
        if (!s.ok) return s;
        return { commands: queueOf(s.state) };
      },
    },
    {
      kind: "bridge",
      id: "canvas.commandProgress",
      description:
        "update a queued command's status/progress; params: {canvas?, id, progress?, status?} -> {ok, id, status, progress?}",
      handler: async (p = {}) => {
        if (typeof p.id !== "string" || p.id === "") return bad("id required (non-empty string)");
        if (p.progress !== undefined && (typeof p.progress !== "number" || !Number.isFinite(p.progress))) {
          return bad("progress must be a finite number");
        }
        if (p.status !== undefined && (typeof p.status !== "string" || p.status === "")) {
          return bad("status must be a non-empty string");
        }
        const canvasId = canvasIdOf(p);
        const r = await loadRow(canvasId);
        if (!r.ok) return r;
        const s = readState(r.row);
        if (!s.ok) return s;

        const queue = queueOf(s.state);
        const entry = queue.find((c) => c && c.id === p.id);
        if (!entry) return notFound(`command not found: ${p.id}`);

        if (p.progress !== undefined) entry.progress = p.progress;
        if (p.status !== undefined) entry.status = p.status;
        else if (p.progress !== undefined) entry.status = "running"; // progress implies work underway
        s.state.pendingCommands = queue;
        await persist(canvasId, s.state);

        const out: { ok: true; id: string; status: string; progress?: number } = {
          ok: true,
          id: entry.id,
          status: entry.status,
        };
        if (typeof entry.progress === "number") out.progress = entry.progress;
        return out;
      },
    },
    {
      kind: "bridge",
      id: "canvas.commandResult",
      description:
        "resolve a queued command (drops it from pending); params: {canvas?, id, ok?, result?} -> {ok, id, status}",
      handler: async (p = {}) => {
        if (typeof p.id !== "string" || p.id === "") return bad("id required (non-empty string)");
        if (p.ok !== undefined && typeof p.ok !== "boolean") return bad("ok must be a boolean");
        const succeeded = p.ok !== false;
        const canvasId = canvasIdOf(p);
        const r = await loadRow(canvasId);
        if (!r.ok) return r;
        const s = readState(r.row);
        if (!s.ok) return s;

        const queue = queueOf(s.state);
        const idx = queue.findIndex((c) => c && c.id === p.id);
        if (idx === -1) return notFound(`command not found: ${p.id}`);
        const entry = queue[idx];
        s.state.pendingCommands = queue.filter((_, i) => i !== idx);
        await persist(canvasId, s.state);

        const payload: { canvas: string; id: string; ok: boolean; result?: unknown } = {
          canvas: canvasId,
          id: entry.id,
          ok: succeeded,
        };
        if (p.result !== undefined) payload.result = p.result;
        emit("events.onCanvasCommandResolved", payload);
        return { ok: true, id: entry.id, status: succeeded ? "done" : "failed" };
      },
    },

    // ---------------- document round-trip ----------------
    {
      kind: "bridge",
      id: "canvas.exportCanvas",
      description:
        "serialise a canvas document (no file I/O); params: {id?} -> {id, name, state, exportedAt}",
      handler: async (p = {}) => {
        const id = typeof p.id === "string" && p.id ? p.id : "default";
        const r = await loadRow(id);
        if (!r.ok) return r;
        return {
          id: r.row.id,
          name: typeof r.row.name === "string" && r.row.name ? r.row.name : "Untitled Canvas",
          state:
            typeof r.row.state === "string"
              ? r.row.state
              : JSON.stringify(isPlainObject(r.row.state) ? r.row.state : {}),
          exportedAt: new Date(now()).toISOString(),
        };
      },
    },
    {
      kind: "bridge",
      id: "canvas.importCanvas",
      description:
        "create/upsert a canvas from an exported document or raw state; params: {id?, name?, document?, state?} -> {id, name, updatedAt}",
      handler: async (p = {}) => {
        // `document`: exportCanvas output as a JSON string or already-parsed object.
        let doc: Record<string, unknown> | null = null;
        if (p.document !== undefined) {
          let v: unknown = p.document;
          if (typeof v === "string") {
            try {
              v = JSON.parse(v);
            } catch {
              return bad("document is not valid JSON");
            }
          }
          if (!isPlainObject(v)) return bad("document must be a JSON object");
          doc = v;
        }

        // State source: explicit `state` wins, else document.state.
        let stateSrc: unknown;
        let label: string;
        if (p.state !== undefined) {
          stateSrc = p.state;
          label = "state";
        } else if (doc && doc.state !== undefined) {
          stateSrc = doc.state;
          label = "document.state";
        } else {
          return bad("document or state required");
        }
        const n = normaliseState(stateSrc, label);
        if (!n.ok) return n;

        // Row id: explicit `id` wins, else the document's id — no id -> not-found.
        const id =
          typeof p.id === "string" && p.id
            ? p.id
            : doc && typeof doc.id === "string" && doc.id
              ? doc.id
              : null;
        if (!id) return notFound("no canvas id in params or document");
        const name =
          typeof p.name === "string" && p.name
            ? p.name
            : doc && typeof doc.name === "string" && doc.name
              ? doc.name
              : "Untitled Canvas";

        const row = (await deps.db.canvas.upsert({
          where: { id },
          update: { name, state: n.state },
          create: { id, name, state: n.state },
        })) as CanvasRow | null | undefined;
        return { id, name, updatedAt: row && row.updatedAt ? row.updatedAt : new Date(now()) };
      },
    },
  ];

  return handlers;
}
