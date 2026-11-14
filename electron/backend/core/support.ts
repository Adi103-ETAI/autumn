// autumn — the core protocol's support layer (Wave 4, doc 35 §7).
//
// The core protocol is the bus-facing view of the SAME backend the renderer
// talks to. So a core method is a real adapter: it takes the protocol's
// shape (`{op, …}`) and hands it to the bridge handler that already
// implements the behaviour. No behaviour is written twice.
//
//   core.terminal.create  →  terminal.start
//   core.git.query        →  git.status / git.changes / …
//   core.facts.query      →  the facts operations
//
// The protocol's method surface and the per-principal table live in
// electron/ipc/core-protocol.js; the principal check happens in the registry
// before a handler ever runs.

import type { RegisteredHandler } from "../handlers";

/** A bridge handler, looked up by its dotted id. */
export type BridgeLookup = (id: string) => RegisteredHandler | undefined;

/** The deliberate envelope the handlers use for "this is not available". */
export const notAvailable = (message: string) => ({
  ok: false as const,
  error: { code: "not-implemented" as const, message },
});

/** The deliberate envelope for a malformed call. */
export const badRequest = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

export interface CoreHandlerOptions {
  /** The core method's id, e.g. "terminal.create". */
  id: string;
  /** The bridge method it delegates to, e.g. "terminal.start". */
  bridge: string;
  /** The one-line description (the inspector shows it). */
  description: string;
  /** Map the core params onto the bridge params. */
  map?: (params: Record<string, any>) => Record<string, any>;
  /** The bridge method may not exist — then this is the honest answer. */
  whenMissing?: string;
}

/**
 * A core method that delegates to a bridge method.
 *
 * The delegation is real: the same handler, the same database, the same
 * process. The core surface only changes the shape of the call.
 */
export function delegate(bridge: BridgeLookup, options: CoreHandlerOptions): RegisteredHandler {
  return {
    kind: "core",
    id: options.id,
    description: options.description,
    handler: async (params, ctx) => {
      const target = bridge(options.bridge);
      if (!target) {
        return notAvailable(
          options.whenMissing ?? `${options.bridge} is not available in this build`,
        );
      }
      const mapped = options.map ? options.map(params ?? {}) : params ?? {};
      return target.handler(mapped, ctx);
    },
  };
}

/**
 * A core method that dispatches on an operation.
 *
 * The protocol's shape is `{op, …}`; each op names a bridge method.
 */
export function dispatcher(
  bridge: BridgeLookup,
  options: {
    id: string;
    description: string;
    ops: Record<string, { bridge: string; map?: (params: Record<string, any>) => Record<string, any> }>;
    whenMissing?: string;
  },
): RegisteredHandler {
  return {
    kind: "core",
    id: options.id,
    description: options.description,
    handler: async (params, ctx) => {
      const op = typeof params?.op === "string" ? params.op : undefined;
      if (!op) return badRequest(`${options.id} needs an "op"`);
      const entry = options.ops[op];
      if (!entry) {
        return badRequest(`${options.id} does not know the op "${op}"`);
      }
      const target = bridge(entry.bridge);
      if (!target) {
        return notAvailable(options.whenMissing ?? `${entry.bridge} is not available in this build`);
      }
      const mapped = entry.map ? entry.map(params) : params;
      return target.handler(mapped, ctx);
    },
  };
}

/** The first string among the candidates (the core params are loose). */
export function str(params: Record<string, any>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** The first defined value among the candidates. */
export function pick(params: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    if (params?.[key] !== undefined) return params[key];
  }
  return undefined;
}
