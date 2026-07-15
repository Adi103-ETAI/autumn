// Autumn — Commander API route.
// POST /api/commander
// Body: { command, canvas, lastTurn?, recentActions? }
// Returns: CommanderResult ({kind:"steps",...} | {kind:"ask",...})

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import {
  COMMANDER_SYSTEM_PROMPT,
  buildCompilerUserPrompt,
} from "@/lib/autumn/commander-prompt";
import type { CanvasSnapshot, CommanderResult } from "@/lib/autumn/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Lightweight fallback planner: used if the LLM call fails or returns
// unparseable JSON. It pattern-matches common commands.
function fallbackPlan(command: string, _canvas: CanvasSnapshot): CommanderResult {
  const c = command.toLowerCase();

  // detect "connect A to B"
  const connectMatch = command.match(
    /connect\s+(\w+)\s+(?:to|and|with)\s+(\w+)/i,
  );
  if (connectMatch) {
    return {
      kind: "steps",
      steps: [
        {
          action: "connect_nodes",
          args: { from: connectMatch[1], to: connectMatch[2] },
        },
      ],
      say: `Connecting ${connectMatch[1]} to ${connectMatch[2]}.`,
      listen: false,
    };
  }

  // detect spawn N agents
  const spawnMatch = c.match(/(\d+)\s+(?:claude code|codex|agents?|chat)/);
  if (spawnMatch) {
    const count = parseInt(spawnMatch[1], 10);
    return {
      kind: "steps",
      steps: [{ action: "add_agents", args: { count } }],
      say: `Spawning ${count} agents.`,
    };
  }

  // detect "build X" / "create X"
  if (/build|create|make|start/i.test(command)) {
    return {
      kind: "steps",
      steps: [
        { action: "add_chat", args: {} },
        { action: "add_screen", args: { kind: "desktop" } },
        {
          action: "connect_nodes",
          args: { from: "@1", to: "@2" },
        },
        {
          action: "send_to_node",
          args: { id: "@1", text: command },
        },
      ],
      say: "Spawning an agent and handing it your task.",
    };
  }

  return {
    kind: "ask",
    ask: "What would you like me to build or orchestrate?",
    options: [
      "Spawn two Claude Code agents",
      "Open a phone preview screen",
      "Drop a sticky note with my idea",
    ],
  };
}

export async function POST(req: NextRequest) {
  let body: {
    command: string;
    canvas: CanvasSnapshot;
    lastTurn?: string;
    recentActions?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { command, canvas, lastTurn, recentActions } = body;
  if (!command || !canvas) {
    return NextResponse.json(
      { error: "command and canvas are required" },
      { status: 400 },
    );
  }

  const systemPrompt = COMMANDER_SYSTEM_PROMPT.replace(
    "{{CANVAS}}",
    canvas.nodes.length === 0
      ? "(empty canvas)"
      : canvas.nodes
          .map(
            (n) =>
              `${n.id} · ${n.kind} · ${n.name}${n.status ? ` [${n.status}]` : ""}${n.harness ? ` (${n.harness})` : ""}${n.doing ? ` — "${n.doing}"` : ""}`,
          )
          .join("\n") +
        "\nCONNECTIONS:\n" +
        (canvas.connections.length === 0
          ? "(none)"
          : canvas.connections.map((c) => `${c.from} → ${c.to}`).join("\n")),
  );
  const userPrompt = buildCompilerUserPrompt(
    command,
    canvas,
    lastTurn,
    recentActions,
  );

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 1024,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = safeParseCommanderResult(raw);
    if (parsed) return NextResponse.json(parsed);

    // LLM returned non-JSON; fall back.
    const fallback = fallbackPlan(command, canvas);
    return NextResponse.json({ ...fallback, _raw: raw, _fallback: true });
  } catch (err) {
    console.error("[commander] LLM error:", err);
    const fallback = fallbackPlan(command, canvas);
    return NextResponse.json({
      ...fallback,
      _error: err instanceof Error ? err.message : "unknown",
      _fallback: true,
    });
  }
}

function safeParseCommanderResult(raw: string): CommanderResult | null {
  if (!raw) return null;
  // strip markdown fences if any
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) s = fenceMatch[1].trim();

  // try direct parse
  try {
    const j = JSON.parse(s);
    if (isValidResult(j)) return j;
  } catch {
    // try to extract first {...} block
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        if (isValidResult(j)) return j;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function isValidResult(j: unknown): j is CommanderResult {
  if (typeof j !== "object" || j === null) return false;
  const obj = j as Record<string, unknown>;
  if (obj.kind === "ask" && typeof obj.ask === "string") return true;
  if (
    obj.kind === "steps" &&
    Array.isArray(obj.steps) &&
    typeof obj.say === "string"
  )
    return true;
  return false;
}
