// Autumn — Electron main process.
//
// Strategy (faithful to Autumn Desktop, tractable to build):
//   The Next.js server ALREADY is the "real backend" — it runs on Node and
//   serves /api/* (bus, agent/run spawner, terminals, commander, canvas, logs).
//   Electron's only job is to (1) boot that server and (2) open a native
//   BrowserWindow pointed at it. The agent CLIs are spawned BY the Next server
//   (see src/lib/autumn/spawner.ts), not by the main process — so this file
//   stays small and the backend logic stays testable with `next dev` too.

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

// autumn IPC core (doc 29 Wave 0): every window.autumn.* call lands in the generic
// registrar -> registry.dispatch() -> auth -> schema -> handler -> envelope.
const { attachIpcMain } = require("./ipc/ipcmain");
const registry = require("./ipc/registry");

// Wave-0 migration: host the src/lib/autumn backend in main (transpiles the TS
// lib modules on require — see electron/ts-register.js).
require("./ts-register");
const { registerBackend } = require("./backend/index.ts");

// WSLg-friendly GPU handling - keep minimal; package.json already adds --no-sandbox --disable-gpu
app.commandLine.appendSwitch("no-sandbox");

const PORT = process.env.AUTUMN_PORT || 3000;
const PROTOCOL = "http";
const BASE = `${PROTOCOL}://127.0.0.1:${PORT}`;
const isDev = !app.isPackaged;
const QUIT_GRACE_MS = 4000;

let mainWindow = null;
let nextChild = null;
let quitting = false;

function startNextServer() {
  // In dev we run `next dev`; in a packaged build we `next start` against the
  // standalone output produced by `next build`. Either way it's the same server
  // the renderer talks to, and the same server that spawns real agents.
  const cmd = isDev ? "npx" : process.execPath;
  const args = isDev
    ? ["next", "dev", "-p", String(PORT)]
    : ["next", "start", "-p", String(PORT)];
  const cwd = app.getAppPath();
  const env = { ...process.env, AUTUMN_PORT: String(PORT) };

  nextChild = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  nextChild.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  nextChild.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  nextChild.on("exit", (code) => {
    if (!quitting) console.error(`[next] exited with ${code}`);
  });
}

// Poll the port until the Next server answers, then open the window.
function waitForServer(retries = 120) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      const sock = net.connect(PORT, "127.0.0.1");
      sock.setTimeout(800);
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (n <= 0) return reject(new Error("Next server did not start"));
        setTimeout(() => tryOnce(n - 1), 500);
      });
      sock.once("timeout", () => {
        sock.destroy();
        if (n <= 0) return reject(new Error("Next server timed out"));
        setTimeout(() => tryOnce(n - 1), 500);
      });
    };
    tryOnce(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Autumn",
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for node-pty bridge + native dialogs
    },
  });

  mainWindow.loadURL(BASE);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Native file dialog bridge (legacy renderer call window.autumn.openFileDialog).
ipcMain.handle("autumn:openFileDialog", async (_e, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || "Select folder",
    properties: opts.directory ? ["openDirectory"] : ["openFile", "multiSelections"],
  });
  return result.canceled ? null : result.filePaths;
});

// ---- IPC registrar: all window.autumn.* traffic (doc 29 Wave 0) ----
// Principal derives from the sender's origin (fail-closed): only pages loaded
// from our own server are `desktop`.
const APP_ORIGINS = [BASE, `${PROTOCOL}://localhost:${PORT}`];
const ipcApi = attachIpcMain(ipcMain, { isDev, allowedOrigins: APP_ORIGINS });

// ---- Backend in main: the 7 Next API routes, ported as registry handlers ----
// (bus/terminal/canvas/activity/commander/agentRun — see electron/backend/handlers.ts)
const backendHandlers = registerBackend(ipcApi, { getWindow: () => mainWindow });
if (isDev) {
  console.log(`[main] backend: ${backendHandlers.length} handlers registered`);
}

// First REAL facade method, proving the whole path end-to-end:
// renderer -> facade -> autumn:invoke -> registry -> handler -> envelope.
// (Native folder picker; the legacy openFileDialog member keeps working above
//  until Wave 1 re-points the UI at `projects.pickFolder`.)
registry.register(
  "bridge",
  "projects.pickFolder",
  async (params = {}) => {
    const dialogOpts = {
      title: params.title || "Select folder",
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || !result.filePaths.length) return null;
    return { path: result.filePaths[0] };
  },
  { description: "native folder picker (Wave 0 end-to-end proof)" }
);

// Forward lifecycle: app quit should also kill the Next server.
app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  if (nextChild) nextChild.kill("SIGTERM");
  setTimeout(() => {
    try {
      if (nextChild) nextChild.kill("SIGKILL");
    } catch {}
    app.exit(0);
  }, QUIT_GRACE_MS);
});

function checkPortActive(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.setTimeout(400);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

app.whenReady().then(async () => {
  const isAlreadyRunning = await checkPortActive(PORT);
  if (!isAlreadyRunning) {
    startNextServer();
  } else {
    console.log(`[main] Reusing already running server on port ${PORT}`);
  }
  try {
    await waitForServer();
  } catch (err) {
    console.error("[main] server wait failed:", err);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // On Linux we quit when the last window closes.
  if (process.platform !== "darwin") app.quit();
});
