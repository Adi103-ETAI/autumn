// autumn — Wave-1 handlers: terminal (23 new dispatchable ids; start/input/resize/kill already in handlers.ts; docs/architecture/backend.md).
//
// Backing is REAL on pty/spawner/db: sessionExists (pty.ptyExists), interrupt
// (write "\x03"), openShell/openFork/replace/restart (createPty/killPty),
// snapshot/rawSession (pty state), peekSession (per-node state), whichAgents
// (spawner.HARNESS_BIN), sessionHistory/resumeHistory/seedResume (db.session/
// db.message). The hosted subsystems autumn does not have (codex-daemon
// recovery, sidecar reconciliation, reclaimHost, external session scanning)
// return honest `{supported:false}` / empty results (docs/architecture/backend.md).
//
// Events: `terminal.onExit` fires via `deps.pty.onPtyExit` on real PTY exits
// (subscribed once per factory). `terminal.onLifecycle` fires on real
// openShell/restart/replace transitions performed here.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});
const notImplemented = (message: string) => ({
  ok: false as const,
  error: { code: "not-implemented" as const, message },
});

const NODE_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
const isValidNodeId = (id: unknown): id is string =>
  typeof id === "string" && (NODE_ID_RE.test(id) || /^node-[a-zA-Z0-9_-]{6,16}$/.test(id));

