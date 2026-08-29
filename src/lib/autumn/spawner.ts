// Autumn — REAL agent spawner (server-side).
//
// This is the real counterpart to October Desktop's runAgent(): it spawns the
// ACTUAL coding-agent CLI (claude, codex, opencode, gemini, ...) as a child
// process on the host that runs the Next server, injects AUTUMN_BUS_* env so
// the agent can participate in the AutumnBus handoff protocol, and streams the
// agent's stdout back as `text`.
//
// The agent interoperates with the bus through the SAME contract the simulated
// backend used: it may emit a line like
//     [autumn-bus] message_peer → <peerName>: <handoff>
// The client (agent-runner.ts) already parses these and routes them over
// /api/bus — so real agents coordinate with ZERO client changes.
//
// When AUTUMN_SIMULATE=1 OR the target CLI binary is not installed, we fall
// back to the original z-ai LLM proxy (see runAgentSimulated) so the app still
// works in CI / web-only deployments.

import { spawn } from "node:child_process";
import { which } from "./which";

export interface SpawnAgentInput {
  harness: string; // AgentHarness id, e.g. "claude-code"
  task: string;
  canvasId: string;
  nodeId: string;
  personaName?: string;
  model?: string;
  peerContext?: string; // drained inbox from /api/bus?op=pre-prompt
  connectedPeers?: string[];
  history?: { role: "user" | "assistant"; text: string }[];
  /** Optional worktree/cwd the agent should operate in. */
  cwd?: string;
  timeoutMs?: number;
}

// harness id -> CLI binary name on PATH.
export const HARNESS_BIN: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  cursor: "cursor",
  grok: "grok",
  hermes: "hermes",
  pi: "pi",
  cline: "cline",
};

export function harnessBinary(harness: string): string {
  return HARNESS_BIN[harness] ?? HARNESS_BIN["claude-code"];
}

// Build the args for a NON-interactive one-shot run (used by /api/agent/run).
function buildArgs(harness: string, task: string, model?: string): string[] {
  switch (harness) {
    case "codex":
      return ["exec", task];
    case "gemini":
      return ["--prompt", task];
    case "opencode":
      return ["-m", task];
    case "claude-code":
    default:
      return model ? ["--print", "--model", model, task] : ["--print", task];
  }
}

// Resolve a harness into a runnable command for an INTERACTIVE PTY terminal.
// Returns null if the CLI binary isn't installed (caller falls back to shell).
// `task`, if given, is handed to the CLI as its initial prompt; the agent then
// runs interactively (its real TUI) so you can type into it live.
export async function resolveAgentCommand(
  harness: string,
  task?: string,
  ctx?: { canvasId?: string; nodeId?: string },
): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv } | null> {
  const bin = harnessBinary(harness);
  let resolved: string | null = null;
  try {
    resolved = await which(bin);
  } catch {
    return null;
  }
  if (!resolved) return null;

  // Interactive launch: no --print. Some CLIs accept an initial task flag.
  let args: string[] = [];
  if (task) {
    switch (harness) {
      case "codex":
        args = ["exec", task];
        break;
      case "gemini":
        args = ["--prompt", task];
        break;
      case "opencode":
        args = ["-m", task];
        break;
      case "claude-code":
      default:
        // Claude Code: `-p` is one-shot; interactive REPL takes the task as a
        // positional prompt and stays attached to the PTY.
        args = [task];
        break;
    }
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTUMN_BUS_PORT: process.env.AUTUMN_BUS_PORT ?? "3000",
    AUTUMN_BUS_CANVAS: ctx?.canvasId ?? "default",
    AUTUMN_BUS_NODE: ctx?.nodeId ?? "unknown",
    AUTUMN_BUS_TOKEN: process.env.AUTUMN_BUS_TOKEN ?? "autumn-dev-token",
    TERM: "xterm-256color",
  };

  return { command: resolved, args, env };
}

