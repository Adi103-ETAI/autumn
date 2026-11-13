"use strict";
// autumn IPC registry — dispatcher at the center of the B architecture (docs/architecture/ipc-facade.md Wave 0).
//
// One place to register a handler per method and dispatch a call with:
//   principal auth -> schema validation -> handler -> envelope.
//
// Two method kinds share the mechanism (they are both dotted ids):
//   "bridge"  -> window.autumn.<ns>.<method>    (572 methods / 68 ns, preload-api.md)
//                (`window.autumn` is the only surface the renderer sees)
//   "core"    -> <group>.<method>               (129 methods / 21 groups, core-methods.md)
//
// Naming: this project is **autumn**. The public API belongs to Autumn.
//
// Design notes:
//   - Handlers are plain Node functions (injected deps) so layers 1–3 are testable
//     headless — no Electron needed (docs/architecture/ipc-facade.md).
//   - The registry tracks only IMPLEMENTED handlers; unimplemented manifest methods
//     surface as not-found (facade stubs return not-implemented at the preload edge).
//   - authRules default to the fail-closed skeleton in ./auth (real matrix = Wave 4).

const { ok, err, isEnvelope, ERR } = require("./envelope");
const { coreMethodAllowed, PRINCIPALS } = require("./auth");
const manifest = require("./manifest.json");

const API_VERSION = manifest.protocol.API_VERSION;
const SCHEMA = manifest.protocol.SCHEMA;

/** @type {Map<string, {kind:string,id:string,handler:Function,schema:Function|null,authRules:object|null,description:string}>} */
const handlers = new Map();

const key = (kind, id) => `${kind}:${id}`;

function register(kind, id, handler, opts = {}) {
  if (kind !== "bridge" && kind !== "core") throw new TypeError(`kind must be bridge|core, got "${kind}"`);
  if (typeof id !== "string" || !id.includes(".")) throw new TypeError(`id must be a dotted "ns.method", got "${id}"`);
  if (typeof handler !== "function") throw new TypeError("handler must be a function");
  const k = key(kind, id);
  if (handlers.has(k)) throw new Error(`duplicate handler: ${k}`);
  handlers.set(k, {
    kind,
    id,
    handler,
    schema: opts.schema || null,
    authRules: opts.authRules || null,
    description: opts.description || "",
  });
  return k;
}

function has(kind, id) {
  return handlers.has(key(kind, id));
}

function unregister(kind, id) {
  return handlers.delete(key(kind, id));
}

function reset() {
  handlers.clear();
}

/** Introspection for the Bridge Inspector / conformance tests. */
function implemented() {
  return [...handlers.values()].map((h) => ({ kind: h.kind, id: h.id, description: h.description }));
}

/**
 * Dispatch a call and always resolve to an envelope (never throws).
 * @param {{kind?: "bridge"|"core", id: string, principal?: string, params?: object}} req
 * @returns {Promise<{ok:boolean, result?:any, error?:{code:string,message:string,detail?:any}}>}
 */
async function dispatch(req = {}) {
  const { kind = "bridge", id, principal = "desktop", params = {} } = req;
  if (typeof id !== "string" || !id) return err(ERR.BAD_PARAMS, "dispatch requires an id");

  const h = handlers.get(key(kind, id));
  if (!h) return err(ERR.NOT_FOUND, `no handler for ${kind}:${id}`);

  const auth = coreMethodAllowed(principal, id, h.authRules || undefined);
  if (!auth.allowed) return err(ERR.FORBIDDEN, auth.reason);

  if (h.schema) {
    let v;
    try {
      v = h.schema(params, { principal });
    } catch (e) {
      return err(ERR.BAD_PARAMS, e && e.message ? e.message : String(e));
    }
    if (v && v.ok === false) return err(ERR.BAD_PARAMS, v.message || "invalid params", v.detail);
  }

  try {
    const result = await h.handler(params, { principal, kind, id });
    if (isEnvelope(result)) return result; // handler returned a deliberate envelope (e.g. not-implemented)
    return ok(result);
  } catch (e) {
    return err(ERR.HANDLER_ERROR, e && e.message ? e.message : String(e));
  }
}

/** True if the method is part of the contract surface (, adapted). */
function inManifest(kind, id) {
  if (kind === "core") {
    return Object.values(manifest.core.groups).some((m) => m.includes(id));
  }
  const [ns, method] = id.split(".");
  const list = manifest.bridge.namespaces[ns];
  return Array.isArray(list) && list.includes(method);
}

module.exports = {
  register,
  has,
  unregister,
  reset,
  dispatch,
  implemented,
  inManifest,
  PRINCIPALS,
  API_VERSION,
  SCHEMA,
  manifest,
};
