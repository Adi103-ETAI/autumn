// Autumn — Activity log persistence API.
// Persists ActivityEntry-like records to the Prisma AgentLog table so the
// timeline survives page reloads and can be queried per-canvas / per-node.
//
// GET  /api/logs?canvas=X                → list all entries for canvas (newest last)
// GET  /api/logs?canvas=X&node=Y         → filtered to a single node
// GET  /api/logs?canvas=X&kind=K         → filtered to a single kind
// GET  /api/logs?canvas=X&limit=200      → cap result count
// POST /api/logs                          → append a batch of entries
//        body: { canvasId, entries: [{ kind, text, nodeId?, meta?, ts? }] }
// DELETE /api/logs?canvas=X               → clear all entries for a canvas

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set([
  "commander_plan",
  "agent_status",
  "agent_message",
  "bus_message_peer",
  "task_claim",
  "task_complete",
  "task_add",
  "node_added",
  "node_removed",
  "edge_added",
  "edge_removed",
  "canvas_saved",
  "canvas_loaded",
  "canvas_cleared",
  "duplicate_node",
  "search",
  "agent_session_start",
  "agent_session_stop",
]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const canvasId = url.searchParams.get("canvas") ?? "default";
  const nodeId = url.searchParams.get("node");
  const kind = url.searchParams.get("kind");
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "200")),
  );

  try {
    const where: {
      canvasId: string;
      nodeId?: string;
      kind?: string;
    } = { canvasId };
    if (nodeId) where.nodeId = nodeId;
    if (kind) where.kind = kind;

    const logs = await db.agentLog.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Map DB rows back into the ActivityEntry shape used by the store.
    const entries = logs.map((r) => {
      let meta: Record<string, unknown> | undefined;
      try {
        meta = r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : undefined;
      } catch {
        meta = undefined;
      }
      return {
        id: r.id,
        ts: r.createdAt.getTime(),
        kind: r.kind as string,
        text: r.text ?? "",
        nodeId: r.nodeId ?? undefined,
        meta,
      };
    });

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[logs GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: {
    canvasId?: string;
    entries?: Array<{
      kind?: string;
      text?: string;
      nodeId?: string;
      meta?: Record<string, unknown>;
      ts?: number;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const canvasId = body.canvasId ?? "default";
  const raw = Array.isArray(body.entries) ? body.entries : [];

  // Filter + normalize entries before writing.
  const rows = raw
    .filter((e) => e && typeof e.kind === "string" && KINDS.has(e.kind as string))
    .map((e) => ({
      canvasId,
      nodeId: (e.nodeId ?? "commander").slice(0, 200),
      kind: e.kind as string,
      text: (e.text ?? "").slice(0, 1000),
      payload: JSON.stringify(e.meta ?? {}),
      createdAt: e.ts ? new Date(e.ts) : new Date(),
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  try {
    // Ensure the canvas row exists to satisfy the FK constraint.
    // If the canvas hasn't been saved yet (id="default" or similar), create a stub.
    await db.canvas.upsert({
      where: { id: canvasId },
      update: {},
      create: { id: canvasId, name: canvasId, state: "{}" },
    });

    // createMany is much faster than per-row inserts.
    // NOTE: SQLite doesn't support skipDuplicates — we rely on cuid() ids
    // being unique so duplicates are essentially impossible.
    await db.agentLog.createMany({ data: rows });
    return NextResponse.json({ ok: true, written: rows.length });
  } catch (err) {
    console.error("[logs POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const canvasId = url.searchParams.get("canvas");
  if (!canvasId) {
    return NextResponse.json({ error: "canvas required" }, { status: 400 });
  }
  try {
    await db.agentLog.deleteMany({ where: { canvasId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[logs DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}
