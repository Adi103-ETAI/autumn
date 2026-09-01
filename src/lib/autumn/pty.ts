// Autumn — real PTY manager (server-side, node-pty).
//
// Two kinds of live terminals:
//   1. Plain shell  — `bash`/`zsh` for terminal nodes.
//   2. Agent CLI     — a real coding-agent CLI (claude/codex/opencode/gemini/...)
//                      spawned INTERACTIVELY into a PTY, so its actual TUI scrolls
//                      inside a terminal node. This is how Autumn shows each
//                      running agent as its own live CLI window.
//
// Each session is keyed by nodeId. Output is published to per-node subscribers;
// the /api/terminal SSE route streams it to the renderer. Input from the
// renderer is written straight back into the PTY (so you can type INTO the
// running claude/codex).

import type { IPty } from "node-pty";
import { homedir } from "node:os";
import path from "node:path";
import fs from "node:fs";

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
  createdAt: number;
}

const sessions = new Map<string, TerminalSession>();
const MAX_SESSIONS = 12;

// Resolve and validate a requested dir against an allow-list.
// Throws on violation so caller can return 400.
export function resolveDir(raw?: string): string {
  const expanded = raw ? raw.replace(/^~(?=\/|$)/, homedir()) : process.cwd();
  const resolved = path.resolve(expanded);
  // Allow: project cwd, homedir/autumn, homedir, /tmp, and any temp worktree under homedir
  const allowedRoots = [
    path.resolve(process.cwd()),
    path.resolve(homedir()),
    path.resolve(path.join(homedir(), "autumn")),
    path.resolve("/tmp"),
  ];
  const isAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
  if (!isAllowed) {
    // Fallback: also allow any existing directory that is inside allowed roots strictly
    // If not allowed, throw - caller returns 400
    throw new Error(`cwd not allowed: ${resolved}`);
  }
  try {
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) throw new Error(`not a directory: ${resolved}`);
  } catch {
    // Auto-create allowed dirs that don't exist (e.g. ~/autumn)
    try {
      fs.mkdirSync(resolved, { recursive: true });
    } catch {
      throw new Error(`cwd does not exist: ${resolved}`);
    }
  }
  return resolved;
}

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC ?? "powershell.exe";
  return process.env.SHELL ?? "bash";
}

function defaultEnv(): NodeJS.ProcessEnv {
  // Allow-list env instead of spreading entire process.env blindly
  const allow = new Set([
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TERM",
    "COLORTERM",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "NODE_ENV",
    "AUTUMN_BUS_PORT",
    "AUTUMN_BUS_CANVAS",
    "AUTUMN_BUS_NODE",
    "AUTUMN_BUS_TOKEN",
    "AUTUMN_BUS_PEERS",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
  ]);
  const out: NodeJS.ProcessEnv = {};
  for (const k of allow) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  // Ensure modern terminal caps for all CLIs (claude/codex/gemini/opencode)
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  out.TERM_PROGRAM = "Autumn";
  return out;
}

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

  // Evict oldest if at capacity
  if (sessions.size >= MAX_SESSIONS) {
    const oldestKey = sessions.keys().next().value as string | undefined;
    if (oldestKey) killPty(oldestKey);
  }

  const isAgent = !!opts.command;
  let cwd: string;
  try {
    cwd = resolveDir(opts.dir);
  } catch (err) {
    console.error("[pty] cwd rejected:", err);
    return false;
  }

  try {
    const shell = opts.shell ?? defaultShell();
    const pty = isAgent
      ? loadPty().spawn(opts.command!, opts.args ?? [], {
          name: "xterm-256color",
          cols: opts.cols ?? 100,
          rows: opts.rows ?? 30,
          cwd,
          env: { ...defaultEnv(), ...(opts.env ?? {}) },
        })
      : loadPty().spawn(shell, [], {
          name: "xterm-256color",
          cols: opts.cols ?? 100,
          rows: opts.rows ?? 30,
          cwd,
          env: { ...defaultEnv() },
        });

    const session: TerminalSession = {
      pty,
      subscribers: new Set(),
      kind: isAgent ? "agent" : "shell",
      command: opts.command ?? shell,
      createdAt: Date.now(),
    };
    pty.onData((data) => {
      for (const sub of session.subscribers) sub(data);
    });
    pty.onExit(({ exitCode, signal }) => {
      const wasAgent = session.kind === "agent";
      const exitInfo = exitCode ?? signal ?? 0;
      const msg = wasAgent
        ? `\r\n\x1b[33m[${session.command} exited (${exitInfo}) — fallback to shell]\x1b[0m\r\n`
        : `\r\n\x1b[33m[shell exited (${exitInfo}) — press Restart or close window]\x1b[0m\r\n`;
      for (const sub of session.subscribers) sub(msg);
      const oldSubs = new Set(session.subscribers);
      const savedDir = opts.dir;
      const savedCols = opts.cols;
      const savedRows = opts.rows;
      sessions.delete(opts.nodeId);
      // Agent fallback: auto-open plain shell so terminal stays usable after /exit
      if (wasAgent) {
        setTimeout(() => {
          if (sessions.has(opts.nodeId)) return;
          try {
            const ok = createPty({ nodeId: opts.nodeId, dir: savedDir, cols: savedCols, rows: savedRows });
            if (ok) {
              const newSess = sessions.get(opts.nodeId);
              if (newSess) {
                for (const sub of oldSubs) newSess.subscribers.add(sub);
                // nudge shell to show prompt
                setTimeout(() => {
                  for (const sub of newSess.subscribers) sub("\r\n");
                }, 100);
              }
            }
          } catch {}
        }, 300);
      }
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

export function ptyCount(): number {
  return sessions.size;
}
