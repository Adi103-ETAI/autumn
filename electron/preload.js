// Autumn — Electron preload (contextBridge).
//
// Exposes `window.autumn`: the facade over autumn's IPC/core-RPC backend.
// The shape is GENERATED from electron/ipc/manifest.json (adapted from the target,
//): 68 namespaces / 572 methods, where
//   - `on*` methods subscribe to main-pushed events (returns unsubscribe)
//   - everything else invokes the generic `autumn:invoke` channel and resolves
//     to the standard envelope { ok, result | error }.
//
// Only `window.autumn` is exposed. autumn is the project.
//
// Pre-existing autumn members (openFileDialog / onTerminalData) are kept so the
// current UI keeps working while the backend migrates onto the facade (Wave 0/1).
//
// sandbox:false in webPreferences is what lets this preload require local modules.

const { contextBridge, ipcRenderer, webUtils } = require("electron");
const { buildFacade, CALL, EVENT, INSPECT } = require("./ipc/facade");
const PRIVATE_OPS = require("./ipc/private-ops");
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
  privateOps: PRIVATE_OPS,
});

// `pathForFile` is PRELOAD-LOCAL in the (and must be here too): Electron 32
// removed the non-standard `File.path`, and `webUtils.getPathForFile` only
// works in this process — a dropped file that should be IMPORTED (rather than
// read as bytes) has to come through here. Returns "" for a drag that is not
// a real OS file (an image dragged out of a web page), which callers filter
// out. The backend keeps a path-normalising handler under the same id (the
// facade contract requires one), but the preload-local one is the real thing.
const pathForFile = (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return "";
  }
};
facade.files.pathForFile = pathForFile;
facade.fs.pathForFile = pathForFile;

contextBridge.exposeInMainWorld("autumn", facade);
