// autumn — backend handlers: the seven Next API routes ported into registry
// handlers (Wave-0 migration, docs/architecture/ipc-facade.md).
//
// Each handler is a plain async function (params, ctx) => payload | envelope,
// with ALL dependencies injected (bus store, pty, spawner, prisma, personas,
// emit) so every handler is testable headless — layer 1 of docs/architecture/ipc-facade.md. Route
// semantics (validation, clamping, defaults, result shapes) are preserved
// faithfully from the src/app/api/*/route.ts originals; the HTTP plumbing
// (NextRequest/NextResponse/SSE framing) is replaced by:
//   - request/response -> params / returned payload inside the {ok, result} envelope
//   - SSE streams      -> facade `on*` event pushes via deps.emit(id, payload)
//
// The routes themselves stay alive until the renderer flips to the facade
// (migration step M2), then are deleted (M3).

import type { AgentMessage, CanvasSnapshot, CommanderResult } from "@/lib/autumn/types";

// ---------------------------------------------------------------------------
// Dependency surface (faked in tests)
// ---------------------------------------------------------------------------

export interface BusStoreDep {
  ensurePeer(canvasId: string, nodeId: string, name: string, status: never): Promise<unknown>;
  setPeerStatus(canvasId: string, nodeId: string, status: string): Promise<void>;
  sendMessage(canvasId: string, from: string, to: string, message: string): Promise<{ delivered: boolean; id: string; ts: number }>;
  drainInbox(canvasId: string, nodeId: string): Promise<{ injection: string; drained: number }>;
  listPeers(canvasId: string): Promise<unknown>;
  getPeer(canvasId: string, nodeId: string): Promise<unknown>;
}

export interface PtyDep {
  createPty(opts: { nodeId: string; dir?: string; command?: string; args?: string[]; env?: NodeJS.ProcessEnv }): boolean;
  subscribePty(nodeId: string, cb: (chunk: string) => void): () => void;
  writePty(nodeId: string, data: string): boolean;
  resizePty(nodeId: string, cols: number, rows: number): void;
  killPty(nodeId: string): void;
  ptyCount(): number;
}

export interface SpawnerDep {
  runAgent(opts: Record<string, unknown>): Promise<{ text: string; simulated?: boolean; fellBack?: boolean; error?: string }>;
  resolveAgentCommand(
    harness: string,
    task: string | undefined,
    ctx: { canvasId: string; nodeId: string },
  ): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv } | null>;
  HARNESS_BIN: Record<string, string>;
}

