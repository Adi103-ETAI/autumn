// autumn — Wave-1 handlers: devServer (5; 4 renderer-used: start/stop/lanHost/enableExpoWeb) (doc 31).
//
// Implements the 4 renderer-used devServer bridge ids over a REAL child process
// (deps.spawn — node:child_process via index.ts) plus node:os for the machine's
// LAN address. Registered by index.ts; do not edit shared files (w1-deps.ts,
// index.ts, handlers.ts, registry, manifest). Contract: every id must exist in
// electron/ipc/manifest.json bridge namespaces (conformance test enforces it).
// Envelope rules: plain payload on success (registry wraps {ok:true,result}),
// or { ok: false, error: { code, message } } — bad-params (validation),
// not-found (no tracked process for that key), handler-error (double-start —
// nothing is replaced or killed silently), not-implemented (enableExpoWeb:
// autumn has no Expo config pipeline; see the comment there).
//
// Events: events.onDevServer fires ONLY on observed state transitions —
// spawn success {key,status:"starting"}, child "exit" {key,status:"exited",code},
// child "error" {key,status:"error",message}. Nothing else emits.

import { networkInterfaces } from "node:os";
import { isAbsolute } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";

/** Deliberate bad-input envelope (doc 31 §2) — never throw for user input. */
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/** Shared result of the param validators (also returned as the registry schema). */
type Validation = { ok: true } | { ok: false; message: string };

/** One tracked dev-server child. */
interface RunningDevServer {
  proc: ChildProcLike;
  cwd: string;
  command: string;
  startedAt: number;
  port?: number;
}

/**
 * key -> running dev-server child. MODULE-LEVEL on purpose: the tracked process
 * must outlive handler-table rebuilds (index.ts builds the table once; tests
 * rebuild per case). Exported so tests can `devServers.clear()` in beforeEach.
 */
export const devServers = new Map<string, RunningDevServer>();

/** Map key: an explicit non-empty `key` param wins, else the project `cwd`. */
function keyOf(p: Record<string, any> | null | undefined): string | null {
  if (typeof p?.key === "string" && p.key.length > 0) return p.key;
  if (typeof p?.cwd === "string" && p.cwd.length > 0) return p.cwd;
  return null;
}

/** start params — ONE function used by both the schema and the handler. */
function validateStart(p: Record<string, any> | null | undefined): Validation {
  if (!p) return { ok: false, message: "cwd required (non-empty absolute string)" };
  const cwd = p.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) {
    return { ok: false, message: "cwd required (non-empty absolute string)" };
  }
  if (!isAbsolute(cwd)) return { ok: false, message: "cwd must be an absolute path" };
  if (typeof p.command !== "string" || p.command.length === 0) {
    return { ok: false, message: "command required (non-empty string)" };
  }
  if (p.args !== undefined && (!Array.isArray(p.args) || p.args.some((a: unknown) => typeof a !== "string"))) {
    return { ok: false, message: "args must be an array of strings when provided" };
  }
  if (
    p.env !== undefined &&
    (typeof p.env !== "object" ||
      p.env === null ||
      Array.isArray(p.env) ||
      Object.values(p.env).some((v: unknown) => typeof v !== "string"))
  ) {
    return { ok: false, message: "env must be an object of string values when provided" };
  }
  if (p.port !== undefined && (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535)) {
    return { ok: false, message: "port must be an integer 1-65535 when provided" };
  }
  if (p.key !== undefined && (typeof p.key !== "string" || p.key.length === 0)) {
    return { ok: false, message: "key must be a non-empty string when provided" };
  }
  return { ok: true };
}

/** stop params: { cwd | key } — at least one non-empty string, well-typed. */
function validateStop(p: Record<string, any> | null | undefined): Validation {
  if (p?.key !== undefined && (typeof p.key !== "string" || p.key.length === 0)) {
    return { ok: false, message: "key must be a non-empty string when provided" };
  }
  if (p?.cwd !== undefined && (typeof p.cwd !== "string" || p.cwd.length === 0)) {
    return { ok: false, message: "cwd must be a non-empty string when provided" };
  }
  return keyOf(p) ? { ok: true } : { ok: false, message: "cwd or key required (non-empty string)" };
}

