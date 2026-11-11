// autumn — Wave-2 handlers: browser (11 dispatchable + browser.onActivity /
// browser.onPresentationStopped pushes; doc 32 §2e).
//
// RE-derived (October app.asar out/preload/index.js + out/main/index.js):
//   register(canvasId, nodeId, webContentsId, document) / unregister(...) — positional
//   setLinks(canvasId, pairs, document, opts{waitMs}) — positional
//   present(canvasId, cloudCanvasId, nodeId, enabled) — positional boolean gate;
//     RE throws "Choose whether to present this browser." when enabled isn't a boolean
//   capture(canvasId, nodeId, destDir, options) — positional; returns the saved path
//     (renderer treats a falsy result as "capture failed" — we return null when no
//     view exists rather than a truthy object, so the ported renderer can't lie)
//   history(document, canvasId, nodeId, prefix) — prefix must be a string ≤256 chars
//     (RE: "Invalid history query."), newest-first per-partition list (cap 500)
//   profiles / downloads / import / workspacePreview — nested objects in the target
//     preload (profiles.list/create/rename, downloads.pickDir/resetDir,
//     import.sources/run/cancel/restart, workspacePreview.request/release/session);
//     autumn's manifest carries them as ONE flat id each, so the sub-action rides
//     in as {action:"..."} (paramsOf also accepts positional).
//
// autumn adaptation (doc 32 §2e): handlers own the STATE FILES under
// <userData>/browser/ (profiles/history/downloads/links/views/preview JSON);
// the WebContentsView / BrowserWindow PLUMBING is attached when a real
// webContents is registered or the Electron runtime is present, and every
// view/window-dependent op reports an honest {supported:false} (or null for
// capture) when it isn't — headless tests never fake a browser.
//
// Events fire only on REAL triggers: browser.onActivity on a registered
// webContents' did-navigate (integration path == test seam path), and
// browser.onPresentationStopped when a presented window actually closes/stops.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { loadJson, saveJson, userDataDir } from "./store";
import { paramsOf, str, ostr, pick, lazyElectron } from "./params";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

const HISTORY_CAP = 500;
const DEFAULT_PARTITION = "partition-default";

interface Profile {
  id: string;
  name: string;
  partition: string;
  createdAt: number;
}
interface HistoryEntry {
  url: string;
  title?: string;
  ts: number;
}
interface DownloadRecord {
  id: string;
  name: string;
  path?: string;
  bytes?: number;
  url?: string;
  state: string;
  ts: number;
}
interface ViewRecord {
  canvasId: string;
  nodeId: string;
  webContentsId?: number;
  document?: string;
  registeredAt: number;
}

const browserDir = () => join(userDataDir(), "browser");
const profilesFile = () => join(browserDir(), "profiles.json");
const historyFile = () => join(browserDir(), "history.json");
const downloadsFile = () => join(browserDir(), "downloads.json");
const linksFile = () => join(browserDir(), "links.json");
const viewsFile = () => join(browserDir(), "views.json");
const previewFile = () => join(browserDir(), "preview.json");
const downloadsDirFile = () => join(browserDir(), "downloads-dir.json");

/** saveJson + dir ensure — browser state files live in their own subdir. */
function save(file: string, data: unknown): void {
  mkdirSync(browserDir(), { recursive: true });
  saveJson(file, data);
}

function readProfiles(): Profile[] {
  const raw = loadJson<{ profiles: Profile[] }>(profilesFile(), { profiles: [] });
  const list = Array.isArray(raw.profiles) ? raw.profiles : [];
  if (!list.some((p) => p.id === "default")) {
    list.unshift({ id: "default", name: "Default", partition: DEFAULT_PARTITION, createdAt: Date.now() });
    save(profilesFile(), { profiles: list });
    return list;
  }
  return list;
}
function writeProfiles(list: Profile[]): void {
  save(profilesFile(), { profiles: list });
}
type HistoryStore = Record<string, HistoryEntry[]>;
function readHistory(): HistoryStore {
  const h = loadJson<HistoryStore>(historyFile(), {});
  return h && typeof h === "object" ? h : {};
}
function writeHistory(h: HistoryStore): void {
  save(historyFile(), h);
}
function readDownloads(): DownloadRecord[] {
  const raw = loadJson<{ downloads: DownloadRecord[] }>(downloadsFile(), { downloads: [] });
  return Array.isArray(raw.downloads) ? raw.downloads : [];
}
function writeDownloads(list: DownloadRecord[]): void {
  save(downloadsFile(), { downloads: list });
}
function readViews(): ViewRecord[] {
  const raw = loadJson<{ views: ViewRecord[] }>(viewsFile(), { views: [] });
  return Array.isArray(raw.views) ? raw.views : [];
}
function writeViews(list: ViewRecord[]): void {
  save(viewsFile(), { views: list });
}

