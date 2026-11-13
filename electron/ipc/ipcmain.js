"use strict";
// autumn IPC registrar — the main-process half of the facade (docs/architecture/ipc-facade.md Wave 0).
//
// One generic `ipcMain.handle(CALL)` receives every renderer->backend call as
// { kind, id, params } and routes it through registry.dispatch(), which applies
// per-principal auth -> schema validation -> handler -> envelope. There is no
// per-method ipcMain registration by hand — registering a handler in ./registry
// is the only way to make a facade method real.
//
// Also exposes `INSPECT`, the Bridge Inspector's data channel: manifest surface
// + implemented handlers + a rolling log of recent dispatches (dev manual testing,
// docs/architecture/ipc-facade.md layer 7).
//
// Headless-testable: `ipcMain` is injected (a fake with .handle() works), so the
// registrar itself is unit-tested without Electron.

const { dispatch, implemented, manifest } = require("./registry");
const { CALL, EVENT, INSPECT } = require("./facade");

/**
 * Default principal derivation (fail-closed): the principal comes from the
 * SENDER's origin, never from the payload. A renderer page loaded from our own
 * app origin is `desktop`; anything else is `untrusted` — which is not a known
 * principal, so coreMethodAllowed() denies every call.
 * @param {object} event  Electron IpcMainInvokeEvent (senderFrame.url)
 * @param {string[]} allowedOrigins
 */
function derivePrincipal(event, allowedOrigins) {
  const url =
    (event && event.senderFrame && event.senderFrame.url) ||
    (event && event.sender && typeof event.sender.getURL === "function" ? event.sender.getURL() : "") ||
    "";
  if (url && allowedOrigins.some((o) => url.startsWith(o))) return "desktop";
  return "untrusted";
}

/**
 * @param {{handle:(channel:string, fn:Function)=>any}} ipcMain
 * @param {object} [opts]
 * @param {boolean} [opts.isDev]        enables dispatch logging
 * @param {string[]} [opts.allowedOrigins]  app origins the renderer may load from
 *                                          (default: 127.0.0.1/localhost:3000)
 * @param {(event:object)=>string} [opts.getPrincipal]  sender -> principal id
 *                                                      (overrides derivePrincipal)
 * @param {number} [opts.maxRecent]     rolling log size (default 200)
 * @param {(line:string)=>void} [opts.log]  log sink (default console.log)
 */
function attachIpcMain(ipcMain, opts = {}) {
  const isDev = !!opts.isDev;
  const allowedOrigins = opts.allowedOrigins || [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ];
  const getPrincipal =
    opts.getPrincipal || ((event) => derivePrincipal(event, allowedOrigins));
  const maxRecent = opts.maxRecent ?? 200;
  const log = opts.log || ((line) => console.log(line));

  /** Rolling log of recent dispatches: { t, kind, id, principal, ms, ok, code } */
  const recent = [];

  ipcMain.handle(CALL, async (event, req) => {
    const principal = getPrincipal(event);
    const id = req && typeof req.id === "string" ? req.id : "";
    const kind = req && (req.kind === "core" || req.kind === "bridge") ? req.kind : "bridge";
    const started = Date.now();

    const envelope = id
      ? await dispatch({ kind, id, params: (req && req.params) || {}, principal })
      : { ok: false, error: { code: "bad-params", message: "dispatch requires an id" } };

    const entry = {
      t: started,
      kind,
      id,
      principal,
      ms: Date.now() - started,
      ok: !!envelope.ok,
      code: envelope.ok ? undefined : envelope.error.code,
    };
    recent.unshift(entry);
    if (recent.length > maxRecent) recent.pop();

    if (isDev) {
      log(
        `[ipc] ${kind}:${id} | ${principal} | ` +
          (entry.ok ? `ok ${entry.ms}ms` : `${entry.code} ${entry.ms}ms`)
      );
    }
    return envelope;
  });

  // Bridge Inspector data channel (manifest surface + implemented + recent log).
  ipcMain.handle(INSPECT, async () => {
    const impl = implemented();
    const implSet = new Set(impl.map((h) => `${h.kind}:${h.id}`));
    return {
      project: manifest.project,
      protocol: manifest.protocol,
      counts: manifest.counts,
      namespaces: Object.entries(manifest.bridge.namespaces).map(([ns, methods]) => {
        const done = methods.filter((m) => implSet.has(`bridge:${ns}.${m}`));
        return { ns, total: methods.length, implemented: done.length, methods: done.map((m) => `${ns}.${m}`) };
      }),
      implemented: impl,
      recent: recent.slice(0, 100),
    };
  });

  /**
   * Push an event to subscribers of a facade `on*` method.
   * @param {{webContents:{send:(channel:string, payload:any)=>any}}} win
   * @param {string} id  "ns.method" of the subscription
   */
  function emit(win, id, payload) {
    if (win && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(EVENT(id), payload);
    }
  }

  return { recent, emit, getPrincipal };
}

module.exports = { attachIpcMain, derivePrincipal };
