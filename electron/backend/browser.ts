// autumn — Wave-2 handlers: browser (11 dispatchable + browser.onActivity /
// browser.onPresentationStopped pushes; doc 32 §2e) — FULL (W2-8).
//
// RE-derived (October out/preload/index.js + out/main/index.js):
//   register(canvasId, nodeId, webContentsId, document)   — positional
//   unregister(canvasId, nodeId, webContentsId)            — positional
//   setLinks(canvasId, pairs, document, opts{waitMs})      — pairs = [pattern, browserId]
//   present(canvasId, cloudCanvasId, nodeId, enabled)      — positional boolean gate
//   capture(canvasId, nodeId, destDir, options)            — positional
//   history.query(document, canvasId, nodeId, prefix)       — prefix must be a string ≤256
//   history.clear(id)                                      — id = a profile id
//   profiles.{list,resolve,create,rename,duplicate,clear,delete,setAgentAccess,
//             bind,discardUnrecoverable}
//   downloads.{pickDir,resetDir}
//   import.{sources,run,cancel,restart}  (+ browser:import:progress)
//   workspacePreview.{request,release,session}
//   clearData(document, canvasId, nodeId)
//   events: browser:profiles:changed, browser:import:progress,
//           browser-activity, browser-presentation-stopped
//
// autumn design (doc 32 §2e) — a LOCAL-FIRST browser pane:
//   * profiles are REAL Electron session partitions (`persist:autumn-bp-<uuid>`)
//     with an agent-access policy (allowed|ask|blocked, the RE's RANK order),
//     per-profile history/download state, and node↔profile bindings;
//   * the state lives under <userData>/browser/ (profiles.json, history.json,
//     downloads.json, links.json, views.json, preview.json);
//   * every Electron-dependent op (view plumbing, capture, cookies, storage)
//     is wired for the REAL runtime and answers an honest {supported:false}
//     when the runtime is absent — headless tests never fake a browser;
//   * events fire only on REAL triggers: browser.onActivity on a registered
//     webContents' did-navigate, browser.onPresentationStopped when a
//     presented window really closes.
//
// Deviations from the target (documented, not silent):
//   * partition/profile naming uses `autumn`, never `october`;
//   * importing credentials straight out of Chrome/Edge/Safari needs the OS
//     keychain, which autumn does not take — `import.sources` DETECTS the
//     installed browsers for real, `import.run` really imports a cookie file
//     the user picks (Netscape cookies.txt / JSON), and the "read the
//     browser's own encrypted store" path answers an honest {supported:false};
//   * the target's flat preload ids map onto autumn's flat manifest ids with
//     an `action` parameter (same convention as the other namespaces).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

const HISTORY_CAP = 500;
/** The default (embedded) profile's partition — the RE's LEGACY_PARTITION. */
const DEFAULT_PARTITION = "persist:autumn-embedded";
const PROFILE_PARTITION_PREFIX = "persist:autumn-bp-";
const DEFAULT_PROFILE_ID = "default";
const MAX_PROFILE_NAME = 64;

/** RE agent-access ladder (most restrictive wins): allowed < ask < blocked. */
type AgentAccess = "allowed" | "ask" | "blocked";
const ACCESS_RANK: Record<AgentAccess, number> = { allowed: 0, ask: 1, blocked: 2 };

interface Profile {
  id: string;
  name: string;
  partition: string;
  agentAccess: AgentAccess;
  createdAt: number;
  /** Set when credentials were imported into this profile. */
  imported?: { source: string; credentials: boolean; via: string; at: number };
}
interface Binding {
  canvasId: string;
  nodeId: string;
  profileId: string;
}
interface ProfileStore {
  version: number;
  profiles: Profile[];
  bindings: Binding[];
}
interface HistoryEntry {
  url: string;
  title?: string;
  ts: number;
}
type HistoryStore = Record<string, HistoryEntry[]>;
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
  profileId?: string;
  registeredAt: number;
}
interface LinkRule {
  pattern: string;
  browserId?: string;
}