function partitionOf(profileId?: string): string {
  const p = readProfiles().find((x) => x.id === profileId);
  return p?.partition ?? DEFAULT_PARTITION;
}

function appendHistory(partition: string, url: string, title?: string): void {
  const h = readHistory();
  const list = h[partition] ?? [];
  list.unshift({ url, ...(title ? { title } : {}), ts: Date.now() });
  h[partition] = list.slice(0, HISTORY_CAP);
  writeHistory(h);
}

/**
 * The single real activity path: append history + emit browser.onActivity.
 * The registered webContents' did-navigate listener and the `_noteActivity`
 * test/integration seam are the SAME function, so an emitted event always
 * corresponds to a real navigation observation.
 */
function noteActivity(deps: { emit: (id: string, payload: unknown) => void }, entry: {
  canvasId?: string;
  nodeId?: string;
  partition?: string;
  url: string;
  title?: string;
}): void {
  const partition = entry.partition ?? DEFAULT_PARTITION;
  appendHistory(partition, entry.url, entry.title);
  deps.emit("browser.onActivity", {
    canvasId: entry.canvasId ?? null,
    nodeId: entry.nodeId ?? null,
    partition,
    url: entry.url,
    ts: Date.now(),
  });
}

/** Presented standalone windows, keyed by window id (integration + stop path). */
const presented = new Map<number, { url: string; win: any }>();

