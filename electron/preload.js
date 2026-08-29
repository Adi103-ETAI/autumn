// Autumn — Electron preload (contextBridge).
// Exposes a minimal, safe `window.autumn` API to the renderer. The renderer is
// the existing Next.js canvas UI; it only needs native capabilities it can't
// get from the browser: file dialogs and (Phase 3) a node-pty terminal bridge.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autumn", {
  // Open a native file/folder picker. Returns string[] | null.
  openFileDialog: (opts) => ipcRenderer.invoke("autumn:openFileDialog", opts),

  // ---- Phase 3: real terminals ----
  // The actual PTY runs in the Next server (node-pty) and streams over
  // /api/terminal (SSE). The renderer talks to that route directly, so no
  // extra bridge call is needed here yet. This is a placeholder hook for any
  // preload-only terminal needs (e.g. resize from a native event).
  onTerminalData: (cb) => ipcRenderer.on("autumn:terminal-data", (_e, d) => cb(d)),
});