const browserDir = () => join(userDataDir(), "browser");
const profilesFile = () => join(browserDir(), "profiles.json");
const historyFile = () => join(browserDir(), "history.json");
const downloadsFile = () => join(browserDir(), "downloads.json");
const linksFile = () => join(browserDir(), "links.json");
const viewsFile = () => join(browserDir(), "views.json");
const previewFile = () => join(browserDir(), "preview.json");
const downloadsDirFile = () => join(browserDir(), "downloads-dir.json");
const cookieImportsFile = () => join(browserDir(), "cookie-imports.json");

/** saveJson + dir ensure — browser state files live in their own subdir. */
function save(file: string, data: unknown): void {
  mkdirSync(browserDir(), { recursive: true });
  saveJson(file, data);
}

// ---------------------------------------------------------------------------
// profile store
// ---------------------------------------------------------------------------

function defaultProfile(): Profile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: "Default",
    partition: DEFAULT_PARTITION,
    agentAccess: "allowed",
    createdAt: Date.now(),
  };
}

function readProfileStore(): ProfileStore {
  const raw = loadJson<ProfileStore>(profilesFile(), { version: 1, profiles: [], bindings: [] });
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const bindings = Array.isArray(raw.bindings) ? raw.bindings : [];
  if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) {
    profiles.unshift(defaultProfile());
    save(profilesFile(), { version: 1, profiles, bindings });
  }
  return { version: raw.version ?? 1, profiles, bindings };
}
function writeProfileStore(store: ProfileStore): void {
  save(profilesFile(), store);
}

/** The public profile shape (what the UI renders). */
function profileView(p: Profile, store: ProfileStore): Record<string, unknown> {
  const bound = store.bindings.filter((b) => b.profileId === p.id).length;
  return {
    id: p.id,
    name: p.name,
    partition: p.partition,
    agentAccess: p.agentAccess,
    createdAt: p.createdAt,
    boundNodes: bound,
    hasImportedCredentials: p.imported?.credentials === true,
    imported: p.imported ?? null,
    /** A profile whose partition directory vanished cannot be used any more. */
    recoverable: existsSync(join(browserDir(), "partitions", p.id)),
  };
}

function findProfile(store: ProfileStore, id: string): Profile | undefined {
  return store.profiles.find((p) => p.id === id);
}
function partitionFor(p: Profile): string {
  return p.partition;
}
function partitionOfProfileId(profileId?: string): string {
  const store = readProfileStore();
  const p = profileId ? findProfile(store, profileId) : undefined;
  return partitionFor(p ?? defaultProfile());
}

