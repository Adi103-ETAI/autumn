// Autumn — Canvas persistence API.
// GET  /api/canvas          → list all saved canvases
// GET  /api/canvas?id=X     → load a single canvas by id
// POST /api/canvas          → upsert (save) a canvas { id, name, state }
// DELETE /api/canvas?id=X   → delete a canvas

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      const canvas = await db.canvas.findUnique({
        where: { id },
        select: { id: true, name: true, state: true, updatedAt: true },
      });
      if (!canvas) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json(canvas);
    }

    const canvases = await db.canvas.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, updatedAt: true, createdAt: true },
    });
    return NextResponse.json({ canvases });
  } catch (err) {
    console.error("[canvas GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { id?: string; name?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id ?? "default";
  const name = body.name ?? "Untitled Canvas";
  const state = body.state ?? "{}";

  try {
    // Upsert: if the canvas exists, update; otherwise create.
    const existing = await db.canvas.findUnique({ where: { id } });
    let canvas;
    if (existing) {
      canvas = await db.canvas.update({
        where: { id },
        data: { name, state },
        select: { id: true, name: true, updatedAt: true },
      });
    } else {
      canvas = await db.canvas.create({
        data: { id, name, state },
        select: { id: true, name: true, updatedAt: true },
      });
    }
    return NextResponse.json(canvas);
  } catch (err) {
    console.error("[canvas POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  try {
    await db.canvas.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