export interface DbDep {
  agentLog: {
    findMany(args: unknown): Promise<unknown[]>;
    createMany(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  canvas: {
    findUnique(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
  };
}

export interface PersonasDep {
  PERSONA_BY_ID: Record<string, { name: string }>;
}

export interface BackendDeps {
  busStore: BusStoreDep;
  pty: PtyDep;
  spawner: SpawnerDep;
  db: DbDep;
  personas: PersonasDep;
  /** push a payload to renderer subscribers of a facade `on*` method */
  emit(id: string, payload: unknown): void;
}

export interface RegisteredHandler {
  kind: "bridge" | "core";
  id: string;
  handler: (params: Record<string, any>, ctx?: { principal: string }) => Promise<any> | any;
  schema?: (params: Record<string, any>) => { ok: boolean; message?: string } | { ok: true };
  description: string;
}

// ---------------------------------------------------------------------------
// Shared validation (ported from the routes)
// ---------------------------------------------------------------------------

const NODE_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
const isValidNodeId = (id: unknown): id is string =>
  typeof id === "string" && (NODE_ID_RE.test(id) || /^node-[a-zA-Z0-9_-]{6,16}$/.test(id));

const LOG_KINDS = new Set([
  "commander_plan", "agent_status", "agent_message", "bus_message_peer",
  "task_claim", "task_complete", "task_add", "node_added", "node_removed",
  "edge_added", "edge_removed", "canvas_saved", "canvas_loaded", "canvas_cleared",
  "duplicate_node", "search", "agent_session_start", "agent_session_stop",
]);

const nodeSchema = (p: Record<string, any>) =>
  isValidNodeId(p.node) ? { ok: true as const } : { ok: false, message: "node required (valid id)" };

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function makeHandlers(deps: BackendDeps): RegisteredHandler[] {
  const { busStore, pty, spawner, db, personas, emit } = deps;

  // node -> latest onData subscription (re-subscribe replaces the old one)
  const ptySubs = new Map<string, () => void>();

  const handlers: RegisteredHandler[] = [
    // ---------------- terminal (route: /api/terminal) ----------------
    {
      kind: "bridge",
      id: "terminal.start",
      description: "open PTY for node; output streams via terminal.onData events",
      schema: nodeSchema,
      handler: async (p) => {
        if (!isValidNodeId(p.node)) {
          return { ok: false, error: { code: "bad-params", message: "node required (valid id)" } };
        }
        const dir = typeof p.dir === "string" ? p.dir : undefined;
        const harness = typeof p.harness === "string" ? p.harness : undefined;
        const canvasId = (p.canvas as string) ?? "default";

        // Unknown harness -> bad-params (route returned 400; NO silent fallback)
        if (harness && !Object.prototype.hasOwnProperty.call(spawner.HARNESS_BIN, harness)) {
          return { ok: false, error: { code: "bad-params", message: `unknown harness: ${harness}` } };
        }

        let agentOpts: { command: string; args: string[]; env: NodeJS.ProcessEnv } | null = null;
        let harnessWarning: string | null = null;
        if (harness) {
          agentOpts = await spawner.resolveAgentCommand(harness, p.task, { canvasId, nodeId: p.node });
          if (!agentOpts) harnessWarning = `harness not installed: ${harness} — opened plain shell`;
        }

        // Route note: concurrent-PTY cap was a soft no-op check; createPty evicts.
        const ok = pty.createPty({
          nodeId: p.node,
          dir,
          ...(agentOpts ? { command: agentOpts.command, args: agentOpts.args, env: agentOpts.env } : {}),
        });
        if (!ok) {
          return { ok: false, error: { code: "handler-error", message: "failed to spawn pty - check dir or binary" } };
        }

        // Re-subscribe: stream chunks to renderer subscribers of terminal.onData
        ptySubs.get(p.node)?.();
        ptySubs.set(
          p.node,
          pty.subscribePty(p.node, (data) => emit("terminal.onData", { node: p.node, data })),
        );
        // SSE sent the warning as the first visible line — same as an output chunk
        if (harnessWarning) {
          const warning = `\x1b[33m${harnessWarning}\x1b[0m\r\n`;
          setTimeout(() => emit("terminal.onData", { node: p.node, data: warning }), 50);
        }
        return { node: p.node, harnessWarning };
      },
    },
    {
      kind: "bridge",
      id: "terminal.input",
      description: "write keystrokes to the PTY",
      schema: nodeSchema,
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return { ok: false, error: { code: "bad-params", message: "node required (valid id)" } };
        return { ok: pty.writePty(p.node, typeof p.data === "string" ? p.data : "") };
      },
    },
    {
      kind: "bridge",
      id: "terminal.resize",
      description: "resize the PTY (clamped 20-300 cols, 10-100 rows)",
      schema: nodeSchema,
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return { ok: false, error: { code: "bad-params", message: "node required (valid id)" } };
        const cols = Math.max(20, Math.min(300, Number(p.cols) || 80));
        const rows = Math.max(10, Math.min(100, Number(p.rows) || 24));
        pty.resizePty(p.node, cols, rows);
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.kill",
      description: "kill the PTY and drop its onData subscription",
      schema: nodeSchema,
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return { ok: false, error: { code: "bad-params", message: "node required (valid id)" } };
        ptySubs.get(p.node)?.();
        ptySubs.delete(p.node);
        pty.killPty(p.node);
        return { ok: true };
      },
    },

    // ---------------- canvas (route: /api/canvas) ----------------
    {
      kind: "bridge",
      id: "canvas.load",
      description: "load one canvas by id, or list all (no id)",
      handler: async (p = {}) => {
        const id = typeof p.id === "string" ? p.id : null;
        if (id) {
          const canvas = await db.canvas.findUnique({
            where: { id },
            select: { id: true, name: true, state: true, updatedAt: true },
          });
          if (!canvas) return { ok: false, error: { code: "not-found", message: "not found" } };
          return canvas;
        }
        const canvases = await db.canvas.findMany({
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, updatedAt: true, createdAt: true },
        });
        return { canvases };
      },
    },
    {
      kind: "bridge",
      id: "canvas.save",
      description: "upsert a canvas { id, name, state }",
      schema: (p) =>
        p && (typeof p.id === "string" || p.state === undefined || typeof p.state === "string")
          ? { ok: true }
          : { ok: false, message: "id/state invalid" },
      handler: async (p = {}) => {
        const id = (p.id as string) ?? "default";
        const name = (p.name as string) ?? "Untitled Canvas";
        const state = (p.state as string) ?? "{}";
        const existing = await db.canvas.findUnique({ where: { id } });
        const select = { id: true, name: true, updatedAt: true };
        return existing
          ? db.canvas.update({ where: { id }, data: { name, state }, select })
          : db.canvas.create({ data: { id, name, state }, select });
      },
    },
    {
      kind: "bridge",
      id: "__ops.canvasDelete",
      description: "delete a canvas by id (autumn-private: no target equivalent)",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: async (p) => {
        if (!p.id) return { ok: false, error: { code: "bad-params", message: "id required" } };
        try {
          await db.canvas.delete({ where: { id: p.id } });
          return { ok: true };
        } catch {
          return { ok: false, error: { code: "not-found", message: "not found" } };
        }
      },
    },

    // ---------------- bus (route: /api/bus, GET) ----------------
    {
      kind: "core",
      id: "bus.query",
      description: "bus reads: pre-prompt (drainInbox) | list_peers | get_node_status",
      schema: (p) => {
        const op = p?.op ?? "pre-prompt";
        return ["pre-prompt", "list_peers", "get_node_status"].includes(op)
          ? { ok: true }
          : { ok: false, message: "unknown op" };
      },
      handler: async (p = {}) => {
        const op = p.op ?? "pre-prompt";
        const canvas = (p.canvas as string) ?? "default";
        const node = (p.node as string) ?? "";
        switch (op) {
          case "pre-prompt": {
            const { injection, drained } = await busStore.drainInbox(canvas, node);
            return { injection, drained };
          }
          case "list_peers":
            return { peers: await busStore.listPeers(canvas) };
          case "get_node_status": {
            const peer = await busStore.getPeer(canvas, node);
            if (!peer) return { status: "unknown" };
            return peer;
          }
          default:
            return { ok: false, error: { code: "bad-params", message: "unknown op" } };
        }
      },
    },

    // ---------------- bus (route: /api/bus, POST) ----------------
    {
      kind: "core",
      id: "bus.mutate",
      description: "bus writes: message_peer | session | stop | notify | task",
      schema: (p) => {
        const op = p?.op ?? "message_peer";
        return ["message_peer", "session", "stop", "notify", "task"].includes(op)
          ? { ok: true }
          : { ok: false, message: "unknown op" };
      },
      handler: async (p = {}) => {
        const op = p.op ?? "message_peer";
        const canvasId = (p.canvasId as string) ?? "default";
        const fromNodeId = (p.fromNodeId as string) ?? "unknown";
        const toNodeId = (p.toNodeId as string) ?? "unknown";
        switch (op) {
          case "session": {
            const node = await busStore.ensurePeer(
              canvasId,
              fromNodeId,
              (p.name as string) ?? fromNodeId,
              ((p.status as string) ?? "live") as never,
            );
            return { node };
          }
          case "stop":
            await busStore.setPeerStatus(canvasId, fromNodeId, "offline");
            return { ok: true };
          case "notify":
            return { ok: true };
          case "message_peer": {
            const message = (p.message as string) ?? "";
            const peer = (p.peer as string) ?? toNodeId;
            const targetId = peer || toNodeId;
            const res = await busStore.sendMessage(canvasId, fromNodeId, targetId, message);
            return { delivered: res.delivered, from: fromNodeId, to: targetId, id: res.id, ts: res.ts };
          }
          case "task":
            return { echo: p };
          default:
            return { ok: false, error: { code: "bad-params", message: "unknown op" } };
        }
      },
    },

    // ---------------- activity logs (route: /api/logs) ----------------
    {
      kind: "bridge",
      id: "activity.snapshot",
      description: "list activity-log entries (canvas/node/kind/limit filters)",
      handler: async (p = {}) => {
        const canvasId = (p.canvas as string) ?? "default";
        const limit = Math.min(500, Math.max(1, Number(p.limit) || 200));
        const where: { canvasId: string; nodeId?: string; kind?: string } = { canvasId };
        if (p.node) where.nodeId = p.node;
        if (p.kind) where.kind = p.kind;

        const logs = await db.agentLog.findMany({ where, orderBy: { createdAt: "asc" }, take: limit });
        const entries = logs.map((r: any) => {
          let meta: Record<string, unknown> | undefined;
          try {
            meta = r.payload ? JSON.parse(r.payload) : undefined;
          } catch {
            meta = undefined;
          }
          return {
            id: r.id,
            ts: r.createdAt.getTime(),
            kind: String(r.kind),
            text: r.text ?? "",
            nodeId: r.nodeId ?? undefined,
            meta,
          };
        });
        return { entries };
      },
    },
    {
      kind: "bridge",
      id: "activity.record",
      description: "append a batch of activity-log entries (validated + FK-stubbed)",
      schema: (p) =>
        Array.isArray(p?.entries) ? { ok: true } : { ok: false, message: "entries array required" },
      handler: async (p = {}) => {
        const canvasId = (p.canvasId as string) ?? "default";
        const raw = Array.isArray(p.entries) ? p.entries : [];
        const rows = raw
          .filter((e: any) => e && typeof e.kind === "string" && LOG_KINDS.has(e.kind))
          .map((e: any) => ({
            canvasId,
            nodeId: String(e.nodeId ?? "commander").slice(0, 200),
            kind: String(e.kind),
            text: String(e.text ?? "").slice(0, 1000),
            payload: JSON.stringify(e.meta ?? {}),
            createdAt: e.ts ? new Date(e.ts) : new Date(),
          }));
        if (rows.length === 0) return { written: 0 };

        // FK: ensure the canvas row exists
        await db.canvas.upsert({
          where: { id: canvasId },
          update: {},
          create: { id: canvasId, name: canvasId, state: "{}" },
        });
        // SQLite: no skipDuplicates — cuid ids make collisions practically impossible
        await db.agentLog.createMany({ data: rows });
        return { written: rows.length };
      },
    },
    {
      kind: "bridge",
      id: "__ops.logsClear",
      description: "clear all activity-log entries for a canvas (autumn-private)",
      schema: (p) => (typeof p?.canvas === "string" ? { ok: true } : { ok: false, message: "canvas required" }),
      handler: async (p) => {
        if (!p.canvas) return { ok: false, error: { code: "bad-params", message: "canvas required" } };
        await db.agentLog.deleteMany({ where: { canvasId: p.canvas } });
        return { ok: true };
      },
    },

    // ---------------- commander (route: /api/commander) ----------------
    {
      kind: "bridge",
      id: "__ops.commander",
      description: "autumn Commander planning (deterministic fallback planner)",
      schema: (p) =>
        typeof p?.command === "string" && p?.canvas
          ? { ok: true }
          : { ok: false, message: "command and canvas are required" },
      handler: async (p) => {
        const { command, canvas, lastTurn, recentActions } = p ?? {};
        if (!command || !canvas) {
          return { ok: false, error: { code: "bad-params", message: "command and canvas are required" } };
        }
        // Prompts are built for parity with the route (future LLM re-enable);
        // currently unused — Z-AI was removed, deterministic planner only.
        void buildCommanderPrompts(command, canvas, lastTurn, recentActions);
        return { ...fallbackPlan(command, canvas), _fallback: true };
      },
    },

    // ---------------- agent run (route: /api/agent/run) ----------------
    {
      kind: "bridge",
      id: "__ops.agentRun",
      description: "one-shot coding-agent CLI run via spawner (autumn-private)",
      schema: (p) =>
        typeof p?.personaId === "string" && typeof p?.harness === "string" && typeof p?.task === "string"
          ? { ok: true }
          : { ok: false, message: "personaId, harness and task are required" },
      handler: async (p) => {
        const { personaId, harness, task, canvasId, peerContext, connectedPeers, history } = p ?? {};
        const persona = personas.PERSONA_BY_ID[personaId as string];
        if (!persona) return { ok: false, error: { code: "bad-params", message: "Unknown persona" } };

        const result = await spawner.runAgent({
          harness,
          task,
          canvasId: canvasId ?? "default",
          nodeId: personaId,
          personaName: persona.name,
          peerContext,
          connectedPeers,
          history: ((history ?? []) as AgentMessage[])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(-6)
            .map((m) => ({ role: m.role as "user" | "assistant", text: m.text })),
        });
        return {
          text: result.text,
          simulated: result.simulated,
          fellBack: result.fellBack,
          error: result.error,
        };
      },
    },
  ];

