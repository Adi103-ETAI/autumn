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
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const net = require("net");
const { existsSync } = require("fs");

/**
 * Map a path inside the packaged asar to its REAL location on disk.
 * The Prisma CLI is spawned as a child process — that cannot run from inside
 * an asar, so it ships unpacked and this points at the real file.
 */
function realPath(p) {
  if (!app.isPackaged || !p) return p;
  const appPath = app.getAppPath(); // …/resources/app.asar
  const marker = `${appPath.slice(0, -".asar".length)}/`;
  if (!p.startsWith(marker)) return p;
  const candidate = `${appPath}.unpacked/${p.slice(marker.length)}`;
  return existsSync(candidate) ? candidate : p;
}

// autumn IPC core (docs/architecture/ipc-facade.md Wave 0): every window.autumn.* call lands in the generic
// registrar -> registry.dispatch() -> auth -> schema -> handler -> envelope.
const { attachIpcMain } = require("./ipc/ipcmain");
const registry = require("./ipc/registry");

// Wave-0 migration: host the src/lib/autumn backend in main.
//
// dev      → the TypeScript sources, transpiled on require (electron/ts-register.js).
// packaged → the PRE-BUNDLED javascript (electron/dist/backend.cjs, built by
//            scripts/build-backend.mjs). A packaged app ships only production
//            dependencies, so `typescript` is not there to transpile at runtime.
//            The bundle keeps ../ipc/registry EXTERNAL, so it registers into
//            the SAME registry instance this file uses.
let registerBackend;
if (app.isPackaged) {
  registerBackend = require("./dist/backend.cjs").registerBackend;
} else {
  require("./ts-register");
  registerBackend = require("./backend/index.ts").registerBackend;
}

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

/**
 * The Next server the renderer talks to.
 *
 * dev       → `next dev` from the repo (hot reload, the source tree).
 * packaged  → the standalone server (`resources/standalone/server.js`), run
 *             with ELECTRON_RUN_AS_NODE so the Electron binary acts as node.
 *             A packaged app has no `next` CLI and no source tree, so the
 *             old `next start` path could never have worked.
 */
function nextServerCommand() {
  if (isDev) {
    return { cmd: "npx", args: ["next", "dev", "-p", String(PORT)], cwd: app.getAppPath(), env: {} };
  }
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const entry = path.join(standaloneDir, "server.js");
  return {
    cmd: process.execPath,
    args: [entry],
    cwd: standaloneDir,
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      // The packaged DB lives in the user's data dir, not next to the app
      // (the install dir is read-only on Windows).
      DATABASE_URL: `file:${path.join(app.getPath("userData"), "db", "autumn.db")}`,
    },
  };
}

function startNextServer() {
  const { cmd, args, cwd, env } = nextServerCommand();
  const childEnv = { ...process.env, AUTUMN_PORT: String(PORT), ...env };

  nextChild = spawn(cmd, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  nextChild.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  nextChild.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  nextChild.on("exit", (code) => {
    if (!quitting) console.error(`[next] exited with ${code}`);
  });
  return nextChild;
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

// ---- IPC registrar: all window.autumn.* traffic (docs/architecture/ipc-facade.md Wave 0) ----
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

/**
 * The database the app uses lives in the user's data dir (NOT next to the
 * install dir — that is read-only on Windows). In dev the developer creates it
 * with `npm run db:push`; a packaged app must create it itself, so the
 * Prisma CLI is shipped (unpacked — a child process cannot run from inside
 * an asar) and run once against the shipped schema.
 */
function ensurePackagedDatabase() {
  if (!app.isPackaged) return;
  const fs = require("fs");
  const dbDir = path.join(app.getPath("userData"), "db");
  const dbFile = path.join(dbDir, "autumn.db");
  const schema = path.join(process.resourcesPath, "standalone", "prisma", "schema.prisma");
  if (!fs.existsSync(schema)) {
    console.warn("[main] packaged schema not found — skipping the database bootstrap");
    return;
  }
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    // The CLI is shipped unpacked; map the asar path to the real one.
    const cli = realPath(require.resolve("prisma/build/index.js"));
    const res = spawnSync(process.execPath, [cli, "db", "push", "--schema", schema, "--skip-generate"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DATABASE_URL: `file:${dbFile}` },
      stdio: "ignore",
    });
    if (res.status !== 0) console.warn(`[main] prisma db push exited ${res.status}`);
  } catch (e) {
    console.warn(`[main] database bootstrap failed: ${e && e.message}`);
  }
}

app.whenReady().then(async () => {
  ensurePackagedDatabase();
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
