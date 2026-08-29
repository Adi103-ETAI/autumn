// Autumn — real PTY manager (server-side, node-pty).
//
// Each terminal node gets a real shell (bash/zsh) spawned via node-pty inside
// the host that runs the Next server (i.e. inside the Electron app / VM). Output
// is published to in-memory per-node subscribers; the /api/terminal SSE route
// streams it to the renderer. Input from the renderer is written back to the PTY.
//
// This replaces the static `data.lines` terminal node with a LIVE shell — the
// same way October streams a real agent terminal to its UI.

import type { IPty } from "node-pty";

// Lazily require node-pty so the app still boots in environments where the
// native build is unavailable (it just won't serve live terminals).
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
}

const sessions = new Map<string, TerminalSession>();

export interface CreatePtyOptions {
  nodeId: string;
  dir?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export function createPty(opts: CreatePtyOptions): boolean {
  if (sessions.has(opts.nodeId)) return true; // already running
  try {
    const pty = loadPty().spawn(opts.shell ?? process.env.SHELL ?? "bash", [], {
      name: "xterm-color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.dir ?? process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const session: TerminalSession = { pty, subscribers: new Set() };
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
