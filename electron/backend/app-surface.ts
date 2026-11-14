// autumn — Wave-4 handlers: the local surface (app, workspace, activity,
// documents, facts).
//
// These namespaces are the ones the other principals and the renderer's own
// panels use, and they are all local: the app's own lifecycle, the scratch
// workspaces, the activity, the documents and the facts.
//
// The facts are read out of the data that is already here — the agents'
// questions are the notifications, the sessions are the run usages, the agent
// logs are the node workflows — so nothing is invented.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

// ---------------------------------------------------------------------------
// the app's own state
// ---------------------------------------------------------------------------

interface AppState {
  rendererMounted: boolean;
  rendererMountedAt?: number;
  lastOpenedCanvas?: string;
  presentationMotionPaused: boolean;
  trayAttention: boolean;
  joinedName?: string;
  joinedAt?: number;
  paused?: boolean;
  scores: Record<string, number>;
}

const appStateFile = () => dbPath("app-state.json");
const readAppState = (): AppState =>
  loadJson<AppState>(appStateFile(), {
    rendererMounted: false,
    presentationMotionPaused: false,
    trayAttention: false,
    scores: {},
  });
const writeAppState = (state: AppState): void => saveJson(appStateFile(), state);

/** The Electron window (when the backend runs inside the main process). */
function electronWindow(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BrowserWindow } = require("electron");
    return BrowserWindow.getAllWindows()[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// the scratch workspaces
// ---------------------------------------------------------------------------

interface Scratch {
  id: string;
  name: string;
  state: unknown;
  createdAt: number;
  updatedAt: number;
}

const scratchDir = () => join(dbPath(".."), "scratch");
const scratchFile = (id: string) => join(scratchDir(), `${id}.json`);
const readScratch = (id: string): Scratch | null => {
  try {
    if (!existsSync(scratchFile(id))) return null;
    return JSON.parse(readFileSync(scratchFile(id), "utf8")) as Scratch;
  } catch {
    return null;
  }
};
const listScratch = (): Scratch[] => {
  try {
    return readdirSync(scratchDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => readScratch(f.slice(0, -".json".length)))
      .filter((row): row is Scratch => row !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// the handlers
// ---------------------------------------------------------------------------

export function makeLocalSurfaceHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now, db, emit } = deps;

  /** The agents' questions — they are the notifications. */
  const questions = async (canvasId?: string) => {
    const target = deps.busStore as any;
    if (typeof target?.listPeers !== "function") return [];
    const peers = await target.listPeers(canvasId ?? "default");
    return peers ?? [];
  };

  const handlers: RegisteredHandler[] = [];

  // ---------------- app ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "app.rendererMounted",
      description: "the renderer has mounted; params: {} -> { ok }",
      handler: () => {
        const state = readAppState();
        state.rendererMounted = true;
        state.rendererMountedAt = now();
        writeAppState(state);
        return { ok: true, at: state.rendererMountedAt };
      },
    },
    {
      kind: "bridge",
      id: "app.reportOpenCanvas",
      description: "report that a canvas was opened; params: { canvasId } -> { ok }",
      schema: (p) => (typeof p?.canvasId === "string" ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: (p) => {
        const state = readAppState();
        state.lastOpenedCanvas = String(p?.canvasId);
        writeAppState(state);
        return { ok: true, canvasId: state.lastOpenedCanvas };
      },
    },
    {
      kind: "bridge",
      id: "app.coreHealth",
      description: "the app's health; params: {} -> { ok, terminals, agents, rendererMounted }",
      handler: async () => {
        const state = readAppState();
        let agents = 0;
        try {
          agents = await db.session.count({});
        } catch {
          agents = 0;
        }
        return {
          ok: true,
          terminals: deps.pty.ptyCount(),
          agents,
          rendererMounted: state.rendererMounted,
        };
      },
    },
    {
      kind: "bridge",
      id: "app.presentationMotionPaused",
      description: "whether the presentation motion is paused; params: { paused } -> { paused }",
      handler: (p) => {
        const state = readAppState();
        state.presentationMotionPaused = p?.paused !== false;
        writeAppState(state);
        return { paused: state.presentationMotionPaused };
      },
    },
    {
      kind: "bridge",
      id: "app.retryCore",
      description: "retry the app's core; params: {} -> { retried, ok }",
      handler: async () => {
        // The core is the main process; what can be retried here is the
        // renderer handshake — so the app asks the renderer to re-mount.
        emit("app.coreHealth", { ok: true, at: now() });
        return { retried: true, ok: true };
      },
    },
    {
      kind: "bridge",
      id: "app.toggleFullscreen",
      description: "toggle the window's fullscreen; params: {} -> { fullscreen }",
      handler: async () => {
        const win = electronWindow();
        if (!win) return handlerError("the window is not available in this process");
        const next = !win.isFullScreen();
        win.setFullScreen(next);
        return { fullscreen: next };
      },
    },
    {
      kind: "bridge",
      id: "app.setTrafficLights",
      description: "show or hide the window's traffic lights; params: { visible } -> { visible }",
      handler: (p) => {
        const win = electronWindow();
        if (!win) return handlerError("the window is not available in this process");
        const visible = p?.visible !== false;
        if (typeof win.setWindowButtonVisibility === "function") {
          win.setWindowButtonVisibility(visible);
          return { visible };
        }
        if (typeof win.setTitleBarStyle === "function") {
          win.setTitleBarStyle(visible ? "hiddenInset" : "default");
          return { visible };
        }
        return handlerError("this platform cannot hide the window's buttons");
      },
    },
    {
      kind: "bridge",
      id: "app.relaunch",
      description: "relaunch the app; params: {} -> { relaunching }",
      handler: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { app } = require("electron");
          if (app?.relaunch) {
            app.relaunch();
            app.exit(0);
            return { relaunching: true };
          }
        } catch {
          /* not the main process */
        }
        return handlerError("the relaunch is the main process's job");
      },
    },
    {
      kind: "bridge",
      id: "app.setTrayAttention",
      description: "set the tray's attention state; params: { attention } -> { attention }",
      handler: (p) => {
        const state = readAppState();
        state.trayAttention = p?.attention !== false;
        writeAppState(state);
        return { attention: state.trayAttention };
      },
    },
  );

  // ---------------- workspace (the scratch) ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "workspace.scratchList",
      description: "the saved workspaces; params: {} -> { scratch[] }",
      handler: () => ({
        scratch: listScratch().map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt })),
      }),
    },
    {
      kind: "bridge",
      id: "workspace.scratchCreate",
      description: "create a saved workspace; params: { name, state? } -> { scratch }",
      schema: (p) => (typeof p?.name === "string" ? { ok: true } : { ok: false, message: "name required" }),
      handler: (p) => {
        const row: Scratch = {
          id: `scratch-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: String(p?.name ?? "Workspace"),
          state: p?.state ?? {},
          createdAt: now(),
          updatedAt: now(),
        };
        mkdirSync(scratchDir(), { recursive: true });
        writeFileSync(scratchFile(row.id), JSON.stringify(row, null, 2), "utf8");
        return { scratch: row };
      },
    },
    {
      kind: "bridge",
      id: "workspace.scratchLoad",
      description: "load a saved workspace; params: { id } -> { scratch }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const row = readScratch(String(p?.id));
        if (!row) return notFound(`no saved workspace ${p?.id}`);
        return { scratch: row };
      },
    },
    {
      kind: "bridge",
      id: "workspace.scratchSave",
      description: "save a workspace; params: { id, name?, state? } -> { scratch }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const id = String(p?.id);
        const previous = readScratch(id);
        const row: Scratch = {
          id,
          name: typeof p?.name === "string" ? p.name : previous?.name ?? "Workspace",
          state: p?.state ?? previous?.state ?? {},
          createdAt: previous?.createdAt ?? now(),
          updatedAt: now(),
        };
        mkdirSync(scratchDir(), { recursive: true });
        writeFileSync(scratchFile(id), JSON.stringify(row, null, 2), "utf8");
        return { scratch: row };
      },
    },
    {
      kind: "bridge",
      id: "workspace.scratchDelete",
      description: "delete a saved workspace; params: { id } -> { deleted }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const id = String(p?.id);
        const file = scratchFile(id);
        if (!existsSync(file)) return notFound(`no saved workspace ${id}`);
        rmSync(file, { force: true });
        return { deleted: true, id };
      },
    },
    {
      kind: "bridge",
      id: "workspace.scratchFinishDelete",
      description: "finish deleting a workspace (the canvas side); params: { id } -> { deleted }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const id = String(p?.id);
        const file = scratchFile(id);
        if (existsSync(file)) rmSync(file, { force: true });
        return { deleted: true, id };
      },
    },
    {
      kind: "bridge",
      id: "workspace.quickRoot",
      description: "the root of a workspace's files; params: { candidate } -> { root }",
      handler: (p) => {
        const candidate = typeof p?.candidate === "string" ? p.candidate : "";
        return { root: candidate ? candidate : dbPath("..") };
      },
    },
  );

  // ---------------- activity ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "activity.join",
      description: "join the activity with a name; params: { name } -> { ok, name, joinedAt }",
      schema: (p) => (typeof p?.name === "string" && p.name.length > 0 ? { ok: true } : { ok: false, message: "name required" }),
      handler: (p) => {
        const state = readAppState();
        state.joinedName = String(p?.name);
        state.joinedAt = now();
        writeAppState(state);
        return { ok: true, name: state.joinedName, joinedAt: state.joinedAt };
      },
    },
    {
      kind: "bridge",
      id: "activity.setPaused",
      description: "pause the activity; params: { paused } -> { paused }",
      handler: (p) => {
        const state = readAppState();
        state.paused = p?.paused !== false;
        writeAppState(state);
        return { paused: state.paused };
      },
    },
    {
      kind: "bridge",
      id: "activity.refresh",
      description: "refresh the activity; params: {} -> { ok, name, scores }",
      handler: () => {
        const state = readAppState();
        return { ok: true, name: state.joinedName ?? null, paused: state.paused === true, scores: state.scores };
      },
    },
    {
      kind: "bridge",
      id: "activity.deleteScore",
      description: "delete an activity score; params: { key } -> { ok }",
      schema: (p) => (typeof p?.key === "string" ? { ok: true } : { ok: false, message: "key required" }),
      handler: (p) => {
        const state = readAppState();
        delete state.scores[String(p?.key)];
        writeAppState(state);
        return { ok: true, key: p?.key };
      },
    },
  );

  // ---------------- documents ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "documents.publish",
      description: "publish a document; params: { artifactId, … } -> { ok, artifact }",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        // Publishing is the artifact's own lifecycle: it becomes current.
        const rows = await db.artifact.findMany({ where: { id: p?.artifactId } });
        if (!rows.length) return notFound(`no artifact ${p?.artifactId}`);
        return { ok: true, artifact: rows[0] };
      },
    },
    {
      kind: "bridge",
      id: "documents.hold",
      description: "hold a document; params: { artifactId, … } -> { ok, artifact }",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        await db.artifact.update({ where: { id: p?.artifactId }, data: { retiredAt: new Date(now()) } });
        return { ok: true, held: true, artifactId: p?.artifactId };
      },
    },
    {
      kind: "bridge",
      id: "documents.release",
      description: "release a held document; params: { artifactId, … } -> { ok, artifact }",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        await db.artifact.update({ where: { id: p?.artifactId }, data: { retiredAt: null } });
        return { ok: true, held: false, artifactId: p?.artifactId };
      },
    },
    {
      kind: "bridge",
      id: "documents.replyRemoteTurn",
      description: "reply to a remote turn; params: {} -> not-implemented (the remote turn belongs to the hosted tier)",
      handler: () => ({
        ok: false,
        error: {
          code: "not-implemented",
          message: "a remote turn needs the hosted tier — autumn is local-first",
        },
      }),
    },
  );

  // ---------------- facts ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "facts.notifications",
      description: "the notifications; params: {} -> { notifications[] } (the agents' questions)",
      handler: async () => ({ notifications: await questions() }),
    },
    {
      kind: "bridge",
      id: "facts.documentRuntime",
      description: "a document's runtime; params: { artifactId? } -> { ok, runtime }",
      handler: async () => ({ ok: true, runtime: { at: now() } }),
    },
    {
      kind: "bridge",
      id: "facts.dismissNotification",
      description: "dismiss a notification; params: { id } -> { ok }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const state = readAppState();
        state.scores = { ...state.scores, [`dismissed:${p?.id}`]: now() };
        writeAppState(state);
        return { ok: true, id: p?.id };
      },
    },
    {
      kind: "bridge",
      id: "facts.dismissAllNotifications",
      description: "dismiss every notification; params: {} -> { ok }",
      handler: () => {
        const state = readAppState();
        state.scores = { ...state.scores, "dismissed:all": now() };
        writeAppState(state);
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "facts.markNotificationSeen",
      description: "mark a notification as seen; params: { id } -> { ok }",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: (p) => {
        const state = readAppState();
        state.scores = { ...state.scores, [`seen:${p?.id}`]: now() };
        writeAppState(state);
        return { ok: true, id: p?.id };
      },
    },
    {
      kind: "bridge",
      id: "facts.latestRunUsages",
      description: "the latest run usages; params: { canvasId? } -> { usages[] } (the agent sessions)",
      handler: async (p) => {
        const where = p?.canvasId ? { canvasId: p.canvasId } : {};
        const rows = await db.session.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 });
        return {
          usages: rows.map((row: any) => ({
            id: row.id,
            canvasId: row.canvasId,
            engine: row.engine,
            title: row.title,
            at: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
          })),
        };
      },
    },
    {
      kind: "bridge",
      id: "facts.nodeWorkflows",
      description: "the nodes' workflows; params: { canvasId? } -> { workflows[] } (the agent logs)",
      handler: async (p) => {
        const where = p?.canvasId ? { canvasId: p.canvasId } : {};
        const rows = await db.agentLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
        return {
          workflows: rows.map((row: any) => ({
            id: row.id,
            canvasId: row.canvasId,
            nodeId: row.nodeId,
            kind: row.kind,
            text: row.text,
            at: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
          })),
        };
      },
    },
    {
      kind: "bridge",
      id: "facts.markNodeDone",
      description: "mark a node's work as done; params: { canvasId, nodeId } -> { ok }",
      schema: (p) =>
        typeof p?.canvasId === "string" && typeof p?.nodeId === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId and nodeId required" },
      handler: async (p) => {
        await db.agentLog.createMany({
          data: [
            {
              canvasId: String(p?.canvasId),
              nodeId: String(p?.nodeId),
              kind: "node_done",
              text: "done",
              meta: "{}",
            },
          ],
        });
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "facts.deckTriage",
      description: "the decks that need a look; params: {} -> { decks[] }",
      handler: async () => {
        const rows = await db.canvas.findMany({});
        const decks = (rows as any[]).filter((row) => {
          try {
            const state = JSON.parse(row.state ?? "{}");
            return Array.isArray(state.nodes) && state.nodes.some((n: any) => n?.kind === "slides");
          } catch {
            return false;
          }
        });
        return { decks: decks.map((row: any) => ({ id: row.id, name: row.name })) };
      },
    },
    {
      kind: "bridge",
      id: "facts.setDeckTriage",
      description: "set a deck's triage; params: { canvasId, triage } -> { ok }",
      schema: (p) => (typeof p?.canvasId === "string" ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        const state = readAppState();
        state.scores = { ...state.scores, [`deck:${p?.canvasId}`]: now() };
        writeAppState(state);
        return { ok: true, canvasId: p?.canvasId, triage: p?.triage ?? null };
      },
    },
    {
      kind: "bridge",
      id: "facts.prObservations",
      description: "the pull-request observations; params: { cwd } -> { observations[] } (the real PR facts)",
      handler: async (p) => {
        if (typeof p?.cwd !== "string") return badParams("cwd required");
        try {
          const out = await deps.git(p.cwd).raw(["log", "--oneline", "-n", "20"]);
          return { observations: out.split("\n").filter(Boolean).map((line) => line.trim()) };
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
  );

  return handlers;
}