// ---------------------------------------------------------------------------
// history / downloads / views / links
// ---------------------------------------------------------------------------

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
function readLinks(): LinkRule[] {
  const raw = loadJson<{ rules: LinkRule[] }>(linksFile(), { rules: [] });
  return Array.isArray(raw.rules) ? raw.rules : [];
}
function writeLinks(rules: LinkRule[]): void {
  save(linksFile(), { rules });
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

// ---------------------------------------------------------------------------
// import sources (real detection of installed browsers)
// ---------------------------------------------------------------------------

interface ImportSource {
  id: string;
  name: string;
  root: string;
  kind: string;
}

/** Known browser profile roots per platform (RE has the same idea). */
function knownBrowserRoots(): ImportSource[] {
  const home = homedir();
  const p = platform();
  const out: ImportSource[] = [];
  const push = (id: string, name: string, kind: string, root: string) => {
    if (root) out.push({ id, name, kind, root });
  };
  if (p === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const roaming = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    push("chrome", "Google Chrome", "chromium", join(local, "Google", "Chrome", "User Data"));
    push("edge", "Microsoft Edge", "chromium", join(local, "Microsoft", "Edge", "User Data"));
    push("brave", "Brave", "chromium", join(local, "BraveSoftware", "Brave-Browser", "User Data"));
    push("firefox", "Firefox", "firefox", join(roaming, "Mozilla", "Firefox", "Profiles"));
  } else if (p === "darwin") {
    const support = join(home, "Library", "Application Support");
    push("chrome", "Google Chrome", "chromium", join(support, "Google", "Chrome"));
    push("edge", "Microsoft Edge", "chromium", join(support, "Microsoft", "Edge"));
    push("brave", "Brave", "chromium", join(support, "BraveSoftware", "Brave-Browser"));
    push("firefox", "Firefox", "firefox", join(support, "Firefox", "Profiles"));
    push("safari", "Safari", "safari", join(home, "Library", "Cookies", "Cookies.binarycookies"));
  } else {
    const config = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
    push("chrome", "Google Chrome", "chromium", join(config, "google-chrome"));
    push("chromium", "Chromium", "chromium", join(config, "chromium"));
    push("brave", "Brave", "chromium", join(config, "BraveSoftware", "Brave-Browser"));
    push("firefox", "Firefox", "firefox", join(home, ".mozilla", "firefox"));
  }
  return out;
}

/** The cookie-file import (Netscape cookies.txt / JSON) — really parsed. */
function parseCookieFile(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      for (const c of list) {
        if (!c || typeof c !== "object") continue;
        const name = (c as Record<string, unknown>).name;
        const value = (c as Record<string, unknown>).value;
        if (typeof name !== "string") continue;
        out.push({
          name,
          value: typeof value === "string" ? value : "",
          domain: typeof (c as Record<string, unknown>).domain === "string" ? (c as Record<string, unknown>).domain : undefined,
          path: typeof (c as Record<string, unknown>).path === "string" ? (c as Record<string, unknown>).path : "/",
          secure: (c as Record<string, unknown>).secure === true,
          httpOnly: (c as Record<string, unknown>).httpOnly === true,
          expires: typeof (c as Record<string, unknown>).expires === "number" ? (c as Record<string, unknown>).expires : undefined,
        });
      }
      return out;
    } catch {
      return [];
    }
  }
  // Netscape cookies.txt: domain \t includeSubdomains \t path \t secure \t expires \t name \t value
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expires, name, ...rest] = parts;
    if (!domain || !name) continue;
    out.push({
      name,
      value: rest.join("\t"),
      domain,
      path: path || "/",
      secure: secure.toUpperCase() === "TRUE",
      httpOnly: false,
      expires: Number(expires) || undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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

/** The Electron session for a partition — null without the runtime. */
function sessionFor(partition: string): any | null {
  return lazyElectron()?.session?.fromPartition?.(partition) ?? null;
}

export function makeBrowserHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit } = deps;

  /** Live preview leases, keyed by lease id (RE: WorkspacePreviews). */
  const previews = new Map<string, { view: any; canvasId: string; nodeId: string; partition: string }>();
  /** The live import job (one at a time, like the RE). */
  let importJob: { id: string; startedAt: number; cancelled: boolean } | null = null;

  // ----- local session helpers ------------------------------------------------

  /** Set a cookie in a partition's session — real when the runtime is present. */
  async function setCookie(partition: string, cookie: Record<string, unknown>): Promise<boolean> {
    const ses = sessionFor(partition);
    if (!ses?.cookies?.set) return false;
    const domain = typeof cookie.domain === "string" && cookie.domain ? cookie.domain : undefined;
    const url = domain ? `https://${domain.replace(/^\./, "")}/` : undefined;
    if (!url) return false;
    await ses.cookies.set({
      url,
      name: String(cookie.name),
      value: String(cookie.value ?? ""),
      path: typeof cookie.path === "string" ? cookie.path : "/",
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      ...(typeof cookie.expires === "number" ? { expirationDate: cookie.expires } : {}),
    });
    return true;
  }

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
        const store = readProfileStore();
        const bound = store.bindings.find((b) => b.canvasId === canvasId && b.nodeId === nodeId);
        const profileId = bound?.profileId ?? ostr(obj, "profileId") ?? DEFAULT_PROFILE_ID;
        const list = readViews().filter((v) => !(v.canvasId === canvasId && v.nodeId === nodeId));
        const rec: ViewRecord = {
          canvasId,
          nodeId,
          ...(typeof wcRaw === "number" ? { webContentsId: wcRaw } : {}),
          ...(document !== undefined ? { document } : {}),
          profileId,
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
              const partition = partitionOfProfileId(profileId);
              wc.on("did-navigate", (_e: unknown, url: string) => {
                noteActivity({ emit }, { canvasId, nodeId, partition, url });
              });
              wc.on("did-navigate-in-page", (_e: unknown, url: string) => {
                noteActivity({ emit }, { canvasId, nodeId, partition, url });
              });
            }
          } catch {
            /* view already gone — registration state is still truthful */
          }
        }
        return { registered: true, views: list.length, profileId };
      },
    },
    {
      kind: "bridge",
      id: "browser.unregister",
      description:
        "unregister a canvas browser view; params: {canvasId, nodeId, webContentsId?} (RE positional) -> {unregistered, views}",
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
        "browser profiles (RE profile manager); params: {} or {action:'list'} -> profile views | {action:'resolve', canvasId?, nodeId?} -> the bound profile | {action:'create', name} | {action:'rename', id, name} | {action:'duplicate', id, name?} | {action:'clear', id} | {action:'delete', id} | {action:'setAgentAccess', id, access} | {action:'bind', scope/canvasId, nodeId, id} | {action:'discardUnrecoverable'} — real session partitions (persist:autumn-bp-<uuid>)",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "list";
        const store = readProfileStore();

        if (action === "list") return store.profiles.map((p) => profileView(p, store));

        if (action === "resolve") {
          const canvasId = ostr(obj, "canvasId");
          const nodeId = ostr(obj, "nodeId");
          if (canvasId && nodeId) {
            const bound = store.bindings.find((b) => b.canvasId === canvasId && b.nodeId === nodeId);
            const p = findProfile(store, bound?.profileId ?? DEFAULT_PROFILE_ID) ?? defaultProfile();
            return profileView(p, store);
          }
          const p = findProfile(store, DEFAULT_PROFILE_ID) ?? defaultProfile();
          return profileView(p, store);
        }

        if (action === "create") {
          const name = ostr(obj, "name") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (typeof name !== "string" || !name.trim()) return badParams("name required for profiles.create");
          if (name.length > MAX_PROFILE_NAME) return badParams(`name must be at most ${MAX_PROFILE_NAME} characters`);
          const id = `bp_${randomUUID()}`;
          const profile: Profile = {
            id,
            name: name.trim(),
            partition: `${PROFILE_PARTITION_PREFIX}${id.slice(3)}`,
            agentAccess: "allowed",
            createdAt: Date.now(),
          };
          store.profiles.push(profile);
          writeProfileStore(store);
          mkdirSync(join(browserDir(), "partitions", id), { recursive: true });
          return profileView(profile, store);
        }

        if (action === "rename") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          const name = ostr(obj, "name") ?? (typeof pos[2] === "string" ? pos[2] : undefined);
          if (!id || !name) return badParams("id and name required for profiles.rename");
          if (name.length > MAX_PROFILE_NAME) return badParams(`name must be at most ${MAX_PROFILE_NAME} characters`);
          const p = findProfile(store, id);
          if (!p) return notFound(`no profile ${id}`);
          p.name = name.trim();
          writeProfileStore(store);
          return profileView(p, store);
        }

        if (action === "duplicate") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          const name = ostr(obj, "name") ?? (typeof pos[2] === "string" ? pos[2] : undefined);
          if (!id) return badParams("id required for profiles.duplicate");
          const source = findProfile(store, id);
          if (!source) return notFound(`no profile ${id}`);
          const copyId = `bp_${randomUUID()}`;
          const copy: Profile = {
            ...source,
            id: copyId,
            name: (name ?? `${source.name} copy`).trim().slice(0, MAX_PROFILE_NAME),
            partition: `${PROFILE_PARTITION_PREFIX}${copyId.slice(3)}`,
            createdAt: Date.now(),
            ...(source.imported ? { imported: { ...source.imported, credentials: false } } : {}),
          };
          store.profiles.push(copy);
          writeProfileStore(store);
          mkdirSync(join(browserDir(), "partitions", copyId), { recursive: true });
          return profileView(copy, store);
        }

        if (action === "clear") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (!id) return badParams("id required for profiles.clear");
          const p = findProfile(store, id);
          if (!p) return notFound(`no profile ${id}`);
          // Real: wipe the partition's cookies + storage when the runtime allows.
          let storage = false;
          const ses = sessionFor(partitionFor(p));
          if (ses) {
            try {
              await ses.clearStorageData?.();
              await ses.clearCache?.();
              storage = true;
            } catch {
              storage = false;
            }
          }
          const h = readHistory();
          const removed = (h[partitionFor(p)] ?? []).length;
          delete h[partitionFor(p)];
          writeHistory(h);
          // The RE keeps the imported-credential flag but drops the credentials.
          if (p.imported) p.imported = { ...p.imported, credentials: false };
          writeProfileStore(store);
          return { cleared: true, id, storage, history: removed };
        }

        if (action === "delete") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (!id) return badParams("id required for profiles.delete");
          if (id === DEFAULT_PROFILE_ID) return badParams("the default profile cannot be deleted");
          const p = findProfile(store, id);
          if (!p) return notFound(`no profile ${id}`);
          store.profiles = store.profiles.filter((x) => x.id !== id);
          store.bindings = store.bindings.filter((b) => b.profileId !== id);
          writeProfileStore(store);
          const h = readHistory();
          delete h[partitionFor(p)];
          writeHistory(h);
          return { deleted: true, id };
        }

        if (action === "setAgentAccess") {
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          const access = ostr(obj, "access") ?? (typeof pos[2] === "string" ? pos[2] : undefined);
          if (!id || !access) return badParams("id and access required for profiles.setAgentAccess");
          if (!["allowed", "ask", "blocked"].includes(access)) {
            return badParams("access must be one of allowed|ask|blocked");
          }
          const p = findProfile(store, id);
          if (!p) return notFound(`no profile ${id}`);
          // RE: loosening the policy on a profile that holds imported
          // credentials needs an explicit review.
          const loosening = ACCESS_RANK[access as AgentAccess] < ACCESS_RANK[p.agentAccess];
          const review = obj.review as { kind?: string } | undefined;
          if (loosening && p.imported?.credentials === true && review?.kind !== "native-confirm") {
            return { ok: false, error: { code: "bad-params", message: "review-required" } };
          }
          p.agentAccess = access as AgentAccess;
          writeProfileStore(store);
          return profileView(p, store);
        }

        if (action === "bind") {
          const canvasId = ostr(obj, "canvasId") ?? ostr(obj, "scope");
          const nodeId = ostr(obj, "nodeId");
          const id = ostr(obj, "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
          if (!canvasId || !nodeId || !id) return badParams("canvasId, nodeId and id required for profiles.bind");
          if (!findProfile(store, id)) return notFound(`no profile ${id}`);
          store.bindings = store.bindings.filter((b) => !(b.canvasId === canvasId && b.nodeId === nodeId));
          store.bindings.push({ canvasId, nodeId, profileId: id });
          writeProfileStore(store);
          const p = findProfile(store, id)!;
          return profileView(p, store);
        }

        if (action === "discardUnrecoverable") {
          const broken = store.profiles.filter(
            (p) => p.id !== DEFAULT_PROFILE_ID && !existsSync(join(browserDir(), "partitions", p.id)),
          );
          if (!broken.length) return { discarded: [], count: 0 };
          const ids = new Set(broken.map((p) => p.id));
          store.profiles = store.profiles.filter((p) => !ids.has(p.id));
          store.bindings = store.bindings.filter((b) => !ids.has(b.profileId));
          writeProfileStore(store);
          return { discarded: [...ids], count: ids.size };
        }

        return badParams(`unknown profiles action: ${action}`);
      },
    },

    // ----- history ------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.history",
      description:
        "query page history; params: {action:'query', prefix?, profileId?, limit?} or RE positional (document, canvasId, nodeId, prefix) — prefix string ≤256 (else 'Invalid history query.') -> newest-first entries (cap 500); {action:'clear', id?} wipes the partition",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "query";
        const profileId = ostr(obj, "profileId", "id");
        const partition = partitionOfProfileId(profileId);
        if (action === "clear") {
          const h = readHistory();
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
        "import browser sign-ins; params: {action:'sources'} -> the browsers really installed on this machine | {action:'run', profileId, file|cookies?} -> really import a cookie file (Netscape cookies.txt / JSON) into that profile | {action:'cancel'} | {action:'restart'} — reading a browser's own encrypted cookie store needs the OS keychain, which autumn does not take: {supported:false, reason}",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "sources";

        if (action === "sources") {
          const sources = knownBrowserRoots().map((s) => ({
            ...s,
            installed: existsSync(s.root),
            // Reading the browser's own store needs the OS keychain.
            importable: false,
            reason: "reading a browser's encrypted cookie store needs OS keychain access, which autumn does not take",
          }));
          return sources;
        }

        if (action === "run") {
          const profileId = ostr(obj, "profileId") ?? DEFAULT_PROFILE_ID;
          const store = readProfileStore();
          const profile = findProfile(store, profileId);
          if (!profile) return notFound(`no profile ${profileId}`);
          if (importJob && !importJob.cancelled) {
            return { ok: false, error: { code: "handler-error", message: "an import is already running" } };
          }
          const file = ostr(obj, "file");
          const inline = Array.isArray(obj.cookies) ? (obj.cookies as unknown[]) : null;
          let cookies: Array<Record<string, unknown>> = [];
          if (file) {
            try {
              cookies = parseCookieFile(readFileSync(file, "utf8"));
            } catch (e) {
              return handlerError(`could not read ${file}: ${String((e as Error)?.message ?? e)}`);
            }
          } else if (inline) {
            cookies = parseCookieFile(JSON.stringify(inline));
          } else {
            return {
              supported: false,
              reason: "pick a cookie file (Netscape cookies.txt or JSON) to import — reading a browser's own encrypted store needs OS keychain access",
            };
          }
          if (!cookies.length) return { ok: false, error: { code: "bad-params", message: "no cookies found in that file" } };

          importJob = { id: `imp-${randomUUID().slice(0, 8)}`, startedAt: Date.now(), cancelled: false };
          const partition = partitionFor(profile);
          let imported = 0;
          let failed = 0;
          for (const cookie of cookies) {
            if (importJob.cancelled) break;
            try {
              const ok = await setCookie(partition, cookie);
              if (ok) imported++;
              else failed++;
            } catch {
              failed++;
            }
          }
          const cancelled = importJob.cancelled;
          importJob = null;
          const record = {
            id: `imp-${Date.now().toString(36)}`,
            profileId,
            at: Date.now(),
            imported,
            failed,
            total: cookies.length,
            via: "cookie-file",
          };
          const log = loadJson<{ imports: unknown[] }>(cookieImportsFile(), { imports: [] });
          log.imports = [record, ...(log.imports ?? [])].slice(0, 50);
          save(cookieImportsFile(), log);
          if (profile.imported) {
            profile.imported = { ...profile.imported, credentials: imported > 0, at: Date.now() };
          } else {
            profile.imported = { source: "cookie-file", credentials: imported > 0, via: "import", at: Date.now() };
          }
          // Imported credentials always tighten the policy to "ask" (RE rule).
          if (imported > 0 && profile.agentAccess === "allowed") profile.agentAccess = "ask";
          writeProfileStore(store);
          return { status: cancelled ? "cancelled" : "ok", imported, failed, total: cookies.length, profileId, cancelled };
        }

        if (action === "cancel") {
          if (!importJob) return { status: "idle", cancelled: false };
          importJob.cancelled = true;
          return { status: "cancelling", cancelled: true, id: importJob.id };
        }

        if (action === "restart") {
          if (importJob && !importJob.cancelled) {
            return { ok: false, error: { code: "handler-error", message: "an import is already running" } };
          }
          importJob = null;
          return { status: "idle", restarted: true };
        }

        return badParams(`unknown import action: ${action}`);
      },
    },

    // ----- links --------------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.setLinks",
      description:
        "set the popup/external link policy; params: {allowlist:[string|{pattern}], profileId?} or RE positional (canvasId, pairs, document, opts{waitMs}) -> {links, applied, ready, pendingBrowserIds} — persisted and applied to every registered view of the canvas",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        const allowlist = obj.allowlist ?? obj.pairs ?? pos[1];
        return Array.isArray(allowlist) ? { ok: true } : { ok: false, message: "allowlist (array) required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const raw = (obj.allowlist ?? obj.pairs ?? pos[1]) as unknown[];
        const rules: LinkRule[] = [];
        for (const item of raw) {
          if (typeof item === "string") rules.push({ pattern: item });
          else if (Array.isArray(item) && typeof item[0] === "string") {
            rules.push({ pattern: item[0], ...(typeof item[1] === "string" ? { browserId: item[1] } : {}) });
          } else if (item && typeof item === "object") {
            const o = item as Record<string, unknown>;
            const pattern = o.pattern ?? o.url;
            if (typeof pattern !== "string") return badParams("allowlist entries must be strings, [pattern, browserId] or {pattern}");
            rules.push({ pattern, ...(typeof o.browserId === "string" ? { browserId: o.browserId } : {}) });
          } else return badParams("allowlist entries must be strings, [pattern, browserId] or {pattern}");
        }
        const canvasId = ostr(obj, "canvasId");
        writeLinks(rules);

        // Real application when a registered view has a live webContents.
        let applied = 0;
        const electron = lazyElectron();
        const views = readViews().filter((v) => !canvasId || v.canvasId === canvasId);
        for (const view of views) {
          if (typeof view.webContentsId !== "number") continue;
          try {
            const wc = electron?.webContents?.fromId?.(view.webContentsId);
            if (wc && typeof wc.setWindowOpenHandler === "function") {
              wc.setWindowOpenHandler(({ url }: { url: string }) =>
                rules.some((r) => matchPattern(r.pattern, url)) ? { action: "allow" } : { action: "deny" },
              );
              applied++;
            }
          } catch {
            /* view gone */
          }
        }
        // RE: the browser ids named by the pairs must be live before the
        // policy is considered applied.
        const wanted = new Set(rules.map((r) => r.browserId).filter((x): x is string => typeof x === "string"));
        const pendingBrowserIds = [...wanted].filter(
          (id) => !views.some((v) => v.nodeId === id && typeof v.webContentsId === "number"),
        );
        return {
          links: rules.length,
          allowlist: rules.map((r) => r.pattern),
          applied,
          ready: pendingBrowserIds.length === 0,
          pendingBrowserIds,
        };
      },
    },

    // ----- clear data ---------------------------------------------------------
    {
      kind: "bridge",
      id: "browser.clearData",
      description:
        "clear browser state; params: {profileId?} (RE positional document/canvasId/nodeId) -> {cleared, history, storage} — real history wipe always; session cookies/storage/cache only with the Electron session",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const canvasId = ostr(obj, "canvasId");
        const nodeId = ostr(obj, "nodeId");
        let profileId = ostr(obj, "profileId", "id");
        if (!profileId && canvasId && nodeId) {
          const store = readProfileStore();
          profileId = store.bindings.find((b) => b.canvasId === canvasId && b.nodeId === nodeId)?.profileId ?? DEFAULT_PROFILE_ID;
        }
        const partition = partitionOfProfileId(profileId);
        const h = readHistory();
        const n = (h[partition] ?? []).length;
        delete h[partition];
        writeHistory(h);
        let storage = false;
        const ses = sessionFor(partition);
        if (ses) {
          try {
            await ses.clearStorageData?.();
            await ses.clearCache?.();
            storage = true;
          } catch {
            storage = false;
          }
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
        "present a browser in a standalone window; params: {url} or RE positional (canvasId, cloudCanvasId, nodeId, enabled) -> {presented, url} (window close emits browser.onPresentationStopped) | enabled:false → stop; a non-boolean enabled → bad-params 'Choose whether to present this browser.'; {supported:false} headless",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        // RE positional: (canvasId, cloudCanvasId, nodeId, enabled).
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
            webPreferences: { partition: partitionOfProfileId(ostr(obj, "profileId", "partition")) },
          });
          win.loadURL(url);
          const id = typeof win.id === "number" ? win.id : presented.size + 1;
          presented.set(id, { url, win });
          win.on?.("closed", () => {
            if (presented.delete(id)) emit("browser.onPresentationStopped", { reason: "closed", url, ts: Date.now() });
          });
          return { presented: true, url };
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },

    // ----- workspace preview --------------------------------------------------
    {
      kind: "bridge",
      id: "browser.workspacePreview",
      description:
        "dock a browser preview in the Autumn window; params: {action:'request', url?, dock?} | {action:'release', leaseId} | {action:'session'} — a real WebContentsView in the workspace area; {supported:false, reason} without the Electron runtime (doc 32 §2e)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? "request";

        if (action === "release") {
          const leaseId = ostr(obj, "leaseId") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
          if (!leaseId) return badParams("leaseId required to release a preview");
          const lease = previews.get(leaseId);
          if (!lease) return { released: false, leaseId };
          try {
            lease.view?.webContents?.close?.();
          } catch {
            /* already gone */
          }
          previews.delete(leaseId);
          return { released: true, leaseId };
        }

        if (action === "session") {
          const canvasId = ostr(obj, "canvasId");
          const nodeId = ostr(obj, "nodeId");
          const store = readProfileStore();
          const bound = canvasId && nodeId
            ? store.bindings.find((b) => b.canvasId === canvasId && b.nodeId === nodeId)
            : undefined;
          const profile = findProfile(store, bound?.profileId ?? DEFAULT_PROFILE_ID) ?? defaultProfile();
          return {
            partition: profile.partition,
            profileId: profile.id,
            agentAccess: profile.agentAccess,
          };
        }

        if (action !== "request") return badParams(`unknown workspacePreview action: ${action}`);

        const url = ostr(obj, "url") ?? "about:blank";
        const dock = ostr(obj, "dock") ?? "right";
        const canvasId = ostr(obj, "canvasId");
        const nodeId = ostr(obj, "nodeId");
        const electron = lazyElectron();
        const BrowserWindow = electron?.BrowserWindow;
        if (!BrowserWindow || !electron?.WebContentsView) {
          return { supported: false, reason: "workspace previews need the Autumn window (Electron runtime)" };
        }
        try {
          const win = BrowserWindow.getAllWindows?.()?.[0];
          if (!win) return { supported: false, reason: "no Autumn window is open" };
          const view = new electron.WebContentsView({ webPreferences: { partition: partitionOfProfileId(ostr(obj, "profileId", "partition")) } });
          win.contentView?.addChildView?.(view);
          const area = win.getBounds?.() ?? { width: 1280, height: 800 };
          const width = Math.round(area.width * 0.45);
          const bounds =
            dock === "bottom"
              ? { x: 0, y: Math.round(area.height * 0.55), width: area.width, height: Math.round(area.height * 0.45) }
              : { x: area.width - width, y: 0, width, height: area.height };
          view.setBounds?.(bounds);
          view.webContents?.loadURL?.(url);
          const leaseId = `lease-${randomUUID().slice(0, 8)}`;
          previews.set(leaseId, { view, canvasId: canvasId ?? "", nodeId: nodeId ?? "", partition: partitionOfProfileId() });
          save(previewFile(), { leaseId, url, dock, bounds, canvasId, nodeId, at: Date.now() });
          return { opened: true, leaseId, url, dock, bounds };
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
  ];

  return handlers;
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
export function _readProfiles(): Profile[] {
  return readProfileStore().profiles;
}
export function _parseCookieFile(text: string): Array<Record<string, unknown>> {
  return parseCookieFile(text);
}
export function _listBrowserRoots(): ImportSource[] {
  return knownBrowserRoots();
}
export function _readDownloadsDir(): string | null {
  return loadJson<{ dir: string | null }>(downloadsDirFile(), { dir: null }).dir ?? null;
}
export function _readLinks(): LinkRule[] {
  return readLinks();
}
export function _listViews(): ViewRecord[] {
  return readViews();
}
export function _historyPartitions(): string[] {
  return Object.keys(readHistory());
}
export function _downloadsDirEntries(): string[] {
  try {
    return readdirSync(browserDir());
  } catch {
    return [];
  }
}
