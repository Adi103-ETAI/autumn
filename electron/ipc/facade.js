"use strict";
// autumn preload facade — builds the `window.autumn` object from the manifest.
//
// The facade is generated from electron/ipc/manifest.json (RE'd from the target,
// October Desktop v1.0.56) so the shape can never drift from the oracle:
//   - 68 namespaces / 572 second-level methods
//   - `on*` methods (68) are SUBSCRIPTIONS: (cb) => unsubscribe
//   - all other methods (504) are CALLS: (params) => Promise<envelope>
//
// Transport is a single generic IPC channel (`autumn:invoke`) handled by the
// registrar in ./ipcmain.js -> registry.dispatch(). The renderer never talks to
// anything else — the "every renderer->backend call goes through the facade" rule
// (doc 29 Wave 0).
//
// Pure module: `invoke`/`subscribe` are injected so this is testable headless.

const CALL = "autumn:invoke";
const EVENT = (id) => `autumn:event:${id}`;
const INSPECT = "autumn:inspect";

/** Subscription methods follow October's `on<Event>` convention. */
function isEventMethod(name) {
  return /^on[A-Z]/.test(name);
}

/**
 * @param {object} opts
 * @param {object} opts.manifest  loaded electron/ipc/manifest.json
 * @param {(req:{kind:string,id:string,params:object})=>Promise<any>} opts.invoke
 * @param {(id:string, cb:Function)=>Function} opts.subscribe  returns unsubscribe
 * @param {object} [opts.legacy]  autumn's own pre-facade members (kept for the
 *                                existing UI; not part of the target surface)
 * @param {object} [opts.inspect]  dev Bridge Inspector accessor (autumn's own
 *                                   member, exposed as `window.autumn.__bridge`)
 * @param {string[]} [opts.privateOps] autumn-private op ids ("__ops.<name>"),
 *                                   exposed as `window.autumn.__ops.<name>`
 *                                   (source of truth: ./private-ops.js)
 */
function buildFacade({ manifest, invoke, subscribe, legacy = {}, inspect, privateOps = [] }) {
  const root = {};

  for (const [ns, methods] of Object.entries(manifest.bridge.namespaces)) {
    const member = {};
    for (const m of methods) {
      const id = `${ns}.${m}`;
      if (isEventMethod(m)) {
        member[m] = (cb) => subscribe(id, cb);
      } else {
        // Calls take ONE params object (autumn convention). The TARGET's renderer
        // also calls positionally — `signIn(email, password)`, `terminal.input(id, data)`
        // — and a single-arg facade would silently drop everything after arg 1.
        // Multi-arg calls are packed as {args:[...]} and normalizers in the handler
        // modules (paramsOf in auth.ts/agentAccounts.ts) accept both shapes.
        member[m] = (params, ...rest) =>
          invoke({
            kind: "bridge",
            id,
            params: rest.length > 0 ? { args: [params, ...rest] } : (params ?? {}),
          });
      }
    }
    root[ns] = member;
  }

  // autumn's own compat members (pre-facade UI keeps working during migration)
  for (const [k, v] of Object.entries(legacy)) {
    if (k in root) throw new Error(`legacy member collides with target namespace: ${k}`);
    root[k] = v;
  }

  // autumn's own dev tooling member (Bridge Inspector) — not a target member
  if (inspect) {
    if ("__bridge" in root) throw new Error("__bridge key collides");
    root.__bridge = inspect;
  }

  // autumn-private ops (no target-surface equivalent) — see ./private-ops.js.
  // Exposed 1:1: registry id `__ops.<name>` <-> facade member `__ops.<name>`.
  if (privateOps.length) {
    if ("__ops" in root) throw new Error("__ops key collides");
    const ops = {};
    for (const id of privateOps) {
      const name = id.startsWith("__ops.") ? id.slice("__ops.".length) : id;
      ops[name] = (params) => invoke({ kind: "bridge", id: `__ops.${name}`, params: params ?? {} });
    }
    root.__ops = ops;
  }

  // Core-RPC surface: the target's SECOND method set (129 CORE_METHODS / 21
  // groups, registry kind "core"). The target's renderer never calls these
  // directly — they serve CLI/remote/local-client principals over the bus
  // server — but autumn's ported bus client lives in the renderer, so it
  // reaches the same registry handlers through `window.autumn.__core`.
  // (dunder = autumn's own transport member, like __ops/__bridge; generated
  // from the manifest so the shape can never drift from the oracle.)
  if (manifest.core && manifest.core.groups) {
    if ("__core" in root) throw new Error("__core key collides");
    const coreRoot = {};
    for (const [group, ids] of Object.entries(manifest.core.groups)) {
      const member = {};
      for (const id of ids) {
        const m = id.startsWith(`${group}.`) ? id.slice(group.length + 1) : id;
        member[m] = (params) => invoke({ kind: "core", id, params: params ?? {} });
      }
      coreRoot[group] = member;
    }
    root.__core = coreRoot;
  }

  return root;
}

module.exports = { buildFacade, isEventMethod, CALL, EVENT, INSPECT };
