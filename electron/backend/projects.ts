// autumn — Wave-4 handlers: projects (16 dispatchable; doc 35 §8).
//
// A project is a folder on this machine. Autumn keeps a list of the ones you
// have opened, can create new ones, clone repositories into them, and — the
// part that makes them useful — read the ROUTES out of them, so the app can
// show you the app before you open it.
//
// The recents live in `<userData>/db/project-recents.json`.
//
// The routes:
//   - Next.js / React  → the pages under app/ (or src/app/)
//   - React Native    → the screens under the app's root
//   - Flutter         → the static routes declared in the Dart sources
//
// Everything here is real: the folders are really on disk, the routes are
// really read out of the sources, and a clone really runs git.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";
import { isOwnedFolder, projectsRoot } from "./params";

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
// the recents
// ---------------------------------------------------------------------------

export interface ProjectRecent {
  path: string;
  name: string;
  /** What the project is, when it can be told: "next" | "react-native" | "flutter" | "unknown". */
  kind: string;
  lastOpenedAt: number;
}

const recentsFile = () => dbPath("project-recents.json");
const readRecents = (): ProjectRecent[] => loadJson<ProjectRecent[]>(recentsFile(), []);
const writeRecents = (rows: ProjectRecent[]): void => saveJson(recentsFile(), rows);

/** The project's kind, read out of its files. */
export function detectProjectKind(dir: string): string {
  if (existsSync(join(dir, "pubspec.yaml"))) return "flutter";
  if (existsSync(join(dir, "app.json")) || existsSync(join(dir, "app.config.js"))) return "react-native";
  if (existsSync(join(dir, "next.config.js")) || existsSync(join(dir, "next.config.ts"))) return "next";
  if (existsSync(join(dir, "package.json"))) return "node";
  return "unknown";
}

