// autumn — renderer bridge adapter (the migration to the facade).
//
// The ONLY way the renderer talks to the backend: every former HTTP API call
// site now goes through `window.autumn.*` — the IPC facade injected by
// electron/preload.js — and nowhere else. This module:
//
//   1. resolves a facade member (bridge ns, `__core.<group>` for core-RPC,
//      `__ops.<name>` for autumn-private ops),
//   2. unwraps the standard envelope —
//        { ok: true,  result }  -> resolves to `result`
//        { ok: false, error }   -> throws BridgeError { code, message, detail }
//      so call sites read plain values exactly like they read `await r.json()`,
//   3. fails loudly when the bridge is absent (web mode is gone by design —
//      the app runs inside Electron; see docs/architecture/ipc-facade.md),
//   4. optionally enforces a timeout (parity with the old fetchWithTimeout).
//
// NO HTTP client lives in this file — that invariant is asserted by the M3
// guard test (no HTTP API call sites anywhere in src/).

/** Error thrown for any `{ok:false}` envelope or bridge-level failure. */
export class BridgeError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.detail = detail;
  }
}

/** The envelope every facade call resolves to (mirrors electron/ipc/envelope.js). */
type Envelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

type Params = Record<string, unknown>;

/** Resolve `window.autumn` or throw — web mode is intentionally unsupported. */
function facade(): Record<string, unknown> {
  const w = window as unknown as { autumn?: Record<string, unknown> };
  if (!w.autumn) {
    throw new BridgeError(
      "no-bridge",
      "window.autumn is not available — autumn runs as a desktop app (Electron) only",
    );
  }
  return w.autumn;
}

/**
 * Resolve a dotted facade path to its callable member.
 * Accepts: "terminal.start" (bridge), "__ops.commander" (private),
 * "__core.bus.query" (core-RPC).
 */
function resolve(path: string): (params?: Params) => Promise<Envelope<unknown>> {
  const parts = path.split(".");
  let cur: unknown = facade();
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") {
      throw new BridgeError("no-method", `bridge member not found: ${path}`);
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur !== "function") {
    throw new BridgeError("no-method", `bridge member not found: ${path}`);
  }
  return cur as (params?: Params) => Promise<Envelope<unknown>>;
}

/** Unwrap an envelope: result on success, BridgeError on {ok:false}. */
async function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  const env = await promise;
  if (env && typeof env === "object" && "ok" in env) {
    if (env.ok) return env.result;
    throw new BridgeError(env.error.code, env.error.message, env.error.detail);
  }
  // Defensive: a raw (non-envelope) value — treat as the result itself.
  return env as T;
}

/**
 * Call a facade member by dotted path, unwrapping the envelope.
 * @param path    "terminal.start" | "__ops.commander" | "__core.bus.query"
 * @param params  request payload (defaults to {})
 * @param timeoutMs  optional hard timeout (parity with fetchWithTimeout)
 */
