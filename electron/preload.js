// Autumn — Electron preload (contextBridge).
//
// Exposes `window.autumn`: the facade over autumn's IPC/core-RPC backend.
// The shape is GENERATED from electron/ipc/manifest.json (RE'd from the target,
// October Desktop v1.0.56): 68 namespaces / 572 methods, where
//   - `on*` methods subscribe to main-pushed events (returns unsubscribe)
//   - everything else invokes the generic `autumn:invoke` channel and resolves
//     to the standard envelope { ok, result | error }.
//
// `window.october` is exposed as a compatibility alias ONLY, so target-renderer
// code ported during Waves 1–4 resolves unchanged. autumn is the project.
//
// Pre-existing autumn members (openFileDialog / onTerminalData) are kept so the
// current UI keeps working while the backend migrates onto the facade (Wave 0/1).
//
// sandbox:false in webPreferences is what lets this preload require local modules.

const { contextBridge, ipcRenderer } = require("electron");
const { buildFacade, CALL, EVENT, INSPECT } = require("./ipc/facade");
const manifest = require("./ipc/manifest.json");

const invoke = (req) => ipcRenderer.invoke(CALL, req);

// Subscription plumbing: one IPC event channel per `ns.method` subscription.
function subscribe(id, cb) {
  const channel = EVENT(id);
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const facade = buildFacade({
  manifest,
  invoke,
  subscribe,
  legacy: {
    // Native file/folder picker (pre-facade API). Returns string[] | null.
    // Wave 1 moves this onto the facade as `projects.pickFolder`.
    openFileDialog: (opts) => ipcRenderer.invoke("autumn:openFileDialog", opts),
    // PTY stream push (pre-facade). The real terminal rides /api/terminal (SSE)
    // until Wave 1 re-wires it onto `terminal.onData`.
    onTerminalData: (cb) => {
      const handler = (_e, d) => cb(d);
      ipcRenderer.on("autumn:terminal-data", handler);
      return () => ipcRenderer.removeListener("autumn:terminal-data", handler);
    },
  },
  inspect: () => ipcRenderer.invoke(INSPECT),
});

contextBridge.exposeInMainWorld("autumn", facade);
// Compatibility alias for ported target-renderer code (see header).
contextBridge.exposeInMainWorld("october", facade);