/** The project's apps (the folders that hold an app of their own). */
export function discoverApps(dir: string): Array<{ path: string; name: string; kind: string }> {
  const apps: Array<{ path: string; name: string; kind: string }> = [];
  const consider = (candidate: string) => {
    if (!existsSync(candidate)) return;
    const kind = detectProjectKind(candidate);
    if (kind === "unknown") return;
    apps.push({ path: candidate, name: basename(candidate), kind });
  };
  consider(dir);
  for (const entry of safeEntries(dir)) {
    const candidate = join(dir, entry);
    try {
      if (!statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    consider(candidate);
  }
  return apps;
}

function safeEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// the routes
// ---------------------------------------------------------------------------

export interface ProjectRoute {
  routePath: string;
  filePath: string;
}

/** The routes of a Next.js / React app: the pages under app/ or src/app/. */
export function scanNextRoutes(dir: string): ProjectRoute[] {
  const candidates = [join(dir, "app"), join(dir, "src", "app")];
  for (const appDir of candidates) {
    if (!existsSync(appDir)) continue;
    const routes: ProjectRoute[] = [];
    const walk = (current: string) => {
      for (const entry of safeEntries(current)) {
        const full = join(current, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/^page\.(tsx|ts|jsx|js)$/.test(entry)) continue;
        const rel = relative(appDir, full).replace(/\\/g, "/");
        const withoutExt = rel
          .replace(/^page\.(tsx|ts|jsx|js)$/, "")
          .replace(/\/page\.(tsx|ts|jsx|js)$/, "");
        const routePath = "/" + withoutExt.replace(/\/+/g, "/").replace(/\/$/, "");
        routes.push({ routePath: routePath === "" ? "/" : routePath, filePath: full });
      }
    };
    walk(appDir);
    if (routes.length) return routes;
  }
  return [{ routePath: "/", filePath: "" }];
}

/** The routes of a React Native app: the screens under its root. */
export function scanReactNativeRoutes(dir: string): ProjectRoute[] {
  const candidates = [join(dir, "src"), dir];
  for (const root of candidates) {
    if (!existsSync(root)) continue;
    const routes: ProjectRoute[] = [];
    const walk = (current: string) => {
      for (const entry of safeEntries(current)) {
        const full = join(current, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (entry === "node_modules" || entry.startsWith(".")) continue;
          walk(full);
          continue;
        }
        if (!/\.(tsx|jsx)$/.test(entry) || !/^Screen/.test(entry)) continue;
        const rel = relative(root, full).replace(/\\/g, "/").replace(/\.(tsx|jsx)$/, "");
        routes.push({ routePath: "/" + rel.replace(/\/+/g, "/"), filePath: full });
      }
    };
    walk(root);
    if (routes.length) return routes;
  }
  return [{ routePath: "/", filePath: "" }];
}

/** The static routes a Flutter app declares in its Dart sources. */
export function scanFlutterRoutes(dir: string): ProjectRoute[] {
  const routes: ProjectRoute[] = [];
  const libDir = join(dir, "lib");
  const walk = (current: string) => {
    for (const entry of safeEntries(current)) {
      const full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (extname(entry) !== ".dart") continue;
      const text = readFileSync(full, "utf8");
      const re = /static\s+const\s+([A-Za-z0-9_]+)\s*=\s*['"](\/[^'"]*)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        routes.push({ routePath: m[2], filePath: full });
      }
    }
  };
  if (existsSync(libDir)) walk(libDir);
  return routes.length ? routes : [{ routePath: "/", filePath: "" }];
}

/** Every route of a project, whatever it is written in. */
export function scanRoutes(dir: string, framework?: string): ProjectRoute[] {
  const kind = framework ?? detectProjectKind(dir);
  if (kind === "flutter") return scanFlutterRoutes(dir);
  if (kind === "react-native") return scanReactNativeRoutes(dir);
  return scanNextRoutes(dir);
}

// ---------------------------------------------------------------------------
// the handlers
// ---------------------------------------------------------------------------

export function makeProjectsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now, git } = deps;

  /** Remember a project (the most recent first, no duplicates). */
  const remember = (path: string): ProjectRecent => {
    const info: ProjectRecent = {
      path,
      name: basename(path),
      kind: detectProjectKind(path),
      lastOpenedAt: now(),
    };
    const rows = readRecents().filter((row) => row.path !== path);
    writeRecents([info, ...rows].slice(0, 50));
    return info;
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "projects.defaultDir",
      description: "the folder new projects are created in; params: {} -> { path }",
      handler: () => ({ path: projectsRoot() }),
    },
    {
      kind: "bridge",
      id: "projects.recents",
      description: "the recently opened projects; params: {} -> { recents[] } (the folders that are still there are marked)",
      handler: () => {
        const recents = readRecents().map((row) => ({ ...row, missing: !existsSync(row.path) }));
        return { recents };
      },
    },
    {
      kind: "bridge",
      id: "projects.pickFolder",
      description:
        "pick a folder with the OS dialog; params: {} -> not-implemented (the native dialog is wired at the facade layer)",
      handler: () => ({
        ok: false,
        error: {
          code: "not-implemented",
          message: "projects.pickFolder needs the native folder dialog (wired at the facade layer)",
        },
      }),
    },
    {
      kind: "bridge",
      id: "projects.open",
      description: "open a project; params: { path } -> { project } (the folder is remembered)",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        return { project: remember(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.forgetRecent",
      description: "forget a recent project; params: { path } -> { ok }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        writeRecents(readRecents().filter((row) => row.path !== path));
        return { ok: true, path };
      },
    },
    {
      kind: "bridge",
      id: "projects.relocateRecent",
      description: "move a recent project to another folder; params: { oldPath, newPath } -> { ok, info }",
      schema: (p) =>
        typeof p?.oldPath === "string" && typeof p?.newPath === "string"
          ? { ok: true }
          : { ok: false, message: "oldPath and newPath required" },
      handler: (p) => {
        const oldPath = resolve(String(p?.oldPath));
        const newPath = resolve(String(p?.newPath));
        const recents = readRecents();
        const current = recents.find((row) => row.path === oldPath);
        if (!current) return badParams("That workspace is no longer in your recent list.");
        if (!existsSync(newPath)) return badParams("Choose an existing folder.");
        if (newPath !== oldPath && recents.some((row) => row.path === newPath)) {
          return badParams("That folder is already in your recent list.");
        }
        const info: ProjectRecent = { ...current, path: newPath, lastOpenedAt: now() };
        writeRecents(recents.map((row) => (row.path === oldPath ? info : row)));
        return { ok: true, info };
      },
    },
    {
      kind: "bridge",
      id: "projects.discoverApps",
      description: "the apps inside a project; params: { path } -> { apps[] }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        return { apps: discoverApps(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.scanRoutes",
      description: "the routes of a project; params: { path, framework? } -> { routes[] }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        return { routes: scanRoutes(path, typeof p?.framework === "string" ? p.framework : undefined) };
      },
    },
    {
      kind: "bridge",
      id: "projects.flutterRoutes",
      description: "the routes of a Flutter app; params: { path } -> { routes[] }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        return { routes: scanFlutterRoutes(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.rnRoutes",
      description: "the routes of a React Native app; params: { path } -> { routes[] }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        return { routes: scanReactNativeRoutes(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.detectPreview",
      description: "how a project can be previewed; params: { path } -> { preview }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        const kind = detectProjectKind(path);
        const script = readPackageScript(path);
        return {
          preview: {
            kind,
            command: script,
            available: Boolean(script),
            routes: scanRoutes(path, kind),
          },
        };
      },
    },
    {
      kind: "bridge",
      id: "projects.create",
      description: "create a project; params: { name, parent?, kind? } -> { path } (a real folder with a package.json)",
      schema: (p) => (typeof p?.name === "string" && p.name.length > 0 ? { ok: true } : { ok: false, message: "name required" }),
      handler: (p) => {
        const name = String(p?.name ?? "").trim();
        if (!name || name.includes("/") || name.includes("\\")) return badParams("name must be a single folder name");
        const parent = typeof p?.parent === "string" ? resolve(p.parent) : projectsRoot();
        const path = join(parent, name);
        if (existsSync(path)) return badParams(`${path} already exists`);
        try {
          mkdirSync(path, { recursive: true });
          const kind = typeof p?.kind === "string" ? p.kind : "node";
          if (kind === "flutter") {
            writeFileSync(join(path, "pubspec.yaml"), `name: ${name.replace(/[^a-z0-9_]/gi, "_")}\n`, "utf8");
          } else if (kind === "react-native") {
            writeFileSync(join(path, "app.json"), JSON.stringify({ name, displayName: name }, null, 2), "utf8");
          } else {
            writeFileSync(
              join(path, "package.json"),
              JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), private: true, version: "0.1.0" }, null, 2),
              "utf8",
            );
          }
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { path, project: remember(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.newChildLocation",
      description: "where a child project would go; params: { parent, name } -> { path }",
      schema: (p) => (typeof p?.parent === "string" ? { ok: true } : { ok: false, message: "parent required" }),
      handler: (p) => {
        const parent = resolve(String(p?.parent ?? ""));
        const name = String(p?.name ?? "").trim() || "project";
        return { path: join(parent, name) };
      },
    },
    {
      kind: "bridge",
      id: "projects.prepareSetup",
      description: "prepare a project for the setup; params: { path } -> { setup }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        const kind = detectProjectKind(path);
        return {
          setup: {
            path,
            kind,
            dependencies: readPackageJson(path),
            commands: readPackageScript(path) ? ["dev"] : [],
            routes: scanRoutes(path, kind),
          },
        };
      },
    },
    {
      kind: "bridge",
      id: "projects.clone",
      description: "clone a repository into a new project; params: { url, name?, parent? } -> { path } (a real git clone)",
      schema: (p) => (typeof p?.url === "string" ? { ok: true } : { ok: false, message: "url required" }),
      handler: async (p) => {
        const url = String(p?.url ?? "").trim();
        if (!url) return badParams("url required");
        const parent = typeof p?.parent === "string" ? resolve(p.parent) : projectsRoot();
        const name = String(p?.name ?? "").trim() || basename(url.replace(/\/+$/, "")) || "project";
        const path = join(parent, name);
        if (existsSync(path)) return badParams(`${path} already exists`);
        try {
          mkdirSync(parent, { recursive: true });
          await git(parent).clone(url, path);
        } catch (e) {
          return handlerError(`the clone failed: ${(e as Error)?.message ?? e}`);
        }
        return { path, project: remember(path) };
      },
    },
    {
      kind: "bridge",
      id: "projects.openIsolated",
      description:
        "open a project in isolation — its own worktree, so the work does not touch your checkout; params: { path, branch? } -> { path, branch }",
      schema: (p) => (typeof p?.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
      handler: async (p) => {
        const path = resolve(String(p?.path ?? ""));
        if (!existsSync(path)) return notFound(`no folder at ${path}`);
        const branch = String(p?.branch ?? "").trim() || `autumn/${Date.now().toString(36)}`;
        const target = join(projectsRoot(), `${basename(path)}--${branch.replace(/[^\w.-]/g, "-")}`);
        try {
          await git(path).raw(["worktree", "add", "-b", branch, target]);
        } catch (e) {
          return handlerError(`the isolated worktree could not be created: ${(e as Error)?.message ?? e}`);
        }
        return { path: target, branch, project: remember(target) };
      },
    },
  ];

  return handlers;
}

/** The project's package.json (if it has one). */
function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The project's dev script (if it has one). */
function readPackageScript(dir: string): string | null {
  const pkg = readPackageJson(dir);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  return typeof scripts.dev === "string" ? scripts.dev : null;
}
