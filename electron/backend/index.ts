// autumn — backend host: wires the ported route logic into the IPC registry.
//
// This is the "backend moves into Electron main" step of the Wave-0 migration
// (docs/architecture/ipc-facade.md): the SAME src/lib/autumn modules the Next routes use are loaded here
// via electron/ts-register.js, and every handler is registered in the shared
// registry so it serves `window.autumn.*` calls through the generic registrar.
//
// Wave-2 (docs/architecture/backend.md): the 12 platform milestone handlers (settings/diagnostics/resources/nav/
// element/runtime/wallpapers/cues/skills/update/auth/agentAccounts) register alongside the
// Wave-1 factories and
// the original 14 route handlers. Their shared dependency surface is W1Deps (w1-deps.ts); the
// platform modules additionally use the flat-JSON store helper (store.ts).

import { makeHandlers, type BackendDeps, type RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { makeBusHandlers } from "./bus";
import { makeTerminalHandlers } from "./terminal";
import { makeCanvasHandlers } from "./canvas";
import { makeFilesHandlers } from "./files";
import { makeFsHandlers } from "./fs";
import { makeGitHandlers } from "./git";
import { makeDevServerHandlers } from "./devserver";
import { makeOsHandlers } from "./os";
import { makeArtifactsHandlers } from "./artifacts";
import { makeSessionsHandlers } from "./sessions";
import { makeTasksHandlers } from "./tasks";
import { makeAgentHandlers } from "./agent";
import { makePchHandlers } from "./pch";
import { makeSettingsHandlers } from "./settings";
import { makeDiagnosticsHandlers } from "./diagnostics";
import { makeResourcesHandlers } from "./resources";
import { makeNavHandlers } from "./nav";
import { makeElementHandlers } from "./element";
import { makeRuntimeHandlers } from "./runtime";
import { makeWallpapersHandlers } from "./wallpapers";
import { makeCuesHandlers } from "./cues";
import { makeSkillsHandlers } from "./skills";
import { makeUpdateHandlers } from "./update";
import { makeAuthHandlers } from "./auth";
import { makeAgentAccountsHandlers } from "./agentAccounts";
import { makeBackendsHandlers } from "./backends";
import { makeBrowserHandlers } from "./browser";
import { makeVoiceHandlers } from "./voice";
import { makePhoneHandlers } from "./phone";
import { makeVideoHandlers } from "./video";
import { makeSlidesHandlers } from "./slides";
import { makeRemotionHandlers } from "./remotion";
import { makeStorageHandlers } from "./storage";
import { makeSupermemoryHandlers } from "./supermemory";
import { makeAutopilotHandlers } from "./autopilot";
import { makeCoreHandlers } from "./core";

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

/** Wave-1 dependencies: BackendDeps + node/electron surfaces (docs/architecture/backend.md). */
function realW1Deps(emit: (id: string, payload: unknown) => void): W1Deps {
  // `any` on purpose: the require()d modules are untyped at this boundary and
  // are structurally W1Deps at runtime (Prisma has the Wave-1 models after
  // `prisma generate`; pty exports onPtyExit/ptyExists/ptyKind — docs/architecture/backend.md).
  const base: any = realDeps(emit);
  // electron modules are required lazily so headless tests never load them.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs/promises");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { simpleGit } = require("simple-git");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cp = require("node:child_process");
  return {
    ...base,
    now: () => Date.now(),
    fs,
    git: (cwd: string) => simpleGit({ baseDir: cwd, binary: "git", maxConcurrentProcesses: 1 }),
    spawn: {
      spawn: (command, args, opts) =>
        cp.spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }),
    },
    shell: {
      openPath: async (p: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require("electron");
        return shell.openPath(p);
      },
      showItemInFolder: (p: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require("electron");
        shell.showItemInFolder(p);
      },
      openExternal: async (url: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require("electron");
        await shell.openExternal(url);
      },
      trashItem: async (p: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require("electron");
        await shell.trashItem(p);
      },
    },
    clipboard: {
      readText: () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clipboard } = require("electron");
        return clipboard.readText();
      },
      writeText: (text: string) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clipboard } = require("electron");
        clipboard.writeText(text);
      },
      readImage: () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clipboard } = require("electron");
        const img = clipboard.readImage();
        return img && !img.isEmpty() ? img : null;
      },
    },
    screen: {
      capture: async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { desktopCapturer } = require("electron");
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1280, height: 720 },
        });
        const primary = sources[0];
        return primary && primary.thumbnail && !primary.thumbnail.isEmpty()
          ? primary.thumbnail.toDataURL()
          : null;
      },
    },
  };
}

export interface IpcApiLike {
  emit(win: unknown, id: string, payload: unknown): void;
}

/** Every Wave-1 module factory — kept in one list so registration stays atomic. */
const W1_FACTORIES = [
  makeBusHandlers,
  makeTerminalHandlers,
  makeCanvasHandlers,
  makeFilesHandlers,
  makeFsHandlers,
  makeGitHandlers,
  makeDevServerHandlers,
  makeOsHandlers,
  makeArtifactsHandlers,
  makeSessionsHandlers,
  makeTasksHandlers,
  makeAgentHandlers,
  makePchHandlers,
];

/** Every Wave-2 (platform) module factory. Wave-1 factories register alongside. */
const W2_FACTORIES = [
  makeSettingsHandlers,
  makeDiagnosticsHandlers,
  makeResourcesHandlers,
  makeNavHandlers,
  makeElementHandlers,
  makeRuntimeHandlers,
  makeWallpapersHandlers,
  makeCuesHandlers,
  makeSkillsHandlers,
  makeUpdateHandlers,
  makeAuthHandlers,
  makeAgentAccountsHandlers,
  makeBackendsHandlers,
  makeBrowserHandlers,
  makeVoiceHandlers,
  makePhoneHandlers,
  makeVideoHandlers,
  makeSlidesHandlers,
  makeRemotionHandlers,
  makeStorageHandlers,
  makeSupermemoryHandlers,
  makeAutopilotHandlers,
];

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
  const deps = realW1Deps(emit);
  const handlers: RegisteredHandler[] = [
    ...makeHandlers(deps),
    ...W1_FACTORIES.flatMap((make) => make(deps)),
    ...W2_FACTORIES.flatMap((make) => make(deps)),
  ];
  // The core protocol (129 methods / 21 groups) is the bus-facing view of the
  // SAME backend — so a core method delegates to the bridge handler that
  // already does the work.
  const bridgeById = new Map(handlers.map((h) => [h.id, h]));
  const coreHandlers = makeCoreHandlers(deps, (id) => bridgeById.get(id));
  for (const h of handlers) {
    registry.register(h.kind, h.id, h.handler, {
      schema: h.schema,
      description: h.description,
    });
  }
  for (const h of coreHandlers) {
    registry.register(h.kind, h.id, h.handler, {
      schema: h.schema,
      description: h.description,
    });
  }
  return [...handlers, ...coreHandlers];
}

// Wave 1 factories export: the contract test registers the wave-2 set too.
export { makeHandlers, W1_FACTORIES, W2_FACTORIES };
export type { BackendDeps, RegisteredHandler, W1Deps };
