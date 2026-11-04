// autumn — Wave-1 handlers: files (37 renderer-used dispatchable; doc 31).
//
// Backing is REAL node:fs/promises calls plus deps.shell for reveal/open. The
// target's editor-buffer lifecycle ids (openFileNode/releaseFileNode/
// closeBufferChoice/editorIdentity/mutationIdentity/openTargets) are honest
// derivations — autumn has no buffer registry — and the thumbnail ids return
// a well-formed {thumbnail:null} (autumn has no thumbnail pipeline; no bytes
// are invented). Asset-library ids with no autumn store
// (addToLibrary) return {supported:false} rather than fake success.
// trashEntry moves into a `.autumn-trash/` sibling directory (real rename) —
// Electron's shell.trashItem is not in W1Deps, so this is an in-tree trash.
// Registered by index.ts; do not edit shared files (w1-deps.ts, index.ts,
// handlers.ts, registry, manifest). Contract: every id must exist in
// electron/ipc/manifest.json bridge namespaces. Envelope rules: plain payload
// on success (registry wraps {ok:true,result}), or deliberate
// { ok:false, error } envelopes — bad-params (validation), not-found
// (missing path), handler-error (real fs failure, e.g. too-large file).
//
// Param convention: every path parameter must be ABSOLUTE (bad-params
// otherwise). All mutations emit `files.onFileNodeChanged` with
// { path, change, to? } — a subscription with a real trigger, nothing else.

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

/** Deliberate bad-input envelope (doc 31 §2). */
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

const validAbs = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 4096 && isAbsolute(v) && !v.includes("\0");

/** Plain filename, no separators/traversal — for saveAttachment params. */
const validName = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 255 && !v.includes("/") && !v.includes("\\") && !v.includes("\0") && v !== "." && v !== "..";

/** Slug: file-safe screen name. */
const slug = (v: string) =>
  v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "screen";

const MAX_READ_BYTES = 10 * 1024 * 1024;
const WALK_DEFAULT_DEPTH = 2;
const WALK_MAX_DEPTH = 6;
const WALK_MAX_ENTRIES = 1000;

interface WalkItem {
  path: string;
  rel: string;
  type: "dir" | "file" | "other";
  depth: number;
  size?: number;
  mtimeMs?: number;
}

/** Bounded recursive walk — never escapes `root`, capped by depth/entries. */
async function walk(
  fs: typeof import("node:fs/promises"),
  root: string,
  maxDepth: number,
  maxEntries: number,
): Promise<WalkItem[]> {
  const items: WalkItem[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && items.length < maxEntries) {
    const { dir, depth } = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dirs are skipped
    }
    for (const entry of entries) {
      if (items.length >= maxEntries) break;
      const full = join(dir, entry.name);
      const rel = full.slice(root.length).replace(/^[/\\]/, "");
      if (entry.isDirectory()) {
        items.push({ path: full, rel, type: "dir", depth: depth + 1 });
        if (depth + 1 < maxDepth) stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        let size: number | undefined;
        let mtimeMs: number | undefined;
        try {
          const st = await fs.stat(full);
          size = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          /* keep undefined */
        }
        items.push({ path: full, rel, type: "file", depth: depth + 1, size, mtimeMs });
      } else {
        items.push({ path: full, rel, type: "other", depth: depth + 1 });
      }
    }
  }
  return items;
}

/** Resolve a child path inside a base dir, refusing traversal escapes. */
function childOf(base: string, name: string): string | null {
  const joined = normalize(join(base, name));
  const b = normalize(base);
  if (joined === b) return null;
  return joined.startsWith(b + sep) || joined.startsWith(b + "/") ? joined : null;
}

