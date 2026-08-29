// Autumn — real PTY manager (server-side, node-pty).
//
// Two kinds of live terminals:
//   1. Plain shell  — `bash`/`zsh` for terminal nodes.
//   2. Agent CLI     — a real coding-agent CLI (claude/codex/opencode/gemini/...)
//                      spawned INTERACTIVELY into a PTY, so its actual TUI scrolls
//                      inside a terminal node. This is how October shows each
//                      running agent as its own live CLI window.
//
// Each session is keyed by nodeId. Output is published to per-node subscribers;
// the /api/terminal SSE route streams it to the renderer. Input from the
// renderer is written straight back into the PTY (so you can type INTO the
// running claude/codex).

import type { IPty } from "node-pty";

// Lazily require node-pty so the app still boots where the native build is
// unavailable (it just won't serve live terminals).
let ptyModule: typeof import("node-pty") | null = null;
function loadPty(): typeof import("node-pty") {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require("node-pty");
  }
  return ptyModule;
}

interface TerminalSession {
  pty: IPty;
  subscribers: Set<(chunk: string) => void>;
  kind: "shell" | "agent";
  command: string;
}

const sessions = new Map<string, TerminalSession>();

export interface CreatePtyOptions {
  nodeId: string;
  /** Plain shell mode: a shell binary (bash/zsh). */
  shell?: string;
  dir?: string;
  cols?: number;
  rows?: number;
  /** Agent CLI mode: spawn this command (e.g. resolved `claude` binary). */
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export function createPty(opts: CreatePtyOptions): boolean {
  if (sessions.has(opts.nodeId)) return true; // already running

  const isAgent = !!opts.command;
  try {
    const pty = isAgent
      ? loadPty().spawn(opts.command!, opts.args ?? [], {
          name: "xterm-color",
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 24,
          cwd: opts.dir ?? process.cwd(),
          env: { ...process.env, TERM: "xterm-256color", ...(opts.env ?? {}) },
        })
      : loadPty().spawn(opts.shell ?? process.env.SHELL ?? "bash", [], {
          name: "xterm-color",
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 24,
          cwd: opts.dir ?? process.cwd(),
          env: { ...process.env, TERM: "xterm-256color" },
        });

    const session: TerminalSession = {
      pty,
      subscribers: new Set(),
      kind: isAgent ? "agent" : "shell",
      command: opts.command ?? opts.shell ?? "bash",
    };
    pty.onData((data) => {
      for (const sub of session.subscribers) sub(data);
    });
    pty.onExit(() => {
      sessions.delete(opts.nodeId);
    });

    sessions.set(opts.nodeId, session);
    return true;
  } catch (err) {
    console.error("[pty] spawn failed:", err);
    return false;
  }
}

export function subscribePty(
  nodeId: string,
  cb: (chunk: string) => void,
): () => void {
  const session = sessions.get(nodeId);
  if (!session) return () => {};
  session.subscribers.add(cb);
  return () => session.subscribers.delete(cb);
}

export function writePty(nodeId: string, data: string): boolean {
  const session = sessions.get(nodeId);
  if (!session) return false;
  session.pty.write(data);
  return true;
}

export function resizePty(nodeId: string, cols: number, rows: number): void {
  sessions.get(nodeId)?.pty.resize(cols, rows);
}

export function killPty(nodeId: string): void {
  const session = sessions.get(nodeId);
  if (session) {
    try {
      session.pty.kill();
    } catch {}
    sessions.delete(nodeId);
  }
}

export function ptyExists(nodeId: string): boolean {
  return sessions.has(nodeId);
}

export function ptyKind(nodeId: string): "shell" | "agent" | undefined {
  return sessions.get(nodeId)?.kind;
}