export function call<T = unknown>(path: string, params?: Params, timeoutMs?: number): Promise<T> {
  let invoke: (params?: Params) => Promise<Envelope<unknown>>;
  try {
    invoke = resolve(path);
  } catch (e) {
    return Promise.reject(e instanceof BridgeError ? e : new BridgeError("no-bridge", String(e)));
  }
  const run = unwrap<T>(invoke(params ?? {}) as Promise<Envelope<T>>);
  if (!timeoutMs) return run;
  return new Promise<T>((resolve_, reject) => {
    const timer = setTimeout(
      () => reject(new BridgeError("timeout", `${path} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    run.then(
      (v) => {
        clearTimeout(timer);
        resolve_(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Subscribe to a facade `on*` event. Returns the unsubscribe function
 * (facade contract: on* methods return unsubscribe).
 * @param path  e.g. "terminal.onData"
 */
export function subscribe<T = unknown>(path: string, cb: (payload: T) => void): () => void {
  const parts = path.split(".");
  let cur: unknown = facade();
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") {
      throw new BridgeError("no-method", `bridge member not found: ${path}`);
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur !== "function") {
    throw new BridgeError("no-method", `bridge member not found: ${path}`);
  }
  return (cur as (cb: (payload: T) => void) => () => void)(cb);
}

// ---------------------------------------------------------------------------
// Typed helpers for the call sites (the facade mapping table).
// Each helper's result type mirrors the old route's JSON body, so call sites
// change as little as possible.
// ---------------------------------------------------------------------------

export interface TerminalStartResult {
  node: string;
  harnessWarning: string | null;
}

export interface TerminalChunk {
  node: string;
  data: string;
}

export const api = {
  /** route: GET/POST /api/terminal → terminal.* + terminal.onData events */
  terminal: {
    start: (p: { node: string; dir?: string; harness?: string; task?: string; canvas?: string }) =>
      call<TerminalStartResult>("terminal.start", p as Params),
    input: (p: { node: string; data: string }) =>
      call<{ ok: boolean }>("terminal.input", p as Params),
    resize: (p: { node: string; cols: number; rows: number }) =>
      call<{ ok: boolean }>("terminal.resize", p as Params),
    kill: (p: { node: string }) => call<{ ok: boolean }>("terminal.kill", p as Params),
    onData: (cb: (chunk: TerminalChunk) => void) => subscribe<TerminalChunk>("terminal.onData", cb),
  },

  /** route: /api/canvas → canvas.load/save + __ops.canvasDelete */
  canvas: {
    load: <T = unknown>(p: { id?: string } = {}) => call<T>("canvas.load", p),
    save: (p: { id: string; name?: string; state?: string }) =>
      call<{ id: string; name: string; updatedAt: unknown }>("canvas.save", p as Params),
    remove: (id: string) => call<{ ok: boolean }>("__ops.canvasDelete", { id }),
  },

  /** route: /api/logs → activity.snapshot/record + __ops.logsClear */
  activity: {
    snapshot: <T = { entries: unknown[] }>(p: { canvas?: string; node?: string; kind?: string; limit?: number }) =>
      call<T>("activity.snapshot", p as Params),
    record: (p: { canvasId: string; entries: unknown[] }) =>
      call<{ written: number }>("activity.record", p as Params),
    clear: (canvas: string) => call<{ ok: boolean }>("__ops.logsClear", { canvas }),
  },

  /** route: /api/bus → core-RPC bus.query / bus.mutate (op discriminator) */
  bus: {
    query: <T = unknown>(p: { op?: string; canvas?: string; node?: string }) =>
      call<T>("__core.bus.query", p as Params),
    mutate: <T = unknown>(p: Params) => call<T>("__core.bus.mutate", p),
  },

  /** route: /api/commander → __ops.commander (autumn-private) */
  commander: (p: { command: string; canvas: unknown; lastTurn?: string; recentActions?: string[] }) =>
    call<Record<string, unknown>>("__ops.commander", p as Params),

  /** route: /api/agent/run → __ops.agentRun (autumn-private) */
  agentRun: (
    p: {
      personaId: string;
      harness: string;
      task: string;
      canvasId?: string;
      peerContext?: string;
      connectedPeers?: unknown;
      history?: unknown[];
    },
    timeoutMs?: number,
  ) => call<{ text: string; simulated?: boolean; fellBack?: boolean; error?: string }>(
    "__ops.agentRun",
    p as Params,
    timeoutMs,
  ),

  /** Wave-1: git + worktrees (electron/backend/git.ts) — status/stage/commit/push/PR */
  git: {
    status: (p: { cwd: string }) =>
      call<{
        current: string | null;
        tracking: string | null;
        ahead: number;
        behind: number;
        isClean: boolean;
        modified: string[];
        created: string[];
        deleted: string[];
        renamed: string[];
        staged: string[];
        conflicted: string[];
      }>("git.status", p as Params),
    changes: (p: { cwd: string }) =>
      call<{ files: { path: string; index: string; working_dir: string }[]; staged: string[]; unstaged: string[]; insertions: number; deletions: number; changed: number }>("git.changes", p as Params),
    stage: (p: { cwd: string; paths?: string[] }) =>
      call<{ ok: true; staged: string[] | "all" }>("git.stage", p as Params),
    discard: (p: { cwd: string; paths: string[] }) =>
      call<{ ok: true }>("git.discard", p as Params),
    commitAll: (p: { cwd: string; message: string }) =>
      call<{ ok: true; commit: string; branch: string }>("git.commitAll", p as Params),
    push: (p: { cwd: string; remote?: string; branch?: string }) =>
      call<{ ok: true; remote: string; branch: string | null }>("git.push", p as Params),
    initializeEmpty: (p: { cwd: string }) =>
      call<{ ok: true; initialized: boolean; already: boolean }>("git.initializeEmpty", p as Params),
    prFacts: (p: { cwd: string; base?: string }) =>
      call<{ supported: boolean; head?: string; base?: string; compareUrl?: string | null; github?: boolean }>("git.prFacts", p as Params),
    openPr: (p: { cwd: string; base?: string }) =>
      call<{ ok: true; url: string; head?: string; base?: string }>("git.openPr", p as Params),
  },

  /** Wave-1: devServer (electron/backend/devserver.ts) — child-process dev server */
  devServer: {
    start: (p: { cwd: string; command: string; args?: string[]; env?: Record<string, string>; port?: number; key?: string }) =>
      call<{ key: string; pid: number | null; status: string }>("devServer.start", p as Params),
    stop: (p: { cwd?: string; key?: string }) =>
      call<{ ok: true; stopped: true }>("devServer.stop", p as Params),
    lanHost: () => call<{ host: string | null }>("devServer.lanHost", {}),
  },

  /** Wave-1: artifacts (electron/backend/artifacts.ts) — persisted run outputs */
  artifacts: {
    save: (p: { canvasId: string; name: string; kind?: string; content?: string; path?: string; meta?: unknown }) =>
      call<{ id: string; canvasId: string; name: string; kind: string; version: number }>("artifacts.save", p as Params),
    get: (p: { artifactId: string }) =>
      call<{ id: string; name: string; kind: string; content: string | null; version: number; retired: boolean }>("artifacts.get", p as Params),
    catalog: (p: { canvasId?: string; kind?: string } = {}) =>
      call<{ items: { id: string; name: string; kind: string; version: number; updatedAt: number }[] }>("artifacts.catalog", p as Params),
  },

  /** Wave-1: tasks steer (electron/backend/tasks.ts) */
  tasks: {
    steer: (p: { canvasId: string; task: string; personaId?: string; harness?: string }) =>
      call<{ taskId: string; text: string; simulated?: boolean; fellBack?: boolean; error?: string }>("tasks.steer", p as Params),
  },

  /** Wave-1: files (electron/backend/files.ts) */
  files: {
    list: (p: { dir: string }) =>
      call<{ dir: string; items: { name: string; path: string; type: string }[] }>("files.list", p as Params),
    read: (p: { path: string }) =>
      call<{ path: string; content: string }>("files.read", p as Params),
    write: (p: { path: string; content: string }) =>
      call<{ ok: true; path: string; bytes: number }>("files.write", p as Params),
  },

  /** Wave-1: sessions (electron/backend/sessions.ts) */
  sessions: {
    read: (p: { sessionId: string }) =>
      call<{ id: string; engine: string; title: string; messages: unknown[] }>("sessions.read", p as Params),
    importedList: (p: { canvasId: string }) =>
      call<{ sessions: { id: string; title: string; engine: string }[] }>("sessions.importedList", p as Params),
  },
};

export default api;
