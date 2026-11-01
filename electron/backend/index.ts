// autumn — backend host: wires the ported route logic into the IPC registry.
//
// This is the "backend moves into Electron main" step of the Wave-0 migration
// (doc 29): the SAME src/lib/autumn modules the Next routes use are loaded here
// via electron/ts-register.js, and every handler is registered in the shared
// registry so it serves `window.autumn.*` calls through the generic registrar.
//
// Until the renderer flips off `fetch` (M2) and the routes are deleted (M3),
// both hosts serve the same logic — Prisma/SQLite tolerates the transitional
// dual access; M3 leaves main as the single owner.

import { makeHandlers, type BackendDeps, type RegisteredHandler } from "./handlers";

// CJS registry (electron/ipc/registry.js) — plain require through the ts hook.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const registry = require("../ipc/registry");

/** Real dependencies: the production lib modules (lazy — nothing loads Prisma
 *  until registerBackend() runs). */
function realDeps(emit: (id: string, payload: unknown) => void): BackendDeps {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const busStore = require("@/lib/autumn/bus-store");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require("@/lib/autumn/pty");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const spawner = require("@/lib/autumn/spawner");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require("@/lib/db");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PERSONA_BY_ID } = require("@/lib/autumn/personas");
  return { busStore, pty, spawner, db, personas: { PERSONA_BY_ID }, emit };
}

export interface IpcApiLike {
  emit(win: unknown, id: string, payload: unknown): void;
}

/**
 * Register every backend handler in the IPC registry.
 * @param ipcApi  result of attachIpcMain() (provides event pushes)
 * @param opts.getWindow  current BrowserWindow provider (for emit)
 */
export function registerBackend(
  ipcApi: IpcApiLike,
  opts: { getWindow: () => unknown },
): RegisteredHandler[] {
  const emit = (id: string, payload: unknown) => ipcApi.emit(opts.getWindow(), id, payload);
  const handlers = makeHandlers(realDeps(emit));
  for (const h of handlers) {
    registry.register(h.kind, h.id, h.handler, {
      schema: h.schema,
      description: h.description,
    });
  }
  return handlers;
}

export { makeHandlers };
export type { BackendDeps, RegisteredHandler };
