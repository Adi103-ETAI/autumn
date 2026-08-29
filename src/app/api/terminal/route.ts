// Autumn — real terminal streaming endpoint (node-pty + SSE).
//
// GET  /api/terminal?node=N[&dir=/path]   → opens an SSE stream of the live
//                                            PTY output for node N (creates the
//                                            PTY on first connect).
// POST /api/terminal  body { node, action, data }  →
//        action: "input"  data: string      → write to PTY
//        action: "resize" cols/rows         → resize PTY
//        action: "kill"                      → kill PTY
//
// The renderer terminal node opens the EventSource and writes user keystrokes
// back via POST. This is the real, interactive shell (replaces static lines).

import { NextRequest, NextResponse } from "next/server";
import {
  createPty,
  subscribePty,
  writePty,
  resizePty,
  killPty,
} from "@/lib/autumn/pty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("node");
  if (!nodeId) {
    return NextResponse.json({ error: "node required" }, { status: 400 });
  }
  const dir = url.searchParams.get("dir") ?? undefined;

  // Create the PTY on first connection.
  const ok = createPty({ nodeId, dir });
  if (!ok) {
    return new NextResponse("failed to spawn pty", { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      send(JSON.stringify({ type: "ready" }));
      const unsub = subscribePty(nodeId, send);
      // Heartbeat so proxies don't close the stream.
      const hb = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        unsub();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  let body: {
    node?: string;
    action?: "input" | "resize" | "kill";
    data?: string;
    cols?: number;
    rows?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { node, action, data, cols, rows } = body;
  if (!node) return NextResponse.json({ error: "node required" }, { status: 400 });

  switch (action) {
    case "input":
      return NextResponse.json({ ok: writePty(node, data ?? "") });
    case "resize":
      resizePty(node, cols ?? 80, rows ?? 24);
      return NextResponse.json({ ok: true });
    case "kill":
      killPty(node);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