export function makeBrowserHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit } = deps;

  const handlers: RegisteredHandler[] = [
    // ----- view registry ------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.register",
      description:
        "register a canvas browser view; params: {canvasId, nodeId, webContentsId?, document?} (RE positional) -> {registered, views} — attaches a REAL did-navigate listener when the webContents exists",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return (ostr(obj, "canvasId") ?? pos[0]) && (ostr(obj, "nodeId") ?? pos[1])
          ? { ok: true }
          : { ok: false, message: "canvasId and nodeId required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        // RE positional: (canvasId, nodeId, webContentsId, document).
        const canvasId = ostr(obj, "canvasId") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const nodeId = ostr(obj, "nodeId") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        if (!canvasId || !nodeId) return badParams("canvasId and nodeId required");
        const wcRaw = pick(obj, pos, "webContentsId", 2);
        const document = ostr(obj, "document") ?? (typeof pos[3] === "string" ? pos[3] : undefined);
        const list = readViews().filter((v) => !(v.canvasId === canvasId && v.nodeId === nodeId));
        const rec: ViewRecord = {
          canvasId,
          nodeId,
          ...(typeof wcRaw === "number" ? { webContentsId: wcRaw } : {}),
          ...(document !== undefined ? { document } : {}),
          registeredAt: Date.now(),
        };
        list.push(rec);
        writeViews(list);

        // Real wiring when Electron + the webContents are available: navigating
        // the registered view appends history and emits browser.onActivity.
        const electron = lazyElectron();
        if (electron && typeof rec.webContentsId === "number" && typeof electron.webContents?.fromId === "function") {
          try {
            const wc = electron.webContents.fromId(rec.webContentsId);
            if (wc && typeof wc.on === "function") {
              wc.on("did-navigate", (_e: unknown, url: string) => {
                noteActivity({ emit }, { canvasId, nodeId, url });
              });
            }
          } catch {
            /* view already gone — registration state is still truthful */
          }
        }
        return { registered: true, views: list.length };
      },
    },
    {
      kind: "bridge",
      id: "browser.unregister",
      description:
        "unregister a canvas browser view; params: {canvasId, nodeId, webContentsId?} -> {unregistered, views}",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return (ostr(obj, "canvasId") ?? pos[0]) && (ostr(obj, "nodeId") ?? pos[1])
          ? { ok: true }
          : { ok: false, message: "canvasId and nodeId required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const canvasId = ostr(obj, "canvasId") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const nodeId = ostr(obj, "nodeId") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        if (!canvasId || !nodeId) return badParams("canvasId and nodeId required");
        const list = readViews();
        const next = list.filter((v) => !(v.canvasId === canvasId && v.nodeId === nodeId));
        writeViews(next);
        return { unregistered: next.length < list.length, views: next.length };
      },
    },

    // ----- profiles -----------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.profiles",
      description:
        "browser profiles; params: {} or {action:'list'} -> [{id,name,partition,...}] | {action:'create', name} / {action:'rename', id, name} / {action:'remove', id} — persisted partitions (doc 32 §2e)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "list";
        const list = readProfiles();
        if (action === "list") return list;
        if (action === "create") {
          const name = ostr(obj, "name") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (!name) return badParams("name required for profiles.create");
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "profile";
          const id = `p-${slug}-${Math.random().toString(36).slice(2, 8)}`;
          const profile: Profile = { id, name, partition: `partition-${slug}-${id.slice(-4)}`, createdAt: Date.now() };
          list.push(profile);
          writeProfiles(list);
          return profile;
        }
        if (action === "rename") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          const name = ostr(obj, "name") ?? (typeof pos[2] === "string" ? pos[2] : undefined);
          if (!id || !name) return badParams("id and name required for profiles.rename");
          const p = list.find((x) => x.id === id);
          if (!p) return notFound(`no profile ${id}`);
          p.name = name;
          writeProfiles(list);
          return p;
        }
        if (action === "remove") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (!id) return badParams("id required for profiles.remove");
          if (id === "default") return badParams("the default profile cannot be removed");
          const next = list.filter((x) => x.id !== id);
          if (next.length === list.length) return notFound(`no profile ${id}`);
          writeProfiles(next);
          return { removed: true, id };
        }
        return badParams(`unknown profiles action: ${action}`);
      },
    },

    // ----- history ------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.history",
      description:
        "query page history; params: {action:'query', prefix?, profileId?, limit?} or positional prefix (RE (document, canvas, node, prefix); prefix string ≤256) -> newest-first entries (cap 500); {action:'clear'} wipes the partition",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "query";
        if (action === "clear") {
          const h = readHistory();
          const partition = partitionOf(ostr(obj, "profileId", "partition"));
          const n = (h[partition] ?? []).length;
          delete h[partition];
          writeHistory(h);
          return { cleared: n };
        }
        if (action !== "query") return badParams(`unknown history action: ${action}`);
        // RE positional prefix sits last: (document, canvasId, nodeId, prefix).
        const prefix = obj.prefix !== undefined ? obj.prefix : pos.length ? pos[pos.length - 1] : undefined;
        if (prefix !== undefined && (typeof prefix !== "string" || prefix.length > 256)) {
          return badParams("Invalid history query.");
        }
        const partition = partitionOf(ostr(obj, "profileId", "partition"));
        let entries = readHistory()[partition] ?? [];
        if (typeof prefix === "string" && prefix.length) entries = entries.filter((e) => e.url.startsWith(prefix));
        const limit = typeof obj.limit === "number" && obj.limit >= 0 ? obj.limit : entries.length;
        return entries.slice(0, limit);
      },
    },

    // ----- downloads ----------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.downloads",
      description:
        "downloads; params: {} or {action:'list'} -> records (newest-first) | {action:'pickDir'} -> choose the download dir (Electron dialog; {supported:false} headless) | {action:'resetDir'} -> {dir:null, reset:true}",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "list";
        if (action === "list") return readDownloads();
        if (action === "pickDir") {
          const electron = lazyElectron();
          const dialog = electron?.dialog;
          if (!dialog?.showOpenDialog) return { supported: false, reason: "the download-folder picker needs the Autumn window (Electron runtime)" };
          const res = await dialog.showOpenDialog({ title: "Choose download folder", properties: ["openDirectory"] });
          if (res.canceled || !res.filePaths?.length) return { dir: null, canceled: true };
          save(downloadsDirFile(), { dir: res.filePaths[0] });
          return { dir: res.filePaths[0] };
        }
        if (action === "resetDir") {
          save(downloadsDirFile(), { dir: null });
          return { dir: null, reset: true };
        }
        return badParams(`unknown downloads action: ${action}`);
      },
    },

    // ----- import -------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.import",
      description:
        "import browser data; params: {action:'cookies', profileId?} -> {cookies:[...]} (real ses.cookies read; {supported:false} without the Electron session) | {action:'sources'|'run'|'cancel'} -> {supported:false, reason} until the browser integration lands (doc 32 §W2-8)",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "cookies";
        const electron = lazyElectron();
        if (action === "cookies") {
          const ses = electron?.session?.fromPartition?.(partitionOf(ostr(obj, "profileId", "partition")));
          if (!ses?.cookies?.get) return { supported: false, reason: "session cookies need the Electron runtime" };
          const cookies = await ses.cookies.get({});
          return { cookies: cookies.map((c: any) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, secure: c.secure, httpOnly: c.httpOnly })) };
        }
        if (action === "sources" || action === "run" || action === "cancel") {
          return { supported: false, reason: `browser ${action} ships with the browser integration (doc 32 §W2-8)` };
        }
        return badParams(`unknown import action: ${action}`);
      },
    },

    // ----- links --------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.setLinks",
      description:
        "set the popup/external link policy for a view; params: {allowlist:[string|{pattern}] , profileId?} or RE positional (canvasId, pairs, ...) -> {links, applied} — persisted; applied to a registered webContents when one exists",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        const allowlist = obj.allowlist ?? pos[1];
        return Array.isArray(allowlist) ? { ok: true } : { ok: false, message: "allowlist (array) required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const raw = (obj.allowlist ?? pos[1]) as unknown[];
        const allowlist: string[] = [];
        for (const item of raw) {
          if (typeof item === "string") allowlist.push(item);
          else if (item && typeof item === "object") {
            const pattern = (item as Record<string, unknown>).pattern ?? (item as Record<string, unknown>).url;
            if (typeof pattern === "string") allowlist.push(pattern);
            else return badParams("allowlist entries must be strings or {pattern}");
          } else return badParams("allowlist entries must be strings or {pattern}");
        }
        save(linksFile(), { allowlist, updatedAt: Date.now() });

        // Real application when a registered view has a live webContents.
        let applied = 0;
        const electron = lazyElectron();
        const view = readViews()[0];
        if (electron && view && typeof view.webContentsId === "number") {
          try {
            const wc = electron.webContents?.fromId?.(view.webContentsId);
            if (wc && typeof wc.setWindowOpenHandler === "function") {
              wc.setWindowOpenHandler(({ url }: { url: string }) =>
                allowlist.some((pattern) => matchPattern(pattern, url)) ? { action: "allow" } : { action: "deny" },
              );
              applied = 1;
            }
          } catch {
            /* view gone */
          }
        }
        return { links: allowlist.length, allowlist, applied };
      },
    },

    // ----- clear data ---------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.clearData",
      description:
        "clear browser state; params: {profileId?} (RE positional node identity) -> {cleared, history, storage} — real history wipe always; session storage only with the Electron session",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const partition = partitionOf(ostr(obj, "profileId", "partition"));
        const h = readHistory();
        const n = (h[partition] ?? []).length;
        delete h[partition];
        writeHistory(h);
        let storage = false;
        const ses = lazyElectron()?.session?.fromPartition?.(partition);
        if (ses?.clearStorageData) {
          await ses.clearStorageData();
          storage = true;
        }
        return { cleared: true, history: n, storage };
      },
    },

    // ----- capture ------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.capture",
      description:
        "screenshot a registered browser view; params: {nodeId|canvasId, destDir} or RE positional (canvasId, nodeId, destDir, options) / renderer (id, dest) -> {path, bytes} | null when no live view exists (renderer treats null as capture-failed — honest)",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        // Renderer calls capture(id, dest): two positional strings where the
        // LAST is the destination. RE's own shape is (canvasId, nodeId, destDir,
        // options) — also last-is-destination, first-is-the-view-key. Object
        // callers pass named fields (ostr — never scan past the first pos).
        const strings = pos.filter((x): x is string => typeof x === "string");
        let destDir = ostr(obj, "destDir", "dest");
        if (destDir === undefined && strings.length >= 2) destDir = strings[strings.length - 1];
        const key = ostr(obj, "nodeId", "canvasId", "id");
        const matchKey = key ?? (strings.length >= 1 ? strings[0] : undefined);
        if (!destDir) return badParams("destDir required");
        const view = readViews().find((v) => v.nodeId === matchKey || v.canvasId === matchKey);
        const wc = view && typeof view.webContentsId === "number" ? lazyElectron()?.webContents?.fromId?.(view.webContentsId) : null;
        if (!wc || typeof wc.capturePage !== "function") return null; // nothing captured — falsy = honest failure for the ported renderer
        try {
          const image = await wc.capturePage();
          const bytes: Buffer = typeof image.toPNG === "function" ? image.toPNG() : Buffer.alloc(0);
          mkdirSync(destDir, { recursive: true });
          const file = join(destDir, `capture-${Date.now()}.png`);
          writeFileSync(file, bytes);
          return { path: file, bytes: bytes.byteLength };
        } catch {
          return null;
        }
      },
    },

    // ----- present ------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.present",
      description:
        "present a browser in a standalone window; params: {url} -> {presented, url} (window close emits browser.onPresentationStopped) | {enabled:false}/'stop' -> stop; RE positional enabled gate honored (non-bool -> bad-params 'Choose whether to present this browser.'); {supported:false} headless",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const enabled = pick(obj, pos, "enabled", 3);
        const url = ostr(obj, "url");
        const stop = obj.action === "stop" || enabled === false;
        if (stop) {
          let stopped = 0;
          for (const [, entry] of [...presented]) {
            try {
              entry.win?.close?.();
            } catch {
              /* already gone */
            }
            presented.delete(entry.win?.id ?? -1);
            stopped++;
          }
          if (stopped > 0) emit("browser.onPresentationStopped", { reason: "stopped", ts: Date.now() });
          return { presented: false, stopped };
        }
        if (enabled !== undefined && enabled !== true && enabled !== false) {
          return badParams("Choose whether to present this browser.");
        }
        if (enabled === true && !url) return badParams("autumn presents an explicit url — pass {url}");
        const electron = lazyElectron();
        const BrowserWindow = electron?.BrowserWindow;
        if (!url) return badParams("url required to present");
        if (!BrowserWindow) return { supported: false, reason: "standalone presentation windows need the Electron runtime" };
        try {
          const win = new BrowserWindow({
            width: 1100,
            height: 760,
            title: "Autumn — presenting",
            webPreferences: { partition: partitionOf(ostr(obj, "profileId", "partition")) },
          });
          win.loadURL(url);
          const id = typeof win.id === "number" ? win.id : presented.size + 1;
          presented.set(id, { url, win });
          win.on?.("closed", () => {
            if (presented.delete(id)) emit("browser.onPresentationStopped", { reason: "closed", url, ts: Date.now() });
          });
          return { presented: true, url };
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },

    // ----- workspace preview --------------------------------------------------
    {
      kind: "bridge",
      id: "browser.workspacePreview",
      description:
        "dock a browser preview in the Autumn window; params: {url?, dock?} or RE positional (document, canvasId, nodeId, root, path) -> {opened, url, bounds} | {supported:false, reason} without the Electron runtime (view plumbing is integration's — doc 32 §2e)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const url = ostr(obj, "url") ?? "about:blank";
        const dock = ostr(obj, "dock") ?? "right";
        const electron = lazyElectron();
        const BrowserWindow = electron?.BrowserWindow;
        if (!BrowserWindow || !electron?.WebContentsView) {
          return { supported: false, reason: "workspace previews need the Autumn window (Electron runtime)" };
        }
        try {
          const win = BrowserWindow.getAllWindows?.()?.[0];
          if (!win) return { supported: false, reason: "no Autumn window is open" };
          const view = new electron.WebContentsView({ webPreferences: { partition: partitionOf(ostr(obj, "profileId", "partition")) } });
          win.contentView?.addChildView?.(view);
          const area = win.getBounds?.() ?? { width: 1280, height: 800 };
          const width = Math.round(area.width * 0.45);
          const bounds =
            dock === "bottom"
              ? { x: 0, y: Math.round(area.height * 0.55), width: area.width, height: Math.round(area.height * 0.45) }
              : { x: area.width - width, y: 0, width, height: area.height };
          view.setBounds?.(bounds);
          view.webContents?.loadURL?.(url);
          save(previewFile(), { url, dock, bounds, at: Date.now() });
          return { opened: true, url, dock, bounds };
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },
  ];

  return handlers;
}

/** Glob-ish pattern match used by setLinks (scheme://host/* or *host*). */
function matchPattern(pattern: string, url: string): boolean {
  if (pattern === "*") return true;
  try {
    const p = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${p}$`).test(url);
  } catch {
    return url.startsWith(pattern);
  }
}

/** Test/integration seams — the same functions the real wiring uses. */
export function _noteActivity(emit: (id: string, payload: unknown) => void, entry: Parameters<typeof noteActivity>[1]): void {
  noteActivity({ emit }, entry);
}
export function _appendHistory(partition: string, url: string, title?: string): void {
  mkdirSync(browserDir(), { recursive: true });
  appendHistory(partition, url, title);
}
export function _recordDownload(rec: Omit<DownloadRecord, "id" | "ts"> & { ts?: number }): void {
  mkdirSync(browserDir(), { recursive: true });
  const list = readDownloads();
  list.unshift({ id: `dl-${Date.now().toString(36)}-${list.length}`, ts: rec.ts ?? Date.now(), ...rec } as DownloadRecord);
  save(downloadsFile(), { downloads: list.slice(0, 500) });
}
export function _browserDir(): string {
  return browserDir();
}
