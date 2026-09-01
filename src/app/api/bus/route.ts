// Autumn — AutumnBus HTTP server (web adapter).
// In Autumn, this is a localhost HTTP server (autumn-bus) with /mcp + /hook/*
// routes backed by a LocalBusStore. In the web app we adapt the same contract
// to Next.js API routes over Prisma, so message_peer inboxes survive reloads
// and work across server instances. See 15-agent-interop.md / CONTEXT.md §5.
//
// Contract (must stay stable — the client's agent-runner.ts depends on it):
//   POST ?op=message_peer  { canvasId, fromNodeId, toNodeId, peer, message }
//   GET  ?op=pre-prompt    ?canvas&node   -> drains inbox into injection
//   POST ?op=session       { canvasId, fromNodeId, name, status }
//   POST ?op=stop          { canvasId, fromNodeId }
//   GET  ?op=list_peers    ?canvas
//   GET  ?op=get_node_status ?canvas&node
//   POST/GET ?op=notify|task (fire-and-forget hooks)

import { NextRequest, NextResponse } from "next/server";
import {
  ensurePeer,
  setPeerStatus,
  sendMessage,
  drainInbox,
  listPeers,
  getPeer,
} from "@/lib/autumn/bus-store";

export const runtime = "nodejs";

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

  try {
    switch (op) {
      case "session": {
        const node = await ensurePeer(
          canvasId,
          fromNodeId,
          (body.name as string) ?? fromNodeId,
          ((body.status as string) ?? "live") as never,
        );
        return NextResponse.json({ ok: true, node });
      }
      case "stop": {
        await setPeerStatus(canvasId, fromNodeId, "offline");
        return NextResponse.json({ ok: true });
      }
      case "notify": {
        return NextResponse.json({ ok: true });
      }
      case "message_peer": {
        const message = (body.message as string) ?? "";
        const peer = (body.peer as string) ?? toNodeId;
        const targetId = peer || toNodeId;
        const res = await sendMessage(canvasId, fromNodeId, targetId, message);
        return NextResponse.json({
          ok: true,
          delivered: res.delivered,
          from: fromNodeId,
          to: targetId,
          id: res.id,
          ts: res.ts,
        });
      }
      case "task": {
        return NextResponse.json({ ok: true, echo: body });
      }
      default:
        return NextResponse.json({ error: "unknown op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[bus POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bus error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const op = url.searchParams.get("op") ?? "pre-prompt";
  const canvasId = url.searchParams.get("canvas") ?? "default";
  const nodeId = url.searchParams.get("node") ?? "";

  try {
    switch (op) {
      case "pre-prompt": {
        const { injection, drained } = await drainInbox(canvasId, nodeId);
        return NextResponse.json({ injection, drained });
      }
      case "list_peers": {
        const peers = await listPeers(canvasId);
        return NextResponse.json({ peers });
      }
      case "get_node_status": {
        const node = await getPeer(canvasId, nodeId);
        if (!node) return NextResponse.json({ status: "unknown" });
        return NextResponse.json(node);
      }
      default:
        return NextResponse.json({ error: "unknown op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[bus GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bus error" },
      { status: 500 },
    );
  }
}