export function makeDevServerHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, spawn, now } = deps;

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "devServer.start",
      description:
        'spawn the project dev server as a child process; params: { cwd: absolute string, command: string, args?: string[], env?: Record<string,string>, port?: number, key?: string } -> { key, pid, status: "starting" }; a second start for a key already running -> handler-error "already running" (nothing is replaced or killed silently — stop first)',
      schema: validateStart,
      handler: (p) => {
        const v = validateStart(p);
        if (!v.ok) return badParams(v.message);
        const key = keyOf(p)!;

        // Double-start is REJECTED (documented choice): silently replacing
        // would orphan the running child the renderer still believes in.
        if (devServers.has(key)) {
          return {
            ok: false,
            error: { code: "handler-error", message: `already running: ${key} — stop it first` },
          };
        }

        const cwd = p.cwd as string;
        const command = p.command as string;
        const args = (p.args as string[] | undefined) ?? [];
        const port = p.port as number | undefined;
        // env REPLACES the child environment in node:child_process — merge over
        // the main process env so the command still resolves via PATH.
        const env =
          p.env === undefined ? undefined : { ...process.env, ...(p.env as Record<string, string>) };

        let proc: ChildProcLike;
        try {
          proc = spawn.spawn(command, args, { cwd, ...(env ? { env } : {}) });
        } catch (e) {
          // spawn() threw synchronously: no child exists, so no state
          // transition was observed and NO event fires — this is a failed
          // operation (real failure -> handler-error, doc 31 §2).
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: { code: "handler-error", message: `spawn failed: ${msg}` } };
        }

        const record: RunningDevServer = { proc, cwd, command, startedAt: now() };
        if (port !== undefined) record.port = port;
        devServers.set(key, record);

        // Drain stdout/stderr so a chatty dev server never fills the pipe
        // buffer. The devServer surface pushes STATE transitions only (doc 31
        // §3) — chunks are consumed, never emitted as events.
        proc.stdout?.on("data", () => {});
        proc.stderr?.on("data", () => {});

        proc.on("exit", (code) => {
          // Real observed transition. Drop the record only if it still tracks
          // THIS child (stop() may already have removed it; a restart may have
          // taken the key).
          if (devServers.get(key)?.proc === proc) devServers.delete(key);
          emit("events.onDevServer", { key, status: "exited", code });
        });
        proc.on("error", (err) => {
          // A child that errored (e.g. command not found) is not a usable
          // server: drop it so the key can be started again — its exit event
          // may never fire for a failed spawn.
          if (devServers.get(key)?.proc === proc) devServers.delete(key);
          emit("events.onDevServer", {
            key,
            status: "error",
            message: err && err.message ? err.message : String(err),
          });
        });

        emit("events.onDevServer", { key, status: "starting" });
        // pid is real when node:child_process gave us one; ChildProcLike does
        // not guarantee it, so null (never a fabricated number).
        const rawPid = (proc as { pid?: unknown }).pid;
        const pid = typeof rawPid === "number" ? rawPid : null;
        return { key, pid, status: "starting" };
      },
    },
    {
      kind: "bridge",
      id: "devServer.stop",
      description:
        "kill the tracked dev-server child; params: { cwd?: string, key?: string } (one required, key wins) -> { ok: true, stopped: true } | not-found when nothing is tracked for that key",
      schema: validateStop,
      handler: (p) => {
        const v = validateStop(p);
        if (!v.ok) return badParams(v.message);
        const key = keyOf(p)!;
        const rec = devServers.get(key);
        if (!rec) {
          return { ok: false, error: { code: "not-found", message: `no dev server running for key: ${key}` } };
        }
        rec.proc.kill(); // SIGTERM (node default); a throw propagates -> handler-error, record kept
        devServers.delete(key); // dropped only after a successful kill
        // Deliberately NO emit here: killing is a request, not an observed
        // transition — the child's real "exit" event fires events.onDevServer.
        return { ok: true, stopped: true };
      },
    },
    {
      kind: "bridge",
      id: "devServer.lanHost",
      description:
        "this machine's LAN IPv4 for device previews; params: {} -> { host: string | null } (first non-internal IPv4 from os.networkInterfaces(); null when the machine has none — never a fabricated address)",
      handler: () => {
        for (const addrs of Object.values(networkInterfaces())) {
          for (const entry of addrs ?? []) {
            // family is "IPv4"|"IPv6" on modern Node, 4|6 on older runtimes.
            if (String(entry.family) === "IPv4" && !entry.internal) {
              return { host: entry.address };
            }
          }
        }
        return { host: null };
      },
    },
    {
      kind: "bridge",
      id: "devServer.enableExpoWeb",
      description:
        "enable Expo web for the project (app.json / prebuild config write); params: { cwd?: string } -> not-implemented envelope — autumn has no Expo config pipeline, so nothing is written (never a fake success)",
      schema: (p) =>
        p?.cwd === undefined || (typeof p.cwd === "string" && p.cwd.length > 0)
          ? { ok: true }
          : { ok: false, message: "cwd must be a non-empty string when provided" },
      handler: (p) => {
        if (p?.cwd !== undefined && (typeof p.cwd !== "string" || p.cwd.length === 0)) {
          return badParams("cwd must be a non-empty string when provided");
        }
        // The target's Expo web-enablement writes Expo project config (app.json
        // web settings / prebuild). Autumn has NO Expo config pipeline — there
        // is no config file we could honestly update — so this is a deliberate
        // not-implemented envelope (doc 31 §4), never a fabricated success that
        // would claim a write we never performed.
        return {
          ok: false,
          error: {
            code: "not-implemented",
            message:
              "enableExpoWeb needs an Expo config pipeline (app.json/prebuild), which autumn does not have",
          },
        };
      },
    },
  ];

  return handlers;
}
