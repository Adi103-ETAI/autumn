// Autumn — AutumnBus HTTP server (web adapter).
// In October, this is a localhost HTTP server with /mcp + /hook/* routes.
// In the web app we adapt the same contract to Next.js API routes.
// See 15-agent-interop.md for the full bus contract.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// In-memory bus state (per server instance). In production this would be
// shared via Yjs or a real backend; for the web demo it's per-process.
interface BusNode {
  id: string;
  name: string;
  status: string;
  inbox: { from: string; message: string; ts: number }[];
}
interface BusState {
  canvases: Map<string, Map<string, BusNode>>; // canvasId -> nodeId -> node
}
const bus: BusState = { canvases: new Map() };

function getCanvas(canvasId: string) {
  let c = bus.canvases.get(canvasId);
  if (!c) {
    c = new Map();
    bus.canvases.set(canvasId, c);
  }
  return c;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const op = url.searchParams.get("op") ?? "message_peer";
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const canvasId = (body.canvasId as string) ?? "default";
  const fromNodeId = (body.fromNodeId as string) ?? "unknown";
  const toNodeId = (body.toNodeId as string) ?? "unknown";
  const canvas = getCanvas(canvasId);

  switch (op) {
    case "session": {
      const node = ensureNode(canvas, fromNodeId, body.name as string);
      node.status = (body.status as string) ?? "live";
      return NextResponse.json({ ok: true, node: serialize(node) });
    }
    case "stop": {
      const node = ensureNode(canvas, fromNodeId, body.name as string);
      node.status = "offline";
      return NextResponse.json({ ok: true });
    }
    case "notify": {
      // notify is fire-and-forget; client handles UI feedback
      return NextResponse.json({ ok: true });
    }
    case "message_peer": {
      const message = (body.message as string) ?? "";
      const peer = (body.peer as string) ?? toNodeId;
      const target = canvas.get(peer) ?? canvas.get(toNodeId);
      if (target) {
        target.inbox.push({ from: fromNodeId, message, ts: Date.now() });
      } else {
        // create a stub peer entry so the inbox survives
        const stub = ensureNode(canvas, toNodeId, toNodeId);
        stub.inbox.push({ from: fromNodeId, message, ts: Date.now() });
      }
      return NextResponse.json({
        ok: true,
        delivered: true,
        from: fromNodeId,
        to: toNodeId,
        ts: Date.now(),
      });
    }
    case "task": {
      // task board ops are handled client-side (store); this is just a hook echo
      return NextResponse.json({ ok: true, echo: body });
    }
    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const op = url.searchParams.get("op") ?? "pre-prompt";
  const canvasId = url.searchParams.get("canvas") ?? "default";
  const nodeId = url.searchParams.get("node") ?? "";

  const canvas = getCanvas(canvasId);
  const node = nodeId ? canvas.get(nodeId) : undefined;

  switch (op) {
    case "pre-prompt": {
      // Returns the peer-context injection: any messages waiting in this node's
      // inbox, formatted as the bus would inject before the next model call.
      if (!node) return NextResponse.json({ injection: "" });
      const injection = node.inbox.length
        ? node.inbox
            .map(
              (m) =>
                `[autumn-bus] message_peer from ${m.from}: ${m.message}`,
            )
            .join("\n")
        : "";
      // drain inbox
      node.inbox = [];
      return NextResponse.json({ injection, drained: true });
    }
    case "list_peers": {
      const peers = Array.from(canvas.values()).map((n) => ({
        id: n.id,
        name: n.name,
        status: n.status,
      }));
      return NextResponse.json({ peers });
    }
    case "get_node_status": {
      if (!node) return NextResponse.json({ status: "unknown" });
      return NextResponse.json(serialize(node));
    }
    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}

function ensureNode(canvas: Map<string, BusNode>, id: string, name: string) {
  let n = canvas.get(id);
  if (!n) {
    n = { id, name: name || id, status: "live", inbox: [] };
    canvas.set(id, n);
  }
  return n;
}

function serialize(n: BusNode) {
  return {
    id: n.id,
    name: n.name,
    status: n.status,
    inboxSize: n.inbox.length,
  };
}
