// Autumn — Agent runner API route (REAL backend).
// POST /api/agent/run
// Body: { personaId, harness, task, peerContext?, connectedPeers?, history? }
// Returns: { text } — the agent's response to the task.
//
// This now spawns the REAL coding-agent CLI (claude/codex/opencode/gemini/...)
// as a child process via src/lib/autumn/spawner.ts, injecting AUTUMN_BUS_* env
// so the agent can hand off to peers over the AutumnBus. The client
// (agent-runner.ts) already parses `[autumn-bus] message_peer → X:` lines from
// the returned text and routes them over /api/bus — so real agents coordinate
// with ZERO client changes.
//
// Fallback: if AUTUMN_SIMULATE=1 OR the CLI binary isn't installed, the spawner
// transparently falls back to a deterministic local simulation.

import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/autumn/spawner";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { AgentMessage } from "@/lib/autumn/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface AgentRunBody {
  personaId: string;
  harness: string;
  task: string;
  canvasId?: string;
  peerContext?: string;
  connectedPeers?: string[];
  history?: AgentMessage[];
}

export async function POST(req: NextRequest) {
  let body: AgentRunBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { personaId, harness, task, canvasId, peerContext, connectedPeers, history } = body;
  const persona = PERSONA_BY_ID[personaId];
  if (!persona) {
    return NextResponse.json({ error: "Unknown persona" }, { status: 400 });
  }

  const result = await runAgent({
    harness,
    task,
    canvasId: canvasId ?? "default",
    nodeId: personaId,
    personaName: persona.name,
    peerContext,
    connectedPeers,
    history: (history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text })),
  });

  return NextResponse.json({
    text: result.text,
    simulated: result.simulated,
    fellBack: result.fellBack,
    error: result.error,
  });
}
