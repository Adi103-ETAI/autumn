// Autumn — Agent runner API route.
// POST /api/agent/run
// Body: { personaId, harness, task, peerContext?, history? }
// Returns: { text } — the agent's response to the task.
//
// This simulates the October agent runtime: external CLI tools (Claude Code,
// Codex, etc.) are spawned as child processes with injected env + bus hooks.
// In this sandbox we cannot spawn those CLIs, so we proxy the task through the
// z-ai LLM with a persona-flavored system prompt. The response is what the
// agent "would have said" — including a faux tool-use transcript that matches
// the harness's idioms (Claude Code → "/src/...", Codex → reasoning + edits).

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { AgentMessage } from "@/lib/autumn/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AgentRunBody {
  personaId: string;
  harness: string;
  task: string;
  peerContext?: string;
  connectedPeers?: string[];
  history?: AgentMessage[];
}

const HARNESS_FLAVOR: Record<string, string> = {
  "claude-code":
    "You are running inside Claude Code. Use TodoWrite to plan, Read/Write/Edit for files, and Bash for shell. Show your tool-use as short fenced blocks like `Read: src/app/page.tsx` or `Edit: src/components/Button.tsx (+12 -3)`. End with a one-paragraph summary.",
  codex:
    "You are running inside OpenAI Codex. Reason step-by-step in `<thinking>` blocks, then propose edits as `codex.apply_patch(...)` snippets. End with a one-paragraph summary.",
  opencode:
    "You are running inside OpenCode. Plan with `opencode.plan`, then `opencode.edit`. Show your plan then the edits. End with a one-paragraph summary.",
  gemini:
    "You are running inside Gemini CLI. Use `read_file`, `write_file`, `replace`. Show the diff inline. End with a one-paragraph summary.",
  cursor:
    "You are running inside Cursor Agent. Use @codebase semantics, apply edits via `cursor.edit`. End with a one-paragraph summary.",
  grok:
    "You are running inside Grok CLI. Be terse, edgy, and rigorous. Show commands and edits. End with a one-paragraph summary.",
  hermes:
    "You are running inside Hermes. Use `hermes.tool` calls. End with a one-paragraph summary.",
  pi:
    "You are running inside Pi. Conversational, careful, asks for confirmation on risky ops. End with a one-paragraph summary.",
  cline:
    "You are running inside Cline. Use `execute_command` + `replace_in_file`. End with a one-paragraph summary.",
};

export async function POST(req: NextRequest) {
  let body: AgentRunBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { personaId, harness, task, peerContext, connectedPeers, history } = body;
  const persona = PERSONA_BY_ID[personaId];
  if (!persona) {
    return NextResponse.json({ error: "Unknown persona" }, { status: 400 });
  }

  const flavor = HARNESS_FLAVOR[harness] ?? HARNESS_FLAVOR["claude-code"];
  const peersLine =
    connectedPeers && connectedPeers.length > 0
      ? `You are connected to these peers via the AutumnBus: ${connectedPeers.join(", ")}. When you're done, end with the line:\n  "[autumn-bus] message_peer → <ONE_OF_THE_PEER_NAMES>: <one-line handoff>"\n  The bus will route it. Use the EXACT peer name.`
      : `You have no connected peers. Do not emit a message_peer line.`;
  const systemPrompt = `You are ${persona.name}, an AI coding agent on the Autumn canvas.

Character: ${persona.tagline}
Specialty: ${persona.specialty}
Harness: ${harness}

${flavor}

Rules:
- Stay in character. Be concise but specific.
- Reference real-sounding file paths under /worktrees/${persona.id.toLowerCase()}/.
- ${peersLine}
- Never claim to actually execute code; you are simulating the work in this demo.
- Keep your full reply under 220 words.

${peerContext ? `# PEER CONTEXT (AutumnBus /hook/pre-prompt)\n${peerContext}\n` : ""}
`;

  const messages: { role: "assistant" | "user"; content: string }[] = [
    { role: "assistant", content: systemPrompt },
    ...(history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      })),
    { role: "user", content: task },
  ];

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
      temperature: 0.7,
      max_tokens: 900,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[agent/run] LLM error:", err);
    // Fallback: synthesize a believable response without the LLM.
    const fallback = synthesizeFallback(persona.name, harness, task, peerContext);
    return NextResponse.json({ text: fallback, _fallback: true });
  }
}

function synthesizeFallback(
  name: string,
  harness: string,
  task: string,
  peerContext?: string,
): string {
  const peerLine = peerContext
    ? `\n\n[autumn-bus] message_peer → peer: ${task.slice(0, 60)}… — handed off.`
    : "";
  return `**${name}** (${harness}) picked up: "${task.slice(0, 120)}"

\`Read: /worktrees/${name.toLowerCase()}/package.json\`
\`Read: /worktrees/${name.toLowerCase()}/src/app/page.tsx\`
\`Edit: /worktrees/${name.toLowerCase()}/src/app/page.tsx (+24 -8)\`

Plan: scaffolded the entry point, wired the layout, and added the first route. Ready for the next iteration.${peerLine}`;
}