  return handlers;
}

// ---------------------------------------------------------------------------
// Commander internals (ported from /api/commander/route.ts)
// ---------------------------------------------------------------------------

function buildCommanderPrompts(
  command: string,
  canvas: CanvasSnapshot,
  lastTurn?: string,
  recentActions?: string[],
): { system: string; user: string } {
  // Lazy require avoids a cycle and matches the route's import shape.
  const { COMMANDER_SYSTEM_PROMPT, buildCompilerUserPrompt } = require("@/lib/autumn/commander-prompt");
  const system = COMMANDER_SYSTEM_PROMPT.replace(
    "{{CANVAS}}",
    canvas.nodes.length === 0
      ? "(empty canvas)"
      : canvas.nodes
          .map(
            (n: any) =>
              `${n.id} · ${n.kind} · ${n.name}${n.status ? ` [${n.status}]` : ""}${n.harness ? ` (${n.harness})` : ""}${n.doing ? ` — "${n.doing}"` : ""}`,
          )
          .join("\n") +
        "\nCONNECTIONS:\n" +
        (canvas.connections.length === 0
          ? "(none)"
          : canvas.connections.map((c: any) => `${c.from} → ${c.to}`).join("\n")),
  );
  const user = buildCompilerUserPrompt(command, canvas, lastTurn, recentActions);
  return { system, user };
}

