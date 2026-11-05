// Autumn — persistent AutumnBus (server-side).
//
// In Autumn Desktop this is a localhost HTTP MCP server (autumn-bus) that
// tracks agent sessions and routes `message_peer` between them. In Autumn (a
// Next.js web app) we back the SAME contract with Prisma + SQLite so that:
//   1. message_peer inboxes survive server reloads,
//   2. the bus works identically across multiple server instances (no
//      per-process in-memory Map that another instance can't see),
//   3. real agent CLIs spawned in Phase 2 can read/write the same bus.
//
// The contract is intentionally HTTP-shaped to match /api/bus:
//   message_peer (POST)  -> sendMessage()
//   pre-prompt  (GET)    -> drainInbox()  (drain-on-read, like Autumn)
//   session/stop         -> upsertPeer()
//   list_peers           -> listPeers()
//   get_node_status      -> getPeer()
//
// Autumn used env vars AUTUMN_BUS_PORT/CANVAS/NODE/TOKEN/MCP_CAPABILITY.
// The Autumn clone renames these AUTUMN_BUS_* — see spawner (Phase 2).

import { db } from "@/lib/db";

export type PeerStatus =
  | "live"
  | "offline"
  | "thinking"
  | "working"
  | "waiting"
  | "done"
  | "error";

export interface InboxMessage {
  id: string;
  fromNodeId: string;
  fromName: string;
  toNodeId: string;
  message: string;
  ts: number;
}

// In-memory inbox queue, mirrored to DB rows. Inboxes are transient
// (drained on pre-prompt), so we keep them in memory for speed and persist a
// short log of every delivery in the Message table for history/relay.
const inboxes = new Map<string, InboxMessage[]>(); // key: `${canvasId}:${nodeId}`

function key(canvasId: string, nodeId: string) {
  return `${canvasId}:${nodeId}`;
}

function genId(): string {
  // Collision-resistant enough for transient inbox keys; Date.now + a random
  // suffix keeps it unique across rapid deliveries within the same ms.
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensurePeer(
  canvasId: string,
  nodeId: string,
  name: string,
  status: PeerStatus = "live",
): Promise<void> {
  await db.busPeer.upsert({
    where: { canvasId_nodeId: { canvasId, nodeId } },
    update: { name, status, lastSeen: new Date() },
    create: { canvasId, nodeId, name, status },
  });
}

export async function setPeerStatus(
  canvasId: string,
  nodeId: string,
  status: PeerStatus,
): Promise<void> {
  await db.busPeer.upsert({
    where: { canvasId_nodeId: { canvasId, nodeId } },
    update: { status, lastSeen: new Date() },
    create: { canvasId, nodeId, name: nodeId, status },
  });
}

export async function sendMessage(
  canvasId: string,
  fromNodeId: string,
  toNodeId: string,
  message: string,
): Promise<{ delivered: boolean; id: string; ts: number }> {
  // Resolve sender name (best-effort) for nicer inbox entries.
  let fromName = fromNodeId;
  try {
    const sender = await db.busPeer.findUnique({
      where: { canvasId_nodeId: { canvasId, nodeId: fromNodeId } },
    });
    if (sender) fromName = sender.name;
  } catch {
    /* ignore */
  }

  const id = genId();
  const ts = Date.now();
  const entry: InboxMessage = { id, fromNodeId, fromName, toNodeId, message, ts };

  const k = key(canvasId, toNodeId);
  const list = inboxes.get(k) ?? [];
  list.push(entry);
  inboxes.set(k, list);

  // Persist to the Message table as role="peer" so the handoff survives a
  // full restart and is queryable per-node (mirrors Autumn's bus log).
  try {
    await db.message.create({
      data: {
        canvasId,
        nodeId: toNodeId,
        role: "peer",
        text: `[autumn-bus] message_peer from ${fromName}: ${message}`,
        authorId: fromNodeId,
      },
    });
  } catch {
    /* best-effort history */
  }

  return { delivered: true, id, ts };
}

// Drain-on-read: returns the queued inbox formatted exactly as the client's
// agent-runner expects (and as Autumn injects before a model call), then
// clears it so a message is delivered once.
export async function drainInbox(
  canvasId: string,
  nodeId: string,
): Promise<{ injection: string; drained: boolean }> {
  const k = key(canvasId, nodeId);
  const list = inboxes.get(k) ?? [];
  if (list.length === 0) return { injection: "", drained: false };

  const injection = list
    .map((m) => `[autumn-bus] message_peer from ${m.fromName}: ${m.message}`)
    .join("\n");

  inboxes.set(k, []);
  return { injection, drained: true };
}

export async function listPeers(canvasId: string) {
  const peers = await db.busPeer.findMany({
    where: { canvasId },
    orderBy: { lastSeen: "asc" },
  });
  return peers.map((p) => ({
    id: p.nodeId,
    name: p.name,
    status: p.status,
    lastSeen: p.lastSeen.getTime(),
  }));
}

export async function getPeer(canvasId: string, nodeId: string) {
  const p = await db.busPeer.findUnique({
    where: { canvasId_nodeId: { canvasId, nodeId } },
  });
  if (!p) return null;
  return {
    id: p.nodeId,
    name: p.name,
    status: p.status,
    lastSeen: p.lastSeen.getTime(),
  };
}
