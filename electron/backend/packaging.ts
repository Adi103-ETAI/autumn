// autumn — resolve a path that may live inside the packaged asar.
//
// A packaged app stores most files inside `app.asar` — a virtual archive that
// Electron's fs layer can read, but that a CHILD PROCESS cannot execute and
// that `node:child_process` cannot open as a script. Anything that has to be
// spawned (the Prisma CLI, the Remotion CLI) is therefore shipped unpacked
// (`app.asar.unpacked`) and must be resolved to its REAL path on disk.
//
// This helper maps a path inside the asar to the unpacked copy when it exists,
// and leaves every other path alone.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The real (unpacked) directory of the running app, or null in dev. */
export function unpackedRoot(): string | null {
  // electron is only available in the main process; the backend modules run
  // there, but the tests run under plain node (where it is absent).
  let app: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("electron");
  } catch {
    app = null;
  }
  if (!app || typeof app !== "object" || !app.getAppPath) return null;
  try {
    if (!app.isPackaged) return null;
    const appPath: string = app.getAppPath(); // …/resources/app.asar
    const unpacked = `${appPath}.unpacked`;
    return existsSync(unpacked) ? unpacked : null;
  } catch {
    return null;
  }
}

/**
 * Map a path that points inside the asar to its unpacked twin.
 * `…/resources/app.asar/node_modules/prisma/build/index.js` becomes
 * `…/resources/app.asar.unpacked/node_modules/prisma/build/index.js`.
 */
export function realPath(p: string): string {
  if (!p) return p;
  const root = unpackedRoot();
  if (!root) return p;
  const marker = `${root.slice(0, -".unpacked".length)}/`;
  if (!p.startsWith(marker)) return p;
  const rel = p.slice(marker.length);
  const candidate = join(root, rel);
  return existsSync(candidate) ? candidate : p;
}

/**
 * The app's own `remotion` executable (node_modules/.bin) — mapped to its
 * real path on disk when the app is packaged.
 */
export function findRemotionBinInApp(): string | null {
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  const appBin = join(__dirname, "..", "..", "node_modules", ".bin");
  for (const ext of exts) {
    const p = realPath(join(appBin, `remotion${ext}`));
    if (existsSync(p)) return p;
  }
  return null;
}
