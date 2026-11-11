// autumn — Wave-2 handlers: remotion (7 dispatchable: create/compositions/
// start/repair/stop/status/render; doc 32 §2h) — FULL (W2-11).
//
// RE-derived (October out/main/index.js):
//   remotionCreate(name, parent) → `<slug>-<uuid8>-remotion` folder in
//     defaultProjectsDir(), or nested "video-N" under an OWNED parent
//     (freeChildName(parent, "video")) — mkdir -p, returns the folder.
//   remotionCompositions(folder) → [] when not owned or src/Root.tsx missing;
//     else parses `<Composition … id="…">` ids with the RE regex
//     /<Composition[\s\S]*?\bid=["']([^"']+)["']/g (real fs read).
//   remotionStart(folder) → ownership gate returns RE ERROR STATE ("points
//     outside <root>'s projects folder, so it wasn't started. Add a new Video
//     Editor block to create one."); busy states return current state; else
//     boots the studio dev server.
//   remotionStop(folder) → drop the studio child, state → idle, and rm -rf an
//     OWNED folder that has become empty (RE cleanup).
//   remotionStatus(folder) → studios.get(folder)?.state ?? {folder,status:"idle"}.
//   remotionRepair(folder) → NOT owned or no package.json → RE error state
//     "Autumn cannot repair this Video project." (RE refuses in-place; never
//     touches foreign folders).
//   remotionRender(folder, composition) → ownership → RE error state
//     "Autumn does not own this Video folder."; already rendering → current
//     state; no composition id (param, else first parsed id) → RE-style
//     message state; else a real `remotion render <id> <out>` run.
//
// autumn design (doc 32 §2h) — a REAL video editor:
//   * the `remotion` + `@remotion/cli` dependencies ship with the app (4.0.518),
//     and the CLI is resolved project-local → app-local → PATH;
//   * the bundled template (app tree ./remotion) is a REAL Remotion project
//     (package.json, remotion.config.ts, tsconfig.json, src/index.ts,
//     src/Root.tsx + Caption/PromoCard/EndCard) — `create` scaffolds it into the
//     new project so the video editor has something to render immediately;
//   * `compositions` really parses the project's src/Root.tsx;
//   * `start` really runs `remotion studio --port <port>` in the project and
//     tracks the child; `stop` really kills it and cleans an emptied project;
//   * `render` really runs `remotion render <id> <out>` and verifies the output
//     file → {path, bytes, durationMs, jobId}; a failure answers a handler-error
//     with the stderr tail;
//   * `repair` re-copies the missing template files into the project
//     (idempotent) → {repaired:[names…]}.
//
// The render browser (Chrome Headless Shell) is a Remotion concern: the CLI
// downloads it on demand. When the download is unavailable the render answers
// a handler-error with the CLI's own message — never a fake mp4.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";
import { userDataDir } from "./store";
import { paramsOf, str, ostr, resolveBin, isOwnedFolder, projectsRoot } from "./params";

type StudioState = {
  folder: string;
  status: "idle" | "running" | "starting" | "installing" | "scaffolding" | "error";
  port?: number;
  pid?: number;
  url?: string;
  message?: string;
  rendering?: boolean;
};

function slugify(name: string | undefined, fallback: string): string {
  return (
    (name || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
  );
}

/** RE freeChildName: "taken" = exists AND non-empty. */
function freeChildName(parent: string, name: string): string {
  const taken = (leaf: string): boolean => {
    try {
      const p = join(parent, leaf);
      return existsSync(p) && readdirSync(p).length > 0;
    } catch {
      return false;
    }
  };
  if (!taken(name)) return name;
  for (let n = 2; ; n++) if (!taken(`${name}-${n}`)) return `${name}-${n}`;
}

/**
 * The `remotion` executable for a project folder:
 *   0. `AUTUMN_REMOTION_BIN` — an explicit override: a path to use, or an
 *      EMPTY value meaning "no CLI on this machine" (the honest gate stays
 *      reachable, and a user can pin a specific install);
 *   1. the project's own node_modules/.bin (what npx would pick),
 *   2. the APP's node_modules/.bin (the bundled dependency — the studio and
 *      the render both run against the app's install),
 *   3. PATH.
 * Null when none exists — the honest gate for studio/render.
 */
export function findRemotionBin(folder?: string): string | null {
  const override = process.env.AUTUMN_REMOTION_BIN;
  if (override !== undefined) {
    if (override === "") return null; // explicitly: no Remotion CLI here
    return existsSync(override) ? override : null;
  }
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  if (folder) {
    for (const ext of exts) {
      const p = join(folder, "node_modules", ".bin", `remotion${ext}`);
      if (existsSync(p)) return p;
    }
  }
  // The app's own install (this module lives in <app>/electron/backend).
  const appBin = join(__dirname, "..", "..", "node_modules", ".bin");
  for (const ext of exts) {
    const p = join(appBin, `remotion${ext}`);
    if (existsSync(p)) return p;
  }
  return resolveBin("remotion");
}

/** The bundled template dir (app tree ./remotion) — ships with W2-11. */
export function templateDir(): string {
  return join(__dirname, "..", "..", "remotion");
}

/** Recursively copy `src` into `dst` for files that are missing in dst. */
function copyMissing(src: string, dst: string, prefix = ""): string[] {
  const repaired: string[] = [];
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = statSync(s);
    if (st.isDirectory()) {
      mkdirSync(d, { recursive: true });
      repaired.push(...copyMissing(s, d, rel));
    } else if (!existsSync(d)) {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(s, d);
      repaired.push(rel);
    }
  }
  return repaired;
}