function buildEnv(input: SpawnAgentInput): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AUTUMN_BUS_PORT: process.env.AUTUMN_BUS_PORT ?? "3000",
    AUTUMN_BUS_CANVAS: input.canvasId,
    AUTUMN_BUS_NODE: input.nodeId,
    AUTUMN_BUS_TOKEN: process.env.AUTUMN_BUS_TOKEN ?? "autumn-dev-token",
    // Best-effort: tell agents about peers via env (mirrors October's hooks).
    AUTUMN_BUS_PEERS: (input.connectedPeers ?? []).join(","),
  };
}

function prependPeerContext(
  task: string,
  peerContext?: string,
): string {
  if (!peerContext) return task;
  return (
    `# PEER CONTEXT (AutumnBus /hook/pre-prompt)\n${peerContext}\n\n` +
    `# NOW YOUR TASK\n${task}`
  );
}

export interface SpawnResult {
  text: string;
  simulated: boolean;
  /** true if we could not find the real CLI and fell back. */
  fellBack: boolean;
  error?: string;
}

// Probe whether the real CLI exists; if not, simulate.
export async function runAgent(input: SpawnAgentInput): Promise<SpawnResult> {
  const simulate = process.env.AUTUMN_SIMULATE === "1";
  const bin = HARNESS_BIN[input.harness] ?? HARNESS_BIN["claude-code"];

  let resolvedBin: string | null = null;
  if (!simulate) {
    try {
      resolvedBin = await which(bin);
    } catch {
      resolvedBin = null;
    }
  }

  if (simulate || !resolvedBin) {
    return runAgentSimulated(input, !resolvedBin && !simulate);
  }

  const task = prependPeerContext(input.task, input.peerContext);
  const args = buildArgs(input.harness, task, input.model);
  const env = buildEnv(input);
  const timeoutMs = input.timeoutMs ?? 120_000;

  return new Promise<SpawnResult>((resolve) => {
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(resolvedBin!, args, {
        cwd: input.cwd ?? process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        text: "",
        simulated: false,
        fellBack: true,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let out = "";
    let errOut = "";
    const onData = (d: Buffer) => {
      out += d.toString();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (d) => {
      errOut += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        text: out || errOut,
        simulated: false,
        fellBack: false,
        error: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        text: out,
        simulated: false,
        fellBack: true,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        text: out.trim(),
        simulated: false,
        fellBack: false,
        error: code === 0 ? undefined : `exit ${code}: ${errOut.slice(0, 500)}`,
      });
    });
  });
}

// Fallback path — the original z-ai LLM proxy — kept verbatim in spirit.
async function runAgentSimulated(
  input: SpawnAgentInput,
  missingCli: boolean,
): Promise<SpawnResult> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const { PERSONA_BY_ID } = await import("./personas");
    const persona = input.personaName
      ? PERSONA_BY_ID[Object.keys(PERSONA_BY_ID).find(
          (k) => PERSONA_BY_ID[k].name === input.personaName,
        ) ?? ""]
      : undefined;

    const systemPrompt = `You are ${input.personaName ?? "an AI coding agent"} on the Autumn canvas.
Harness: ${input.harness}
${missingCli ? "(The real CLI for this harness is not installed, so this is a simulated response.)\n" : ""}
You are connected to peers: ${(input.connectedPeers ?? []).join(", ") || "none"}.
When done, end with: [autumn-bus] message_peer → <peerName>: <handoff>
${input.peerContext ? `# PEER CONTEXT\n${input.peerContext}\n` : ""}
Keep it under 220 words.`;

    const messages = [
      { role: "assistant" as const, content: systemPrompt },
      ...(input.history ?? []).slice(-6).map((m) => ({
        role: m.role,
        content: m.text,
      })),
      { role: "user" as const, content: input.task },
    ];

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
      temperature: 0.7,
      max_tokens: 900,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return { text, simulated: true, fellBack: missingCli };
  } catch (err) {
    return {
      text: `**${input.personaName ?? "Agent"}** picked up: "${input.task.slice(0, 120)}"\n\n(simulated — real CLI unavailable)`,
      simulated: true,
      fellBack: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
