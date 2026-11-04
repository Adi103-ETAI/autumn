// autumn — Wave-1 handlers: bus (30 dispatchable renderer-used ids; doc 31).
//
// Backing is REAL where autumn has it: busStore (ensurePeer/setPeerStatus/
// sendMessage/drainInbox/listPeers/getPeer) and Prisma db (busPeer/message/
// edge/agentLog). October-only subsystems autumn does not have
// (harness repo install/uninstall, cloud sync, collaborator devices, consent
// flow, codex-daemon) return honest `{supported:false}` / empty results or a
// deliberate `not-implemented` envelope — never fabricated data (doc 31 §4).
// `bus.octoberSend` and `bus.cancelOctoberTask` keep their target ids verbatim
// (RE oracle). Registered by index.ts; do not edit shared files.
//
// Events: `bus.onActivity` and `bus.onConsent` fire ONLY on real triggers
// (a real octoberSend / a real consent decision). Otherwise unemitted.

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

const validCanvas = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0");
const validNode = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0");

export function makeBusHandlers(deps: W1Deps): RegisteredHandler[] {
  const { busStore, db, emit, now } = deps;

  /** Emit bus.onActivity only on a real activity-producing mutation. */
  const activity = (canvasId: string, kind: string, detail?: Record<string, unknown>) =>
    emit("bus.onActivity", { canvasId, kind, ts: now(), ...(detail ?? {}) });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "bus.activityView",
      description:
        "view activity for a canvas/node; params: { canvasId, nodeId?, limit? } -> { items: [{ id, kind, text, nodeId, ts }] } (empty array when none)",
      schema: (p) =>
        validCanvas(p?.canvasId) &&
        (p?.nodeId === undefined || validNode(p.nodeId)) &&
        (p?.limit === undefined || Number.isFinite(p.limit) && p.limit >= 1)
          ? { ok: true }
          : { ok: false, message: "canvasId required; nodeId/limit optional" },
      handler: async (p = {}) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const limit = Math.min(500, Math.max(1, Number(p.limit) || 50));
        const where: { canvasId: string; nodeId?: string } = { canvasId: p.canvasId };
        if (p.nodeId) where.nodeId = p.nodeId;
        const rows = await db.agentLog.findMany({
          where, orderBy: { createdAt: "desc" }, take: limit,
          select: { id: true, kind: true, text: true, nodeId: true, createdAt: true },
        });
        return { items: rows.map((r: any) => ({ id: r.id, kind: r.kind, text: r.text, nodeId: r.nodeId, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "bus.automationPreferences",
      description:
        "read automation preferences; params: { canvasId? } -> { supported:false, preferences } (autumn has no automation-preferences store)",
      schema: () => ({ ok: true }),
      handler: () =>
        ({ supported: false, preferences: {}, reason: "no automation-preferences store in autumn" }),
    },
    {
      kind: "bridge",
      id: "bus.cancelOctoberTask",
      description:
        "cancel a task; params: { taskId } -> not-implemented (autumn tracks no cancelable task queue)",
      schema: (p) => (typeof p?.taskId === "string" ? { ok: true } : { ok: false, message: "taskId required" }),
      handler: (p) => {
        if (typeof p?.taskId !== "string") return badParams("taskId required");
        return notImplemented("cancelOctoberTask needs a cancelable task queue, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "bus.claimProjectChatInbox",
      description:
        "claim/drain a node's inbox (pre-prompt); params: { canvasId, nodeId } -> busStore.drainInbox result",
      schema: (p) => (validCanvas(p?.canvasId) && validNode(p?.nodeId) ? { ok: true } : { ok: false, message: "canvasId and nodeId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.nodeId)) return badParams("canvasId and nodeId required");
        return busStore.drainInbox(p.canvasId, p.nodeId);
      },
    },
    {
      kind: "bridge",
      id: "bus.consentAllowances",
      description:
        "read consent allowances; params: {} -> { supported:false, allowances: [] } (autumn has no consent store)",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, allowances: [], reason: "no consent store in autumn" }),
    },
    {
      kind: "bridge",
      id: "bus.consentRequests",
      description:
        "read pending consent requests; params: {} -> { supported:false, requests: [] }",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, requests: [], reason: "no consent store in autumn" }),
    },
    {
      kind: "bridge",
      id: "bus.decideConsent",
      description:
        "decide a consent request; params: { requestId, decision } -> not-implemented (no consent store)",
      schema: (p) =>
        typeof p?.requestId === "string" && typeof p?.decision === "string"
          ? { ok: true }
          : { ok: false, message: "requestId and decision required" },
      handler: (p) => {
        if (typeof p?.requestId !== "string" || typeof p?.decision !== "string") return badParams("requestId and decision required");
        return notImplemented("decideConsent needs a consent store, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "bus.deliverInbox",
      description:
        "deliver inbox messages to a node; params: { canvasId, nodeId } -> drains inbox via busStore",
      schema: (p) => (validCanvas(p?.canvasId) && validNode(p?.nodeId) ? { ok: true } : { ok: false, message: "canvasId and nodeId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.nodeId)) return badParams("canvasId and nodeId required");
        const { injection, drained } = await busStore.drainInbox(p.canvasId, p.nodeId);
        if (drained) activity(p.canvasId, "inbox.drained", { nodeId: p.nodeId, drained });
        return { injection, drained };
      },
    },
    {
      kind: "bridge",
      id: "bus.enabled",
      description:
        "is the bus enabled; params: {} -> { enabled: true }",
      schema: () => ({ ok: true }),
      handler: () => ({ enabled: true }),
    },
    {
      kind: "bridge",
      id: "bus.executionStates",
      description:
        "execution states for a canvas; params: { canvasId } -> { states: [{ nodeId, status }] } from db.busPeer",
      schema: (p) => (validCanvas(p?.canvasId) ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const peers = await db.busPeer.findMany({ where: { canvasId: p.canvasId } });
        return { states: peers.map((p: any) => ({ nodeId: p.nodeId, status: p.status })) };
      },
    },
    {
      kind: "bridge",
      id: "bus.harnessReadiness",
      description:
        "harness readiness (from spawner.HARNESS_BIN); params: {} -> { ready: [{ harness, installed }] }",
      schema: () => ({ ok: true }),
      handler: async () => {
        const spawner = deps.spawner;
        const bins = spawner?.HARNESS_BIN ?? {};
        return { ready: Object.entries(bins).map(([h, bin]) => ({ harness: h, installed: !!bin, binary: bin })) };
      },
    },
    {
      kind: "bridge",
      id: "bus.installRepo",
      description:
        "install a harness repo; params: {} -> not-implemented (autumn has no harness repo installer)",
      schema: () => ({ ok: true }),
      handler: () => notImplemented("installRepo needs a harness repo installer, which autumn does not have"),
    },
    {
      kind: "bridge",
      id: "bus.learnCollaboratorDevice",
      description:
        "learn a collaborator device; params: {} -> { supported:false, devices: [] }",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, devices: [], reason: "no collaborator-device store in autumn" }),
    },
    {
      kind: "bridge",
      id: "bus.nodeRemoved",
      description:
        "mark a peer offline (node removed); params: { canvasId, nodeId } -> busStore.setPeerStatus offline",
      schema: (p) => (validCanvas(p?.canvasId) && validNode(p?.nodeId) ? { ok: true } : { ok: false, message: "canvasId and nodeId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.nodeId)) return badParams("canvasId and nodeId required");
        await busStore.setPeerStatus(p.canvasId, p.nodeId, "offline");
        activity(p.canvasId, "node.removed", { nodeId: p.nodeId });
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "bus.octoberSend",
      description:
        "send a bus message peer->peer (target id kept verbatim); params: { canvasId, fromNodeId, toNodeId, message } -> busStore.sendMessage result; emits bus.onActivity",
      schema: (p) =>
        validCanvas(p?.canvasId) && validNode(p?.fromNodeId) && validNode(p?.toNodeId) && typeof p?.message === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId, fromNodeId, toNodeId (valid ids) and message (string) required" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.fromNodeId) || !validNode(p.toNodeId) || typeof p.message !== "string") {
          return badParams("canvasId, fromNodeId, toNodeId (valid ids) and message (string) required");
        }
        const res = await busStore.sendMessage(p.canvasId, p.fromNodeId, p.toNodeId, p.message);
        activity(p.canvasId, "message_peer", { from: p.fromNodeId, to: p.toNodeId, messageId: res.id });
        return { delivered: res.delivered, from: p.fromNodeId, to: p.toNodeId, id: res.id, ts: res.ts };
      },
    },
    {
      kind: "bridge",
      id: "bus.pendingCounts",
      description:
        "pending counts per canvas; params: { canvasId } -> { counts: { peers, messages } } from db",
      schema: (p) => (validCanvas(p?.canvasId) ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const [peers, messages] = await Promise.all([
          db.busPeer.count({ where: { canvasId: p.canvasId } }),
          db.message.count({ where: { canvasId: p.canvasId } }),
        ]);
        return { counts: { peers, messages } };
      },
    },
    {
      kind: "bridge",
      id: "bus.previewUninstall",
      description:
        "preview uninstall; params: {} -> not-implemented (autumn has no uninstaller)",
      schema: () => ({ ok: true }),
      handler: () => notImplemented("previewUninstall needs an uninstaller, which autumn does not have"),
    },
    {
      kind: "bridge",
      id: "bus.receiveCollaboratorMessage",
      description:
        "receive a collaborator message; params: {} -> { supported:false, messages: [] }",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, messages: [], reason: "no collaborator channel in autumn" }),
    },
    {
      kind: "bridge",
      id: "bus.recentActivity",
      description:
        "recent activity entries; params: { canvasId, limit? } -> { items: [...] } from db.agentLog (empty array when none)",
      schema: (p) =>
        validCanvas(p?.canvasId) && (p?.limit === undefined || (Number.isFinite(p.limit) && p.limit >= 1))
          ? { ok: true }
          : { ok: false, message: "canvasId required; limit optional positive number" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const limit = Math.min(100, Math.max(1, Number(p.limit) || 20));
        const rows = await db.agentLog.findMany({
          where: { canvasId: p.canvasId }, orderBy: { createdAt: "desc" }, take: limit,
          select: { id: true, kind: true, text: true, nodeId: true, createdAt: true },
        });
        return { items: rows.map((r: any) => ({ id: r.id, kind: r.kind, text: r.text, nodeId: r.nodeId, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "bus.registerNode",
      description:
        "register a bus peer; params: { canvasId, nodeId, name?, status? } -> busStore.ensurePeer result",
      schema: (p) =>
        validCanvas(p?.canvasId) && validNode(p?.nodeId) &&
        (p?.name === undefined || typeof p.name === "string") &&
        (p?.status === undefined || typeof p.status === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId and nodeId required; name/status optional strings" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.nodeId)) return badParams("canvasId and nodeId required");
        await busStore.ensurePeer(p.canvasId, p.nodeId, p.name ?? p.nodeId, (p.status ?? "live") as never);
        activity(p.canvasId, "node.registered", { nodeId: p.nodeId });
        return { ok: true, nodeId: p.nodeId };
      },
    },
    {
      kind: "bridge",
      id: "bus.resolveDeliveryUncertainty",
      description:
        "resolve message delivery uncertainty; params: { messageId } -> not-implemented (no delivery-tracking store)",
      schema: (p) => (typeof p?.messageId === "string" ? { ok: true } : { ok: false, message: "messageId required" }),
      handler: (p) => {
        if (typeof p?.messageId !== "string") return badParams("messageId required");
        return notImplemented("resolveDeliveryUncertainty needs a delivery store, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "bus.revokeConsent",
      description:
        "revoke consent; params: { requestId } -> not-implemented (no consent store)",
      schema: (p) => (typeof p?.requestId === "string" ? { ok: true } : { ok: false, message: "requestId required" }),
      handler: (p) => {
        if (typeof p?.requestId !== "string") return badParams("requestId required");
        return notImplemented("revokeConsent needs a consent store, which autumn does not have");
      },
    },
    {
      kind: "bridge",
      id: "bus.saveAutomationPreferences",
      description:
        "save automation preferences; params: { preferences } -> { supported:false } (no store to persist to)",
      schema: (p) => (p?.preferences !== undefined && typeof p.preferences === "object" ? { ok: true } : { ok: false, message: "preferences object required" }),
      handler: (p) => {
        if (p?.preferences === undefined || typeof p.preferences !== "object") return badParams("preferences object required");
        return { supported: false, saved: false, reason: "no automation-preferences store in autumn" };
      },
    },
    {
      kind: "bridge",
      id: "bus.setDeliveryPolicy",
      description:
        "set delivery policy; params: { policy } -> { supported:false } (no delivery-policy store)",
      schema: (p) => (typeof p?.policy === "string" ? { ok: true } : { ok: false, message: "policy string required" }),
      handler: (p) => {
        if (typeof p?.policy !== "string") return badParams("policy string required");
        return { supported: false, applied: false, reason: "no delivery-policy store in autumn" };
      },
    },
    {
      kind: "bridge",
      id: "bus.setEdges",
      description:
        "set edges for a canvas; params: { canvasId, edges: [{ sourceId, targetId, kind?, data? }] } -> upserts db.edge rows",
      schema: (p) =>
        validCanvas(p?.canvasId) && Array.isArray(p?.edges)
          ? { ok: true }
          : { ok: false, message: "canvasId required; edges must be an array" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !Array.isArray(p.edges)) return badParams("canvasId required; edges must be an array");
        const edges = p.edges as Array<{ sourceId: string; targetId: string; kind?: string; data?: any }>;
        for (const e of edges) {
          if (typeof e.sourceId !== "string" || typeof e.targetId !== "string") {
            return badParams("each edge needs sourceId and targetId strings");
          }
          await db.edge.upsert({
            where: { id: `edge-${p.canvasId}-${e.sourceId}-${e.targetId}` },
            update: { kind: e.kind ?? "bus", data: JSON.stringify(e.data ?? {}) },
            create: { id: `edge-${p.canvasId}-${e.sourceId}-${e.targetId}`, canvasId: p.canvasId, kind: e.kind ?? "bus", sourceId: e.sourceId, targetId: e.targetId, data: JSON.stringify(e.data ?? {}) },
          });
        }
        activity(p.canvasId, "edges.set", { count: edges.length });
        return { ok: true, edges: edges.length };
      },
    },
    {
      kind: "bridge",
      id: "bus.setResourceContexts",
      description:
        "set resource contexts; params: { contexts } -> { supported:false } (no resource-context store)",
      schema: (p) => (Array.isArray(p?.contexts) ? { ok: true } : { ok: false, message: "contexts array required" }),
      handler: (p) => {
        if (!Array.isArray(p.contexts)) return badParams("contexts array required");
        return { supported: false, applied: false, reason: "no resource-context store in autumn" };
      },
    },
    {
      kind: "bridge",
      id: "bus.startChatTurn",
      description:
        "start a chat turn (ensure a live peer); params: { canvasId, nodeId, name? } -> busStore.ensurePeer result",
      schema: (p) => (validCanvas(p?.canvasId) && validNode(p?.nodeId) ? { ok: true } : { ok: false, message: "canvasId and nodeId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validNode(p.nodeId)) return badParams("canvasId and nodeId required");
        await busStore.ensurePeer(p.canvasId, p.nodeId, p.name ?? p.nodeId, "live" as never);
        activity(p.canvasId, "chat.turn.started", { nodeId: p.nodeId });
        return { ok: true, nodeId: p.nodeId };
      },
    },
    {
      kind: "bridge",
      id: "bus.stopCloudSync",
      description:
        "stop cloud sync; params: {} -> not-implemented (autumn has no cloud sync)",
      schema: () => ({ ok: true }),
      handler: () => notImplemented("stopCloudSync needs a cloud-sync client, which autumn does not have"),
    },
    {
      kind: "bridge",
      id: "bus.terminalExposure",
      description:
        "terminal exposure flag; params: {} -> { exposed: false } (autumn exposes no terminal by default)",
      schema: () => ({ ok: true }),
      handler: () => ({ exposed: false }),
    },
    {
      kind: "bridge",
      id: "bus.uninstall",
      description:
        "uninstall; params: {} -> not-implemented (autumn has no uninstaller)",
      schema: () => ({ ok: true }),
      handler: () => notImplemented("uninstall needs an uninstaller, which autumn does not have"),
    },
  ];

  return handlers;
}