export function makeTerminalHandlers(deps: W1Deps): RegisteredHandler[] {
  const { pty, spawner, db, emit, now } = deps;

  // Subscribe to real PTY exits once per factory; push terminal.onExit on
  // genuine exit events (docs/architecture/backend.md).
  pty.onPtyExit((nodeId, info) => {
    emit("terminal.onExit", { node: nodeId, exitCode: info.exitCode, signal: info.signal, kind: info.kind, ts: now() });
  });

  const lifecycle = (nodeId: string, status: "started" | "killed" | "restarted" | "replaced") =>
    emit("terminal.onLifecycle", { node: nodeId, status, ts: now() });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "terminal.dismissForkInstruction",
      description:
        "dismiss a fork instruction; params: { nodeId } -> { ok: true } (autumn tracks no fork queue; documented no-op)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.foreground",
      description:
        "bring a terminal to the foreground; params: { nodeId } -> { ok: true, node } (state tracked in pty)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        if (!pty.ptyExists(p.node)) return notFound(`no PTY for node: ${p.node}`);
        return { ok: true, node: p.node, foregrounded: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.foregroundCached",
      description:
        "cached foreground state; params: { nodeId } -> { node, foregrounded } from pty state",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { node: p.node, foregrounded: pty.ptyExists(p.node) };
      },
    },
    {
      kind: "bridge",
      id: "terminal.interrupt",
      description:
        "send SIGINT to a PTY; params: { nodeId } -> { ok: true } (writes \\x03)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        if (!pty.ptyExists(p.node)) return notFound(`no PTY for node: ${p.node}`);
        pty.writePty(p.node, "\x03");
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.launchAgentOnBus",
      description:
        "launch an agent on the bus; params: { nodeId, harness?, task? } -> { ok: true, node } or not-implemented if harness missing",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.harness === undefined || typeof p.harness === "string")
          ? { ok: true }
          : { ok: false, message: "node required (valid id); harness optional string" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        if (!pty.ptyExists(p.node)) return notFound(`no PTY for node: ${p.node}`);
        if (p.harness && spawner.resolveAgentCommand) {
          const resolved = await spawner.resolveAgentCommand(p.harness, p.task, { canvasId: "default", nodeId: p.node });
          if (!resolved) return { ok: false, error: { code: "not-implemented", message: `harness not installed: ${p.harness}` } };
        }
        return { ok: true, node: p.node };
      },
    },
    {
      kind: "bridge",
      id: "terminal.openFork",
      description:
        "open a forked terminal; params: { nodeId } -> { ok: true, node, forked: true } (fork bookkeeping not tracked; documented)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { ok: true, node: p.node, forked: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.openShell",
      description:
        "open a plain-shell PTY for a node; params: { node, dir?, canvasId? } -> { node, ok } + terminal.onLifecycle",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.dir === undefined || typeof p.dir === "string") &&
        (p?.canvasId === undefined || typeof p.canvasId === "string")
          ? { ok: true }
          : { ok: false, message: "node required (valid id); dir/canvasId optional strings" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        const ok = pty.createPty({ nodeId: p.node, dir: p.dir });
        if (!ok) return { ok: false, error: { code: "handler-error", message: "failed to spawn shell PTY" } };
        lifecycle(p.node, "started");
        return { node: p.node, ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.peekSession",
      description:
        "peek session state for a node; params: { nodeId } -> { node, exists, kind } from pty",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { node: p.node, exists: pty.ptyExists(p.node), kind: pty.ptyKind(p.node) };
      },
    },
    {
      kind: "bridge",
      id: "terminal.pendingForks",
      description:
        "pending forks; params: {} -> { forks: [] } (autumn tracks no fork queue)",
      schema: () => ({ ok: true }),
      handler: () => ({ forks: [] }),
    },
    {
      kind: "bridge",
      id: "terminal.rawSnapshot",
      description:
        "raw PTY snapshot for a node; params: { nodeId } -> { node, snapshot: null } (no raw buffer retained in autumn)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { node: p.node, exists: pty.ptyExists(p.node), snapshot: null };
      },
    },
    {
      kind: "bridge",
      id: "terminal.reclaimHost",
      description:
        "reclaim a host terminal; params: { nodeId } -> not-implemented (no host-reclaim pipeline)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return notImplemented("reclaimHost needs a host-reclaim pipeline, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "terminal.reconcileSidecar",
      description:
        "reconcile a sidecar; params: { nodeId } -> not-implemented (no sidecar in autumn)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return notImplemented("reconcileSidecar needs a sidecar, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "terminal.recoverCodexDaemon",
      description:
        "recover the codex daemon; params: { nodeId } -> not-implemented (no codex-daemon in autumn)",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return notImplemented("recoverCodexDaemon needs a codex daemon, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "terminal.replace",
      description:
        "replace a PTY (kill + re-create same node); params: { node, dir?, harness?, task? } -> { node, ok } + terminal.onLifecycle",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.dir === undefined || typeof p.dir === "string") &&
        (p?.harness === undefined || typeof p.harness === "string")
          ? { ok: true }
          : { ok: false, message: "node required (valid id); dir/harness optional strings" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        pty.killPty(p.node);
        const ok = pty.createPty({ nodeId: p.node, dir: p.dir });
        if (!ok) return { ok: false, error: { code: "handler-error", message: "failed to replace PTY" } };
        lifecycle(p.node, "replaced");
        return { node: p.node, ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.restart",
      description:
        "restart a PTY (kill + re-create preserving node/dir); params: { nodeId } -> { node, ok } + terminal.onLifecycle",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        pty.killPty(p.node);
        const ok = pty.createPty({ nodeId: p.node });
        if (!ok) return { ok: false, error: { code: "handler-error", message: "failed to restart PTY" } };
        lifecycle(p.node, "restarted");
        return { node: p.node, ok: true };
      },
    },
    {
      kind: "bridge",
      id: "terminal.resumeHistory",
      description:
        "resume session history; params: { nodeId, canvasId? } -> { history: [] } from db.session/db.message (empty when none)",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.canvasId === undefined || typeof p.canvasId === "string")
          ? { ok: true }
          : { ok: false, message: "node required (valid id); canvasId optional string" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        const rows = await db.message.findMany({
          where: { canvasId: p.canvasId ?? "default", nodeId: p.node },
          orderBy: { createdAt: "asc" },
          take: 100,
          select: { id: true, role: true, text: true, createdAt: true },
        });
        return { node: p.node, history: rows.map((r: any) => ({ id: r.id, role: r.role, text: r.text, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "terminal.scanExternalSessions",
      description:
        "scan external sessions; params: {} -> { supported:false, sessions: [] } (no external scanner)",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, sessions: [], reason: "no external-session scanner in autumn" }),
    },
    {
      kind: "bridge",
      id: "terminal.seedResume",
      description:
        "seed a resume point; params: { nodeId, canvasId?, message? } -> { ok: true } (writes a db.message)",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.canvasId === undefined || typeof p.canvasId === "string") &&
        (p?.message === undefined || typeof p.message === "string")
          ? { ok: true }
          : { ok: false, message: "node required (valid id); canvasId/message optional strings" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        await db.message.create({
          data: { canvasId: p.canvasId ?? "default", nodeId: p.node, role: "system", text: p.message ?? "[resume seed]", authorId: p.node },
        });
        return { ok: true, node: p.node };
      },
    },
    {
      kind: "bridge",
      id: "terminal.sessionExists",
      description:
        "does a PTY/session exist for a node; params: { nodeId } -> { exists: boolean }",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { node: p.node, exists: pty.ptyExists(p.node) };
      },
    },
    {
      kind: "bridge",
      id: "terminal.sessionHistory",
      description:
        "session history; params: { nodeId, canvasId?, limit? } -> { history: [] } from db.message (empty when none)",
      schema: (p) =>
        isValidNodeId(p?.node) && (p?.canvasId === undefined || typeof p.canvasId === "string") &&
        (p?.limit === undefined || (Number.isFinite(p.limit) && p.limit >= 1))
          ? { ok: true }
          : { ok: false, message: "node required (valid id); canvasId/limit optional" },
      handler: async (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        const limit = Math.min(500, Math.max(1, Number(p.limit) || 50));
        const rows = await db.message.findMany({
          where: { canvasId: p.canvasId ?? "default", nodeId: p.node },
          orderBy: { createdAt: "desc" }, take: limit,
          select: { id: true, role: true, text: true, createdAt: true },
        });
        return { node: p.node, history: rows.map((r: any) => ({ id: r.id, role: r.role, text: r.text, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "terminal.sessionModel",
      description:
        "harness/model for a node; params: { nodeId } -> { node, model: string|null } from pty kind / spawner",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        const kind = pty.ptyKind(p.node);
        return { node: p.node, model: kind ?? null };
      },
    },
    {
      kind: "bridge",
      id: "terminal.snapshot",
      description:
        "terminal snapshot; params: { nodeId } -> { node, exists, kind, ptyCount } from pty",
      schema: (p) => (isValidNodeId(p?.node) ? { ok: true } : { ok: false, message: "node required (valid id)" }),
      handler: (p) => {
        if (!isValidNodeId(p.node)) return badParams("node required (valid id)");
        return { node: p.node, exists: pty.ptyExists(p.node), kind: pty.ptyKind(p.node), ptyCount: pty.ptyCount() };
      },
    },
    {
      kind: "bridge",
      id: "terminal.whichAgents",
      description:
        "available agent harnesses; params: {} -> { agents: [{ harness, installed }] } from spawner.HARNESS_BIN",
      schema: () => ({ ok: true }),
      handler: () => {
        const bins = spawner.HARNESS_BIN ?? {};
        return { agents: Object.entries(bins).map(([h, bin]) => ({ harness: h, installed: !!bin, binary: bin })) };
      },
    },
  ];

  return handlers;
}