/** Deterministic fallback planner — verbatim port of the route's logic. */
function fallbackPlan(command: string, _canvas: CanvasSnapshot): CommanderResult {
  const c = command.toLowerCase();

  const connectMatch = command.match(/connect\s+(\w+)\s+(?:to|and|with)\s+(\w+)/i);
  if (connectMatch) {
    return {
      kind: "steps",
      steps: [{ action: "connect_nodes", args: { from: connectMatch[1], to: connectMatch[2] } }],
      say: `Connecting ${connectMatch[1]} to ${connectMatch[2]}.`,
      listen: false,
    } as CommanderResult;
  }

  const spawnMatch = c.match(/(\d+)\s+(?:claude code|codex|agents?|chat)/);
  if (spawnMatch) {
    const count = parseInt(spawnMatch[1], 10);
    return {
      kind: "steps",
      steps: [{ action: "add_agents", args: { count } }],
      say: `Spawning ${count} agents.`,
    } as CommanderResult;
  }

  if (/build|create|make|start/i.test(command)) {
    return {
      kind: "steps",
      steps: [
        { action: "add_chat", args: {} },
        { action: "add_screen", args: { kind: "desktop" } },
        { action: "connect_nodes", args: { from: "@1", to: "@2" } },
        { action: "send_to_node", args: { id: "@1", text: command } },
      ],
      say: "Spawning an agent and handing it your task.",
    } as CommanderResult;
  }

  return {
    kind: "ask",
    ask: "What would you like me to build or orchestrate?",
    options: [
      "Spawn two Claude Code agents",
      "Open a phone preview screen",
      "Drop a sticky note with my idea",
    ],
  } as CommanderResult;
}