async function pathExists(fs: typeof import("node:fs/promises"), p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function makeFilesHandlers(deps: W1Deps): RegisteredHandler[] {
  const { fs, shell, emit, now } = deps;

  /** Real mutation notification — emitted ONLY after the fs op succeeded. */
  const changed = (path: string, change: "created" | "modified" | "deleted" | "renamed", to?: string) =>
    emit("files.onFileNodeChanged", to ? { path, change, to } : { path, change });

  const statOrNull = async (p: string) => {
    try {
      return await fs.stat(p);
    } catch {
      return null;
    }
  };

  const handlers: RegisteredHandler[] = [
    // ---------------- directory browsing ----------------
    {
      kind: "bridge",
      id: "files.list",
      description:
        "list a directory (dirs first, then files, alphabetical); params: { dir: absolute } -> { dir, items: [{ name, path, type, size?, mtimeMs? }] } | not-found when dir is missing",
      schema: (p) => (validAbs(p?.dir) ? { ok: true } : { ok: false, message: "dir required (absolute path)" }),
      handler: async (p) => {
        if (!validAbs(p?.dir)) return badParams("dir required (absolute path)");
        const dir = p.dir;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (e) {
          const msg = (e as NodeJS.ErrnoException).code;
          return msg === "ENOENT"
            ? notFound(`directory not found: ${dir}`)
            : handlerError(`readdir failed: ${msg ?? String(e)}`);
        }
        const items: Array<{ name: string; path: string; type: string; size?: number; mtimeMs?: number }> = [];
        for (const entry of entries) {
          const full = join(dir, entry.name);
          let size: number | undefined;
          let mtimeMs: number | undefined;
          if (entry.isFile()) {
            try {
              const st = await fs.stat(full);
              size = st.size;
              mtimeMs = st.mtimeMs;
            } catch {
              /* best effort */
            }
          }
          items.push({
            name: entry.name,
            path: full,
            type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
            ...(size !== undefined ? { size, mtimeMs } : {}),
          });
        }
        items.sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
        );
        return { dir, items };
      },
    },
    {
      kind: "bridge",
      id: "files.listTree",
      description:
        "bounded recursive tree; params: { dir: absolute, depth?: number (default 2, max 6), maxEntries?: number (default 1000, max 5000) } -> { dir, items: [{ path, rel, type: dir|file|other, depth, size?, mtimeMs? }] }",
      schema: (p) =>
        validAbs(p?.dir) &&
        (p?.depth === undefined || (Number.isFinite(p.depth) && p.depth >= 1)) &&
        (p?.maxEntries === undefined || (Number.isFinite(p.maxEntries) && p.maxEntries >= 1))
          ? { ok: true }
          : { ok: false, message: "dir required (absolute); depth/maxEntries must be positive numbers" },
      handler: async (p) => {
        if (!validAbs(p?.dir)) return badParams("dir required (absolute path)");
        const depth = Math.min(WALK_MAX_DEPTH, Math.floor(Number(p.depth) || WALK_DEFAULT_DEPTH));
        const maxEntries = Math.min(5000, Math.floor(Number(p.maxEntries) || WALK_MAX_ENTRIES));
        if (!(await pathExists(fs, p.dir))) return notFound(`directory not found: ${p.dir}`);
        return { dir: p.dir, items: await walk(fs, p.dir, depth, maxEntries) };
      },
    },
    {
      kind: "bridge",
      id: "files.listAssets",
      description:
        "list asset files (image/audio/video/font extensions) under a dir; params: { dir?: absolute (default cwd), kind?: string filter on ext } -> { items: [{ name, path, ext }] } (missing dir -> empty items)",
      schema: (p) =>
        (p?.dir === undefined || validAbs(p.dir)) && (p?.kind === undefined || typeof p.kind === "string")
          ? { ok: true }
          : { ok: false, message: "dir must be absolute when given; kind must be a string when given" },
      handler: async (p) => {
        if (p?.dir !== undefined && !validAbs(p.dir)) return badParams("dir must be absolute when given");
        const dir = (p.dir as string | undefined) ?? process.cwd();
        const ASSET_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".mp3", ".wav", ".mp4", ".webm", ".ttf", ".otf", ".woff2"]);
        if (!(await pathExists(fs, dir))) return { items: [] };
        const items: Array<{ name: string; path: string; ext: string }> = [];
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const ext = (entry.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
          if (!ASSET_EXT.has(ext)) continue;
          if (p.kind && ext.slice(1) !== String(p.kind).toLowerCase()) continue;
          items.push({ name: entry.name, path: join(dir, entry.name), ext });
        }
        return { items };
      },
    },
    {
      kind: "bridge",
      id: "files.listFolders",
      description:
        "list directories under dir (bounded, dirs only); params: { dir?: absolute (default cwd), depth?: number (default 1, max 4) } -> { items: [{ name, path }] } (missing dir -> empty items)",
      schema: (p) =>
        (p?.dir === undefined || validAbs(p.dir)) && (p?.depth === undefined || (Number.isFinite(p.depth) && p.depth >= 1))
          ? { ok: true }
          : { ok: false, message: "dir must be absolute when given; depth must be a positive number" },
      handler: async (p) => {
        if (p?.dir !== undefined && !validAbs(p.dir)) return badParams("dir must be absolute when given");
        const dir = (p.dir as string | undefined) ?? process.cwd();
        if (!(await pathExists(fs, dir))) return { items: [] };
        const depth = Math.min(4, Math.floor(Number(p.depth) || 1));
        const walked = await walk(fs, dir, depth, WALK_MAX_ENTRIES);
        return { items: walked.filter((i) => i.type === "dir").map((i) => ({ name: basename(i.path), path: i.path })) };
      },
    },
    {
      kind: "bridge",
      id: "files.listProjectResources",
      description:
        "list known project resource directories under cwd (public/src/assets/docs/...); params: { cwd?: absolute (default process.cwd()), depth?: number (default 1, max 3) } -> { items: [{ name, path }] } | not-found for a missing cwd",
      schema: (p) =>
        (p?.cwd === undefined || validAbs(p.cwd)) && (p?.depth === undefined || (Number.isFinite(p.depth) && p.depth >= 1))
          ? { ok: true }
          : { ok: false, message: "cwd must be absolute when given" },
      handler: async (p) => {
        if (p?.cwd !== undefined && !validAbs(p.cwd)) return badParams("cwd must be absolute when given");
        const cwd = (p.cwd as string | undefined) ?? process.cwd();
        if (!(await pathExists(fs, cwd))) return notFound(`directory not found: ${cwd}`);
        const KNOWN = ["public", "src", "assets", "docs", "documentation", "resources", "static", "scripts", "lib", "packages"];
        const items: Array<{ name: string; path: string }> = [];
        for (const name of KNOWN) {
          const full = join(cwd, name);
          const st = await statOrNull(full);
          if (st?.isDirectory()) items.push({ name, path: full });
        }
        return { items };
      },
    },

    // ---------------- file read/write ----------------
    {
      kind: "bridge",
      id: "files.exists",
      description:
        "check existence; params: { path: absolute } -> { exists: boolean, type?: 'file'|'dir'|'other' }",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st) return { exists: false };
        return { exists: true, type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other" };
      },
    },
    {
      kind: "bridge",
      id: "files.read",
      description:
        "read a text file (utf8, max 10MB); params: { path: absolute, encoding?: string } -> { path, content } | not-found | handler-error (too large)",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st) return notFound(`file not found: ${p.path}`);
        if (st.isDirectory()) return badParams("path is a directory");
        if (st.size > MAX_READ_BYTES) return handlerError(`file too large to read (${st.size} bytes > 10MB limit)`);
        try {
          return { path: p.path, content: await fs.readFile(p.path, "utf8") };
        } catch (e) {
          return handlerError(`read failed: ${(e as Error).message}`);
        }
      },
    },
    {
      kind: "bridge",
      id: "files.write",
      description:
        "write a text file (utf8); parent dirs are created; params: { path: absolute, content: string } -> { ok: true, path, bytes } + files.onFileNodeChanged",
      schema: (p) =>
        validAbs(p?.path) && typeof p?.content === "string"
          ? { ok: true }
          : { ok: false, message: "path (absolute) and content (string) are required" },
      handler: async (p) => {
        if (!validAbs(p?.path) || typeof p?.content !== "string") {
          return badParams("path (absolute) and content (string) are required");
        }
        const existed = await pathExists(fs, p.path);
        try {
          await fs.mkdir(dirname(p.path), { recursive: true });
          await fs.writeFile(p.path, p.content, "utf8");
        } catch (e) {
          return handlerError(`write failed: ${(e as Error).message}`);
        }
        changed(p.path, existed ? "modified" : "created");
        return { ok: true, path: p.path, bytes: Buffer.byteLength(p.content, "utf8") };
      },
    },
    {
      kind: "bridge",
      id: "files.createFile",
      description:
        "create a new file (content optional); fails if it already exists; params: { path: absolute, content?: string } -> { ok: true, path, created: true } + files.onFileNodeChanged",
      schema: (p) =>
        validAbs(p?.path) && (p?.content === undefined || typeof p.content === "string")
          ? { ok: true }
          : { ok: false, message: "path required (absolute); content must be a string when given" },
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        if (p.content !== undefined && typeof p.content !== "string") return badParams("content must be a string when given");
        try {
          await fs.mkdir(dirname(p.path), { recursive: true });
          const handle = await fs.open(p.path, "wx");
          await handle.writeFile(p.content ?? "", "utf8");
          await handle.close();
        } catch (e) {
          const msg = (e as NodeJS.ErrnoException).code;
          return msg === "EEXIST"
            ? handlerError(`file already exists: ${p.path}`)
            : handlerError(`create failed: ${msg ?? String(e)}`);
        }
        changed(p.path, "created");
        return { ok: true, path: p.path, created: true };
      },
    },
    {
      kind: "bridge",
      id: "files.createDirectory",
      description:
        "create a directory (recursive); params: { path: absolute } -> { ok: true, path, created: boolean } + files.onFileNodeChanged",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const existed = await pathExists(fs, p.path);
        try {
          await fs.mkdir(p.path, { recursive: true });
        } catch (e) {
          return handlerError(`mkdir failed: ${(e as Error).message}`);
        }
        changed(p.path, "created");
        return { ok: true, path: p.path, created: !existed };
      },
    },
    {
      kind: "bridge",
      id: "files.renameEntry",
      description:
        "rename/move an entry (fs.rename); params: { path: absolute, to: absolute } -> { ok: true, path: from, to } + files.onFileNodeChanged(renamed)",
      schema: (p) =>
        validAbs(p?.path) && validAbs(p?.to)
          ? { ok: true }
          : { ok: false, message: "path and to must both be absolute paths" },
      handler: async (p) => {
        if (!validAbs(p?.path) || !validAbs(p?.to)) return badParams("path and to must both be absolute paths");
        if (!(await pathExists(fs, p.path))) return notFound(`not found: ${p.path}`);
        try {
          await fs.mkdir(dirname(p.to), { recursive: true });
          await fs.rename(p.path, p.to);
        } catch (e) {
          return handlerError(`rename failed: ${(e as Error).message}`);
        }
        changed(p.path, "renamed", p.to);
        return { ok: true, path: p.path, to: p.to };
      },
    },
    {
      kind: "bridge",
      id: "files.moveEntry",
      description:
        "move an entry (fs.rename); params: { path: absolute, to: absolute } -> { ok: true, path, to } + files.onFileNodeChanged(renamed)",
      schema: (p) =>
        validAbs(p?.path) && validAbs(p?.to)
          ? { ok: true }
          : { ok: false, message: "path and to must both be absolute paths" },
      handler: async (p) => {
        if (!validAbs(p?.path) || !validAbs(p?.to)) return badParams("path and to must both be absolute paths");
        if (!(await pathExists(fs, p.path))) return notFound(`not found: ${p.path}`);
        try {
          await fs.mkdir(dirname(p.to), { recursive: true });
          await fs.rename(p.path, p.to);
        } catch (e) {
          return handlerError(`move failed: ${(e as Error).message}`);
        }
        changed(p.path, "renamed", p.to);
        return { ok: true, path: p.path, to: p.to };
      },
    },
    {
      kind: "bridge",
      id: "files.copyInto",
      description:
        "copy a file/dir into a destination directory (recursive); params: { source: absolute, dir: absolute } -> { ok: true, path: dest } + files.onFileNodeChanged",
      schema: (p) =>
        validAbs(p?.source) && validAbs(p?.dir)
          ? { ok: true }
          : { ok: false, message: "source and dir must both be absolute paths" },
      handler: async (p) => {
        if (!validAbs(p?.source) || !validAbs(p?.dir)) return badParams("source and dir must both be absolute paths");
        if (!(await pathExists(fs, p.source))) return notFound(`not found: ${p.source}`);
        const dest = join(p.dir, basename(p.source));
        try {
          await fs.mkdir(p.dir, { recursive: true });
          await fs.cp(p.source, dest, { recursive: true, force: false, errorOnExist: false });
        } catch (e) {
          return handlerError(`copy failed: ${(e as Error).message}`);
        }
        changed(dest, "created");
        return { ok: true, path: dest };
      },
    },
    {
      kind: "bridge",
      id: "files.trashEntry",
      description:
        "move an entry to a `.autumn-trash/<name>-<ts>` sibling (in-tree trash; shell.trashItem is not available); params: { path: absolute } -> { ok: true, path: trashPath } + files.onFileNodeChanged(deleted)",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        if (!(await pathExists(fs, p.path))) return notFound(`not found: ${p.path}`);
        const trashDir = join(dirname(p.path), ".autumn-trash");
        const trashPath = join(trashDir, `${basename(p.path)}.${now()}`);
        try {
          await fs.mkdir(trashDir, { recursive: true });
          await fs.rename(p.path, trashPath);
        } catch (e) {
          return handlerError(`trash failed: ${(e as Error).message}`);
        }
        changed(p.path, "deleted", trashPath);
        return { ok: true, path: trashPath };
      },
    },
    {
      kind: "bridge",
      id: "files.removeFolder",
      description:
        "remove a directory recursively (REAL delete); params: { path: absolute } -> { ok: true, removed: true } + files.onFileNodeChanged(deleted); refuses filesystem root and $HOME",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const norm = normalize(p.path);
        if (norm === "/" || norm === process.env.HOME || norm === tmpdir()) {
          return badParams("refusing to delete a filesystem root / home / tmp directory");
        }
        const st = await statOrNull(p.path);
        if (!st) return notFound(`not found: ${p.path}`);
        if (!st.isDirectory()) return badParams("path is not a directory");
        try {
          await fs.rm(p.path, { recursive: true, force: true });
        } catch (e) {
          return handlerError(`remove failed: ${(e as Error).message}`);
        }
        changed(p.path, "deleted");
        return { ok: true, removed: true };
      },
    },
    {
      kind: "bridge",
      id: "files.revealEntry",
      description:
        "reveal an entry in the OS file manager; params: { path: absolute } -> { ok: true, path } | not-found when the path does not exist",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        if (!(await pathExists(fs, p.path))) return notFound(`not found: ${p.path}`);
        shell.showItemInFolder(p.path);
        return { ok: true, path: p.path };
      },
    },
    {
      kind: "bridge",
      id: "files.openIn",
      description:
        "open a path with the OS default app (shell.openPath; choosing an app is target-specific and unsupported in autumn); params: { path: absolute, app?: string (ignored, documented) } -> { ok: true, path } | not-found when missing",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        if (!(await pathExists(fs, p.path))) return notFound(`not found: ${p.path}`);
        try {
          await shell.openPath(p.path);
        } catch (e) {
          return handlerError(`open failed: ${(e as Error).message}`);
        }
        return { ok: true, path: p.path };
      },
    },
    {
      kind: "bridge",
      id: "files.pathForFile",
      description:
        "normalise a renderer file path; params: { path: absolute (no NUL) } -> { path: normalized } | bad-params otherwise",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute, no NUL)" }),
      handler: (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute, no NUL)");
        return { path: normalize(p.path) };
      },
    },
    {
      kind: "bridge",
      id: "files.assetPath",
      description:
        "resolve an asset path inside a base directory (traversal-safe); params: { dir?: absolute (default cwd), name: string (plain filename, subdirs allowed) } -> { path }",
      schema: (p) =>
        (p?.dir === undefined || validAbs(p.dir)) && typeof p?.name === "string" && p.name.length > 0 && !p.name.includes("\0")
          ? { ok: true }
          : { ok: false, message: "dir must be absolute when given; name must be a non-empty string" },
      handler: (p) => {
        if ((p?.dir !== undefined && !validAbs(p.dir)) || typeof p?.name !== "string" || p.name.length === 0) {
          return badParams("dir must be absolute when given; name must be a non-empty string");
        }
        const dir = (p.dir as string | undefined) ?? process.cwd();
        const path = childOf(dir, p.name);
        if (!path) return badParams("name escapes the base directory");
        return { path };
      },
    },

    // ---------------- editor / buffer lifecycle (honest minimal) ----------------
    {
      kind: "bridge",
      id: "files.editorIdentity",
      description:
        "identity of a file for editor buffering (derived from stat, not a buffer registry); params: { path: absolute } -> { path, mtimeMs, size, changeId } | not-found",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st || !st.isFile()) return notFound(`not found: ${p.path}`);
        return { path: p.path, mtimeMs: st.mtimeMs, size: st.size, changeId: `${st.mtimeMs.toFixed(0)}-${st.size}` };
      },
    },
    {
      kind: "bridge",
      id: "files.mutationIdentity",
      description:
        "mutation token for a file (stat-derived); params: { path: absolute } -> { path, changeId } | not-found (same shape as editorIdentity, autumn has no buffer registry)",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st) return notFound(`not found: ${p.path}`);
        return { path: p.path, changeId: `${st.mtimeMs.toFixed(0)}-${st.size}` };
      },
    },
    {
      kind: "bridge",
      id: "files.openFileNode",
      description:
        "open a file node: verifies existence and returns a file ref (autumn has no editor-buffer registry); params: { path: absolute } -> { path, ref, size, mtimeMs } | not-found",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st) return notFound(`not found: ${p.path}`);
        return { path: p.path, ref: `ref-${now().toString(36)}-${randomUUID().slice(0, 8)}`, size: st.size, mtimeMs: st.mtimeMs };
      },
    },
    {
      kind: "bridge",
      id: "files.releaseFileNode",
      description:
        "release a file node — documented no-op (autumn holds no buffer state); params: { path: absolute } -> { ok: true }",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "files.closeBufferChoice",
      description:
        "answer the 'unsaved buffer' choice dialog — documented no-op (autumn tracks no dirty-buffer state); params: { path?: absolute, choice?: string } -> { ok: true }",
      schema: () => ({ ok: true }),
      handler: () => ({ ok: true }),
    },
    {
      kind: "bridge",
      id: "files.openTargets",
      description:
        "list apps that can open a file; autumn has only the OS default app, so params: { path?: absolute } -> { targets: [{ id: 'default', name: 'Default application' }] }",
      schema: (p) => (p?.path === undefined || validAbs(p.path) ? { ok: true } : { ok: false, message: "path must be absolute when given" }),
      handler: (p) => {
        if (p?.path !== undefined && !validAbs(p.path)) return badParams("path must be absolute when given");
        // Only one honest target exists: the OS default handler (shell.openPath).
        return { targets: [{ id: "default", name: "Default application" }] };
      },
    },
    {
      kind: "bridge",
      id: "files.ensureCanvasDesign",
      description:
        "ensure the canvas design directory exists (created recursively when missing); params: { path: absolute } -> { dir, created } | bad-params",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const existed = await pathExists(fs, p.path);
        try {
          await fs.mkdir(p.path, { recursive: true });
        } catch (e) {
          return handlerError(`mkdir failed: ${(e as Error).message}`);
        }
        return { dir: p.path, created: !existed };
      },
    },

    // ---------------- documents ----------------
    {
      kind: "bridge",
      id: "files.readDocument",
      description:
        "read a JSON document; params: { path: absolute } -> { path, document } | not-found | bad-params (invalid JSON)",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st || st.isDirectory()) return notFound(`not found: ${p.path}`);
        let raw: string;
        try {
          raw = await fs.readFile(p.path, "utf8");
        } catch (e) {
          return handlerError(`read failed: ${(e as Error).message}`);
        }
        try {
          return { path: p.path, document: JSON.parse(raw) };
        } catch {
          return badParams("document is not valid JSON");
        }
      },
    },
    {
      kind: "bridge",
      id: "files.writeDocument",
      description:
        "write a JSON document (pretty-printed); params: { path: absolute, document: any JSON value } -> { ok: true, path, bytes } + files.onFileNodeChanged",
      schema: (p) =>
        validAbs(p?.path) && p?.document !== undefined
          ? { ok: true }
          : { ok: false, message: "path (absolute) and document are required" },
      handler: async (p) => {
        if (!validAbs(p?.path) || p?.document === undefined) {
          return badParams("path (absolute) and document are required");
        }
        let serialized: string;
        try {
          serialized = JSON.stringify(p.document, null, 2);
        } catch {
          return badParams("document is not JSON-serialisable");
        }
        const existed = await pathExists(fs, p.path);
        try {
          await fs.mkdir(dirname(p.path), { recursive: true });
          await fs.writeFile(p.path, serialized, "utf8");
        } catch (e) {
          return handlerError(`write failed: ${(e as Error).message}`);
        }
        changed(p.path, existed ? "modified" : "created");
        return { ok: true, path: p.path, bytes: Buffer.byteLength(serialized, "utf8") };
      },
    },

    // ---------------- assets / library ----------------
    {
      kind: "bridge",
      id: "files.readImageThumbnail",
      description:
        "read an image thumbnail; autumn has no thumbnail pipeline, so params: { path: absolute } -> { path, exists, thumbnail: null } | not-found",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st || !st.isFile()) return notFound(`not found: ${p.path}`);
        return { path: p.path, exists: true, thumbnail: null, note: "no thumbnail pipeline in autumn — original file only" };
      },
    },
    {
      kind: "bridge",
      id: "files.readAssetThumbnail",
      description:
        "read an asset thumbnail; autumn has no thumbnail pipeline, so params: { path: absolute } -> { path, exists, thumbnail: null } | not-found",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st || !st.isFile()) return notFound(`not found: ${p.path}`);
        return { path: p.path, exists: true, thumbnail: null, note: "no thumbnail pipeline in autumn — original file only" };
      },
    },
    {
      kind: "bridge",
      id: "files.readProjectThumbnail",
      description:
        "read a project thumbnail; autumn has no thumbnail pipeline, so params: { path: absolute } -> { path, exists, thumbnail: null } | not-found",
      schema: (p) => (validAbs(p?.path) ? { ok: true } : { ok: false, message: "path required (absolute)" }),
      handler: async (p) => {
        if (!validAbs(p?.path)) return badParams("path required (absolute)");
        const st = await statOrNull(p.path);
        if (!st || !st.isFile()) return notFound(`not found: ${p.path}`);
        return { path: p.path, exists: true, thumbnail: null, note: "no thumbnail pipeline in autumn — original file only" };
      },
    },
    {
      kind: "bridge",
      id: "files.importAssets",
      description:
        "copy all regular files from a source dir into a target dir; params: { sourceDir: absolute, targetDir: absolute } -> { imported: number, paths: string[] } | not-found (missing sourceDir)",
      schema: (p) =>
        validAbs(p?.sourceDir) && validAbs(p?.targetDir)
          ? { ok: true }
          : { ok: false, message: "sourceDir and targetDir must both be absolute paths" },
      handler: async (p) => {
        if (!validAbs(p?.sourceDir) || !validAbs(p?.targetDir)) return badParams("sourceDir and targetDir must both be absolute paths");
        const st = await statOrNull(p.sourceDir);
        if (!st || !st.isDirectory()) return notFound(`source directory not found: ${p.sourceDir}`);
        await fs.mkdir(p.targetDir, { recursive: true });
        const paths: string[] = [];
        for (const entry of await fs.readdir(p.sourceDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const dest = join(p.targetDir, entry.name);
          try {
            await fs.copyFile(join(p.sourceDir, entry.name), dest);
            paths.push(dest);
            changed(dest, "created");
          } catch {
            /* skip unreadable files — the count reports what actually landed */
          }
        }
        return { imported: paths.length, paths };
      },
    },
    {
      kind: "bridge",
      id: "files.importFolder",
      description:
        "recursively copy a folder into targetDir; params: { source: absolute, targetDir: absolute } -> { ok: true, path, count } | not-found (missing source)",
      schema: (p) =>
        validAbs(p?.source) && validAbs(p?.targetDir)
          ? { ok: true }
          : { ok: false, message: "source and targetDir must both be absolute paths" },
      handler: async (p) => {
        if (!validAbs(p?.source) || !validAbs(p?.targetDir)) return badParams("source and targetDir must both be absolute paths");
        const st = await statOrNull(p.source);
        if (!st || !st.isDirectory()) return notFound(`source directory not found: ${p.source}`);
        const dest = join(p.targetDir, basename(p.source));
        try {
          await fs.mkdir(p.targetDir, { recursive: true });
          await fs.cp(p.source, dest, { recursive: true });
        } catch (e) {
          return handlerError(`import failed: ${(e as Error).message}`);
        }
        changed(dest, "created");
        const walked = await walk(fs, dest, WALK_MAX_DEPTH, 10000);
        return { ok: true, path: dest, count: walked.filter((i) => i.type === "file").length };
      },
    },
    {
      kind: "bridge",
      id: "files.materializeAssets",
      description:
        "write inline asset contents to disk; params: { dir: absolute, assets: [{ name: plain filename, content: string }] } -> { materialized: number, paths: string[] }",
      schema: (p) =>
        validAbs(p?.dir) && Array.isArray(p?.assets) && p.assets.every((a: any) => validName(a?.name) && typeof a?.content === "string")
          ? { ok: true }
          : { ok: false, message: "dir required (absolute); assets must be [{ name (plain filename), content (string) }]" },
      handler: async (p) => {
        if (!validAbs(p?.dir) || !Array.isArray(p?.assets) || !p.assets.every((a: any) => validName(a?.name) && typeof a?.content === "string")) {
          return badParams("dir required (absolute); assets must be [{ name (plain filename), content (string) }]");
        }
        await fs.mkdir(p.dir, { recursive: true });
        const paths: string[] = [];
        for (const a of p.assets as Array<{ name: string; content: string }>) {
          const dest = join(p.dir, a.name);
          await fs.writeFile(dest, a.content, "utf8");
          paths.push(dest);
          changed(dest, "created");
        }
        return { materialized: paths.length, paths };
      },
    },
    {
      kind: "bridge",
      id: "files.addToLibrary",
      description:
        "add assets to the library; autumn has no asset-library store, so params: { paths?: string[] } -> { supported: false, added: 0, reason } (well-formed empty, never a fake success)",
      schema: (p) =>
        p?.paths === undefined || (Array.isArray(p.paths) && p.paths.every((x: unknown) => typeof x === "string"))
          ? { ok: true }
          : { ok: false, message: "paths must be an array of strings when given" },
      handler: (p) => {
        if (p?.paths !== undefined && !Array.isArray(p.paths)) return badParams("paths must be an array of strings when given");
        // No asset-library backing in autumn — an honest empty result so the UI degrades.
        return { supported: false, added: 0, reason: "autumn has no asset-library store" };
      },
    },
    {
      kind: "bridge",
      id: "files.saveAttachment",
      description:
        "save an attachment; params: { dir: absolute, name: plain filename, content: string, encoding?: 'utf8'|'base64' (default utf8) } -> { ok: true, path, bytes } + files.onFileNodeChanged",
      schema: (p) =>
        validAbs(p?.dir) && validName(p?.name) && typeof p?.content === "string" &&
        (p?.encoding === undefined || p.encoding === "utf8" || p.encoding === "base64")
          ? { ok: true }
          : { ok: false, message: "dir (absolute), name (plain filename), content (string); encoding utf8|base64 when given" },
      handler: async (p) => {
        if (!validAbs(p?.dir) || !validName(p?.name) || typeof p?.content !== "string") {
          return badParams("dir (absolute), name (plain filename), content (string) are required");
        }
        const encoding = p.encoding === "base64" ? "base64" : "utf8";
        await fs.mkdir(p.dir, { recursive: true });
        const dest = join(p.dir, p.name);
        try {
          await fs.writeFile(dest, p.content, encoding);
        } catch (e) {
          return handlerError(`save failed: ${(e as Error).message}`);
        }
        changed(dest, "created");
        const st = await statOrNull(dest);
        return { ok: true, path: dest, bytes: st?.size ?? 0 };
      },
    },
    {
      kind: "bridge",
      id: "files.scaffoldScreen",
      description:
        "scaffold a screen directory with a minimal component; params: { dir: absolute, name?: string } -> { ok: true, dir, files: string[] } + files.onFileNodeChanged",
      schema: (p) => (validAbs(p?.dir) && (p?.name === undefined || typeof p.name === "string") ? { ok: true } : { ok: false, message: "dir required (absolute); name must be a string when given" }),
      handler: async (p) => {
        if (!validAbs(p?.dir)) return badParams("dir required (absolute)");
        if (p?.name !== undefined && typeof p.name !== "string") return badParams("name must be a string when given");
        const name = slug(typeof p?.name === "string" && p.name ? p.name : "screen");
        const dir = join(p.dir, name);
        const component = name.charAt(0).toUpperCase() + name.slice(1);
        const files = [
          join(dir, "Screen.tsx"),
          join(dir, "README.md"),
        ];
        try {
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            files[0],
            `export default function ${component}Screen() {\n  return (\n    <main>\n      <h1>${component}</h1>\n    </main>\n  );\n}\n`,
            "utf8",
          );
          await fs.writeFile(files[1], `# ${component}\n\nScaffolded by autumn.\n`, "utf8");
        } catch (e) {
          return handlerError(`scaffold failed: ${(e as Error).message}`);
        }
        for (const f of files) changed(f, "created");
        return { ok: true, dir, files };
      },
    },
  ];

  return handlers;
}
