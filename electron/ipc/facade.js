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
 * @param {Function} [opts.inspect]  dev Bridge Inspector accessor (autumn's own
 *                                   member, exposed as `window.autumn.__bridge`)
 */
function buildFacade({ manifest, invoke, subscribe, legacy = {}, inspect }) {
  const root = {};

  for (const [ns, methods] of Object.entries(manifest.bridge.namespaces)) {
    const member = {};
    for (const m of methods) {
      const id = `${ns}.${m}`;
      if (isEventMethod(m)) {
        member[m] = (cb) => subscribe(id, cb);
      } else {
        member[m] = (params) => invoke({ kind: "bridge", id, params: params ?? {} });
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

  return root;
}

module.exports = { buildFacade, isEventMethod, CALL, EVENT, INSPECT };