/** The composition ids of a project (the RE regex, real fs read). */
export function parseCompositionIds(folder: string): string[] {
  try {
    const root = join(folder, "src", "Root.tsx");
    if (!existsSync(root)) return [];
    const src = readFileSync(root, "utf8");
    const ids: string[] = [];
    const re = /<Composition[\s\S]*?\bid=["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) ids.push(m[1]);
    return ids;
  } catch {
    return [];
  }
}

export function makeRemotionHandlers(deps: W1Deps): RegisteredHandler[] {
  const { spawn, now } = deps;

  const studios = new Map<string, StudioState>();
  const children = new Map<string, ChildProcLike>();
  const renderJobs = new Map<string, ChildProcLike>(); // key: folder

  function setState(folder: string, patch: Partial<StudioState>): StudioState {
    const cur: StudioState = { folder, status: "idle", ...(studios.get(folder) ?? {}) };
    const next: StudioState = { ...cur, ...patch, folder };
    studios.set(folder, next);
    return next;
  }

  /** Deterministic default studio port per folder (params.port overrides). */
  function defaultPort(folder: string): number {
    let h = 0;
    for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) >>> 0;
    return 3000 + (h % 2000);
  }

  /** Scaffold the bundled template into a project (idempotent). */
  function scaffold(folder: string): string[] {
    const src = templateDir();
    if (!existsSync(src)) return [];
    return copyMissing(src, folder);
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "remotion.create",
      description:
        "create a video-editor project (RE remotionCreate: slug + uuid8 + '-remotion'); params: {name?, parent?} or positional (name, parent) — nested under an OWNED parent via freeChildName (… → video-2); scaffolds the bundled Remotion template (Caption/PromoCard/EndCard) into it; returns the folder path",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const name = obj.name !== undefined ? (obj.name as string) : typeof pos[0] === "string" ? pos[0] : undefined;
        const parent = obj.parent !== undefined ? (obj.parent as string) : typeof pos[1] === "string" ? pos[1] : undefined;
        const slug = slugify(name, "autumn");
        const nest = parent && isOwnedFolder(parent);
        const folder = nest
          ? join(parent as string, freeChildName(parent as string, "video"))
          : join(projectsRoot(), `${slug}-${randomUUID().slice(0, 8)}-remotion`);
        mkdirSync(folder, { recursive: true });
        scaffold(folder);
        return folder;
      },
    },

    {
      kind: "bridge",
      id: "remotion.compositions",
      description:
        "list composition ids in a project (RE remotionCompositions): params: folder (positional) — [] when outside the Autumn projects folder or src/Root.tsx is absent; else real parse of <Composition … id=\"…\"> (no CLI needed)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!isOwnedFolder(folder)) return [];
        return parseCompositionIds(folder as string);
      },
    },

    {
      kind: "bridge",
      id: "remotion.start",
      description:
        "start the Remotion studio (RE remotionStart ownership → RE error-state shape; busy → current state); real `remotion studio --port <port>` run in the project folder → {status:'running', port, pid, url}; CLI absent → {supported:false, reason}; exit → state idle/error",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!isOwnedFolder(folder)) {
          return setState(folder as unknown as string, {
            status: "error",
            message: `This video editor points outside ${projectsRoot()}'s projects folder, so it wasn't started. Add a new Video Editor block to create one.`,
          });
        }
        const f = folder as string;
        const busy = studios.get(f)?.status;
        if (busy === "running" || busy === "starting" || busy === "installing" || busy === "scaffolding") {
          return studios.get(f) as StudioState;
        }
        const bin = findRemotionBin(f);
        if (!bin) return { supported: false, reason: "the Remotion studio CLI is not installed — install remotion + @remotion/cli (doc 32 §W2-11)" };
        const port = typeof obj.port === "number" && obj.port > 0 ? obj.port : defaultPort(f);
        setState(f, { status: "starting" });
        try {
          const child = spawn.spawn(bin, ["studio", "--port", String(port)], { cwd: f });
          children.set(f, child);
          const fail = (message: string) => {
            if (children.get(f) === child) children.delete(f);
            setState(f, { status: "error", port: undefined, pid: undefined, url: undefined, message });
          };
          child.on("error", (err: Error) => fail(err.message));
          child.on("exit", (code: number | null) => {
            if (code === 0) setState(f, { status: "idle", port: undefined, pid: undefined, url: undefined });
            else fail(`remotion studio exited ${code}`);
          });
          const url = `http://127.0.0.1:${port}/`;
          const pid = (child as { pid?: number }).pid;
          return setState(f, { status: "running", port, ...(typeof pid === "number" ? { pid } : {}), url });
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },

    {
      kind: "bridge",
      id: "remotion.stop",
      description:
        "stop the Remotion studio (RE remotionStop): kill the tracked child → state idle; remove an OWNED folder that became empty (RE rmSync cleanup); nothing running → idle state (idempotent)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!folder) return { status: "idle", running: false };
        const child = children.get(folder);
        if (child) {
          try {
            child.kill();
          } catch {
            /* raced to exit */
          }
          children.delete(folder);
        }
        const state = setState(folder, { status: "idle", port: undefined, pid: undefined, url: undefined, message: undefined, rendering: false });
        if (isOwnedFolder(folder) && existsSync(folder)) {
          try {
            if (readdirSync(folder).length === 0) rmSync(folder, { recursive: true, force: true });
          } catch {
            /* best effort, like RE */
          }
        }
        return { ...state, running: false };
      },
    },

    {
      kind: "bridge",
      id: "remotion.status",
      description:
        "studio status (RE remotionStatus): params: folder → {folder, status, running, port?, pid?, url?} (default {status:'idle', running:false})",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!folder) return { status: "idle", running: false };
        const st = studios.get(folder) ?? { folder, status: "idle" as const };
        return { ...st, running: st.status === "running" };
      },
    },

    {
      kind: "bridge",
      id: "remotion.render",
      description:
        "render a composition (RE remotionRender): ownership → RE error-state 'Autumn does not own this Video folder.'; already rendering → current state; no id (param, else first parsed id) → message state; real `remotion render <id> <out>` → {path, bytes, durationMs, jobId}; CLI absent → {supported:false, reason}; failure → handler-error with the stderr tail; output <userData>/remotion/<ts>-<id>.mp4 (doc 32 §2h)",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!isOwnedFolder(folder)) {
          return { folder: folder ?? null, status: "error", rendering: false, message: "Autumn does not own this Video folder." };
        }
        const f = folder as string;
        if (renderJobs.has(f)) return { ...(studios.get(f) as StudioState), rendering: true };

        // positional order is (folder, composition) — composition is pos[1].
        const explicit = ostr(obj, "composition", "id") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        const ids = parseCompositionIds(f);
        const id = (explicit || ids[0] || "").trim();
        if (!id) {
          return setState(f, {
            rendering: false,
            status: studios.get(f)?.status ?? "idle",
            message: "No video to render yet — describe one with a connected chat first.",
          });
        }
        const bin = findRemotionBin(f);
        if (!bin) return { supported: false, reason: "the Remotion render CLI is not installed — install remotion + @remotion/cli (doc 32 §W2-11)" };

        const outDir = join(userDataDir(), "remotion");
        mkdirSync(outDir, { recursive: true });
        const outPath =
          ostr(obj, "outPath", "out", "outFile") ??
          (typeof pos[2] === "string" ? pos[2] : undefined) ??
          join(outDir, `${Date.now()}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`);
        const startedAt = now();
        const jobId = `render-${startedAt.toString(36)}`;

        return new Promise((resolve) => {
          let settled = false;
          let tail = "";
          const finish = (out: unknown) => {
            if (settled) return;
            settled = true;
            if (renderJobs.get(f) === child) renderJobs.delete(f);
            resolve(out);
          };
          let child: ChildProcLike;
          try {
            child = spawn.spawn(bin, ["render", id, outPath], { cwd: f });
          } catch (e) {
            finish({ ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } });
            return;
          }
          renderJobs.set(f, child);
          child.stderr?.on?.("data", (chunk: Buffer | string) => {
            tail = `${tail}${String(chunk)}`.slice(-2000);
          });
          child.on("error", (err: Error) => finish({ ok: false, error: { code: "handler-error", message: err.message } }));
          child.on("exit", (code: number | null) => {
            const durationMs = now() - startedAt;
            if (code === 0 && existsSync(outPath)) {
              finish({ path: outPath, bytes: statSync(outPath).size, durationMs, jobId, composition: id });
            } else {
              const message =
                code === 0
                  ? `remotion render produced no output at ${outPath}`
                  : `remotion render exited ${code}${tail ? `: ${tail.split("\n").slice(-4).join(" ").trim()}` : ""}`;
              finish({ ok: false, error: { code: "handler-error", message } });
            }
          });
        });
      },
    },

    {
      kind: "bridge",
      id: "remotion.repair",
      description:
        "repair a video project (RE remotionRepair): not owned or no package.json → RE error-state 'Autumn cannot repair this Video project.'; else copy missing bundled-template files (app ./remotion) over the project, idempotently → {repaired:[names…], folder}",
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = str(obj, pos, "folder", "path") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!isOwnedFolder(folder) || !existsSync(join(folder, "package.json"))) {
          return setState((folder as unknown as string) ?? "", { status: "error", message: "Autumn cannot repair this Video project." });
        }
        const repaired = scaffold(folder as string);
        return { repaired, folder, ok: true };
      },
    },
  ];

  return handlers;
}
