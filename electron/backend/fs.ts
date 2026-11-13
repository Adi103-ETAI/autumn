// autumn — Wave-3 handlers: fs (12 ids; the whole-machine finder).
//
// The contract (docs/architecture/finder.md):
//
//   fs:places          → the Home/Desktop/Documents/Downloads places that
//                        really exist, plus the project folder
//   fs:browse          → the listing of ONE directory
//                        {path, entries:[{name, path, isDirectory, size?, updatedAt}]}
//                        directories first, then the name (case-insensitive)
//   fs:preview         → {kind:"text"|"image"|"binary", ...}
//                        text: the first 1 MB; a NUL byte in the first 8 KB
//                        means binary; images come back as a data URL (≤ 6 MB)
//   fs:search          → the name matches AND the content matches (ripgrep,
//                        `-F -i -n`, max 5 hits per file), merged, ≤ 200 hits
//   fs:reveal          → show the item in the OS file manager
//   fs:open            → open the item with the OS (shell.openPath)
//   fs:rename          → rename in place; the new name may not contain a
//                        separator, and the destination must not exist
//   fs:move            → move into a folder; collisions and failures are
//                        reported, never silent
//   fs:copy-into       → copy into a folder (directories recurse)
//   fs:trash           → the OS trash
//   fs:mkdir           → a new folder inside an existing one
//
// The runs the reads in a utility-process worker ("fs-browse-worker.js")
// so a huge walk never blocks the main process. autumn keeps the same
// semantics and the same bounds, and runs the reads with the async node:fs
// API (so the main process stays responsive); the content search really runs
// `rg` in its own child process, exactly like the .
//
// The bounds (kept): MAX_DIR_ENTRIES 10 000, MAX_SEARCH_HITS 200,
// MAX_SEARCH_WALK 20 000, MAX_TEXT_BYTES 1 MB, MAX_IMAGE_BYTES 6 MB.

import { spawn as nodeSpawn } from "node:child_process";
import { constants as FS_CONSTANTS, existsSync, mkdirSync, renameSync, statSync, copyFileSync, unlinkSync, cpSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";

// ---------------------------------------------------------------------------
// the bounds
// ---------------------------------------------------------------------------

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const MAX_TEXT_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 6_000_000;
const MAX_DIR_ENTRIES = 10_000;
const MAX_SEARCH_HITS = 200;
const MAX_SEARCH_WALK = 20_000;
/** The folders the search never descends into (the list). */
const SEARCH_SKIP = new Set(["node_modules", ".git", "Library", ".Trash", "Pods"]);

/** Deliberate bad-input envelope — never throw for user input. */
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

/**
 * Sanitize a renderer-supplied file path: non-empty string, no NUL bytes and
 * absolute -> lexically normalized; anything else -> null (caller returns
 * bad-params). No fs access: sanitizing does not require the file to exist.
 */
export function sanitizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.includes("\0")) return null;
  if (!isAbsolute(raw)) return null;
  return normalize(raw);
}

/** Schema twin of sanitizePath so the registry rejects bad input before dispatch. */
const absPathSchema = (p: Record<string, any>) =>
  sanitizePath(p?.path) ? { ok: true as const } : { ok: false, message: "path required (absolute string)" };

/** The `assertAbs` — an absolute path is required. */
function assertAbs(p: unknown): string {
  if (typeof p !== "string" || !p.length || !isAbsolute(p)) throw new Error("An absolute path is required");
  return p;
}

/** The `safeName` — a single path segment, never "." or "..". */
export function safeName(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n || n === "." || n === ".." || n.includes("/") || n.includes("\\")) throw new Error("Invalid name");
  return n;
}

// ---------------------------------------------------------------------------
// the finder's operations (the local ones)
// ---------------------------------------------------------------------------

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
}

/** One directory listing (the `fsBrowseLocal`). */
export async function browseLocal(dirPath: unknown, opts?: { showHidden?: boolean }): Promise<{ path: string; entries: BrowseEntry[] }> {
  const dir = typeof dirPath === "string" && dirPath && isAbsolute(dirPath) ? dirPath : homedir();
  let st;
  try {
    st = await stat(dir);
  } catch {
    throw new Error("Not a directory");
  }
  if (!st.isDirectory()) throw new Error("Not a directory");
  let raw;
  try {
    raw = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Can't read this folder: ${e instanceof Error ? e.message : String(e)}`);
  }
  const showHidden = opts?.showHidden ?? false;
  const visible = raw.filter((entry) => showHidden || !entry.name.startsWith(".")).slice(0, MAX_DIR_ENTRIES);
  const entries: BrowseEntry[] = [];
  for (const entry of visible) {
    const full = join(dir, entry.name);
    const isDirectory = entry.isDirectory();
    try {
      const s = await stat(full);
      entries.push({
        name: entry.name,
        path: full,
        isDirectory,
        ...(isDirectory ? {} : { size: s.size }),
        updatedAt: new Date(s.mtimeMs).toISOString(),
      });
    } catch {
      entries.push({ name: entry.name, path: full, isDirectory });
    }
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return { path: dir, entries };
}

/** A file preview (the `fsPreviewLocal`). */
export async function previewLocal(filePath: unknown): Promise<Record<string, unknown>> {
  const abs = assertAbs(filePath);
  let fileStat;
  try {
    fileStat = await stat(abs);
  } catch {
    throw new Error("Not a file");
  }
  if (fileStat.isDirectory()) throw new Error("Not a file");
  const ext = abs.slice(abs.lastIndexOf(".") + 1).toLowerCase();
  const size = fileStat.size;
  if (IMAGE_EXT.has(ext)) {
    if (size > MAX_IMAGE_BYTES) return { kind: "binary", size, ext };
    const mime = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const data = await readFile(abs);
    return { kind: "image", dataUrl: `data:${mime};base64,${data.toString("base64")}` };
  }
  const handle = await readFile(abs);
  const buf = handle.subarray(0, Math.min(size, MAX_TEXT_BYTES));
  if (buf.subarray(0, 8_000).includes(0)) return { kind: "binary", size, ext };
  return { kind: "text", content: buf.toString("utf8"), truncated: size > MAX_TEXT_BYTES, ext };
}

export interface SearchHit {
  path: string;
  name: string;
  isDirectory: boolean;
  line?: number;
  snippet?: string;
}

/** The name-match half of the search (the `nameSearch`). */
async function nameSearch(rootDir: string, query: string, showHidden: boolean, isCurrent: () => boolean): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  let visited = 0;
  const pending = [rootDir];
  while (isCurrent() && pending.length && hits.length < MAX_SEARCH_HITS && visited < MAX_SEARCH_WALK) {
    const dir = pending.shift() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_SEARCH_HITS || visited >= MAX_SEARCH_WALK) break;
      visited++;
      if (!showHidden && entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.name.toLowerCase().includes(q)) {
        hits.push({ path: full, name: entry.name, isDirectory: entry.isDirectory() });
      }
      if (entry.isDirectory() && !SEARCH_SKIP.has(entry.name)) pending.push(full);
    }
  }
  return hits;
}

/** The content-match half of the search (the `ripgrep`). */
function ripgrep(
  rootDir: string,
  query: string,
  showHidden: boolean,
  isCurrent: () => boolean,
  spawnFn: (command: string, args: string[]) => ChildProcLike = (command, args) =>
    nodeSpawn(command, args) as unknown as ChildProcLike,
): Promise<SearchHit[]> {
  return new Promise((resolvePromise) => {
    const args = ["-F", "-i", "-n", "--no-heading", "--color", "never", "-m", "5", "--max-columns", "300"];
    if (showHidden) args.push("--hidden");
    args.push("--", query, rootDir);
    let child: ChildProcLike;
    try {
      child = spawnFn("rg", args);
    } catch {
      resolvePromise([]);
      return;
    }
    child.on("error", () => resolvePromise([]));
    const hits: SearchHit[] = [];
    let buf = "";
    child.stdout?.on("data", (d: Buffer | string) => {
      if (!isCurrent()) {
        child.kill();
        return;
      }
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0 && hits.length < MAX_SEARCH_HITS) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const m = /^(.*?):(\d+):(.*)$/.exec(line);
        if (m) {
          hits.push({
            path: m[1],
            name: basename(m[1]),
            isDirectory: false,
            line: Number(m[2]),
            snippet: m[3].trim().slice(0, 200),
          });
        }
      }
      if (hits.length >= MAX_SEARCH_HITS) child.kill();
    });
    const timeout = setTimeout(() => child.kill(), 5_000);
    if (typeof (timeout as unknown as { unref?: () => void }).unref === "function") {
      (timeout as unknown as { unref: () => void }).unref();
    }
    child.on("exit", () => {
      clearTimeout(timeout);
      resolvePromise(isCurrent() ? hits : []);
    });
  });
}

/**
 * The whole-machine search (the `fsSearchLocal`): the name matches and
 * the content matches, merged by path. A new search for the same root
 * supersedes the running one (the generation counter).
 */
export async function searchLocal(
  rootDir: unknown,
  query: unknown,
  opts?: { showHidden?: boolean },
  generation?: () => boolean,
  spawnFn?: (command: string, args: string[]) => ChildProcLike,
): Promise<SearchHit[]> {
  const root = assertAbs(rootDir);
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return [];
  const showHidden = opts?.showHidden ?? false;
  const isCurrent = generation ?? (() => true);
  const [names, content] = await Promise.all([
    nameSearch(root, q, showHidden, isCurrent),
    ripgrep(root, q, showHidden, isCurrent, spawnFn),
  ]);
  if (!isCurrent()) return [];
  const byPath = new Map<string, SearchHit>();
  for (const hit of names) byPath.set(hit.path, hit);
  for (const hit of content) byPath.set(hit.path, hit);
  return [...byPath.values()].slice(0, MAX_SEARCH_HITS);
}

/** Move files into a folder (the `fsMoveLocal`). */
export function moveLocal(srcPaths: string[], destDir: unknown): { moved: number; collisions: string[]; failed: string[] } {
  const dir = assertAbs(destDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error("Destination is not a folder");
  const result = { moved: 0, collisions: [] as string[], failed: [] as string[] };
  for (const src of srcPaths) {
    try {
      const abs = assertAbs(src);
      const dest = join(dir, basename(abs));
      if (dest === abs) continue;
      if (existsSync(dest)) {
        result.collisions.push(basename(abs));
        continue;
      }
      if (statSync(abs).isDirectory() && (dir === abs || dir.startsWith(abs + "/"))) {
        result.failed.push(basename(abs));
        continue;
      }
      try {
        renameSync(abs, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EXDEV" && statSync(abs).isFile()) {
          copyFileSync(abs, dest, FS_CONSTANTS.COPYFILE_EXCL);
          unlinkSync(abs);
        } else throw e;
      }
      result.moved++;
    } catch {
      result.failed.push(basename(String(src)));
    }
  }
  return result;
}

/** Copy files into a folder (the `fsCopyIntoLocal`). */
export function copyIntoLocal(srcPaths: string[], destDir: unknown): { moved: number; collisions: string[]; failed: string[] } {
  const dir = assertAbs(destDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error("Destination is not a folder");
  const result = { moved: 0, collisions: [] as string[], failed: [] as string[] };
  for (const src of srcPaths) {
    try {
      const abs = assertAbs(src);
      const dest = join(dir, basename(abs));
      if (dest === abs) continue;
      if (existsSync(dest)) {
        result.collisions.push(basename(abs));
        continue;
      }
      if (statSync(abs).isDirectory()) {
        cpSync(abs, dest, { recursive: true, errorOnExist: true, force: false });
      } else {
        copyFileSync(abs, dest, FS_CONSTANTS.COPYFILE_EXCL);
      }
      result.moved++;
    } catch {
      result.failed.push(basename(String(src)));
    }
  }
  return result;
}

/**
 * Move a file to the OS trash. Electron's `shell.trashItem` is used when the
 * runtime provides it; otherwise the file is moved into the platform's trash
 * folder (Linux XDG trash / macOS ~/.Trash), which is the same thing the
 * file manager does. Windows without Electron reports honestly.
 */
export async function trashLocal(targetPaths: string[], shellTrash?: (p: string) => Promise<void>): Promise<{ trashed: number; failed: string[] }> {
  let trashed = 0;
  const failed: string[] = [];
  for (const p of targetPaths) {
    try {
      const abs = assertAbs(p);
      if (shellTrash) {
        await shellTrash(abs);
        trashed++;
        continue;
      }
      await moveToTrashFolder(abs);
      trashed++;
    } catch (e) {
      failed.push(String(p));
      void e;
    }
  }
  return { trashed, failed };
}

/** The platform's trash folder — null when there is none. */
export function trashFolder(): string | null {
  if (process.platform === "linux") {
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return join(dataHome, "Trash", "files");
  }
  if (process.platform === "darwin") return join(homedir(), ".Trash");
  return null; // Windows has no portable trash folder — Electron's shell does it.
}

/** Move a path into the platform's trash folder (the fallback for trashItem). */
async function moveToTrashFolder(abs: string): Promise<void> {
  const folder = trashFolder();
  if (!folder) throw new Error("This platform has no trash folder without the OS shell");
  mkdirSync(folder, { recursive: true });
  const name = basename(abs);
  let dest = join(folder, name);
  let n = 1;
  while (existsSync(dest)) {
    dest = join(folder, `${name}.${n}`);
    n++;
  }
  await rename(abs, dest);
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeFsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { shell, spawn: spawnDep } = deps;

  /** The search generation per root — a new search supersedes the old one. */
  const searchGenerations = new Map<string, number>();
  const nextGeneration = (root: string): (() => boolean) => {
    const generation = (searchGenerations.get(root) ?? 0) + 1;
    searchGenerations.set(root, generation);
    return () => searchGenerations.get(root) === generation;
  };

  // The content search uses the injected spawner, so the process is driven
  // the same way everywhere (and the test-suite can script it).
  const spawnRipgrep = (command: string, args: string[]): ChildProcLike =>
    spawnDep.spawn(command, args, {});

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "fs.places",
      description:
        "the finder places; params: { projectPath? } -> { places: [{name, path}] } — the Home/Desktop/Documents/Downloads folders that really exist, plus the project folder",
      handler: async (p) => {
        const home = homedir();
        const candidates = [
          { name: "Home", path: home },
          { name: "Desktop", path: join(home, "Desktop") },
          { name: "Documents", path: join(home, "Documents") },
          { name: "Downloads", path: join(home, "Downloads") },
        ];
        const places = candidates.filter((c) => existsSync(c.path));
        const projectPath = p?.projectPath;
        if (typeof projectPath === "string" && projectPath && isAbsolute(projectPath) && existsSync(projectPath)) {
          places.push({ name: `📁 ${basename(projectPath)}`, path: projectPath });
        }
        return { places };
      },
    },
    {
      kind: "bridge",
      id: "fs.browse",
      description:
        "list ONE directory of the finder; params: { path, showHidden? } -> { path, entries: [{name, path, isDirectory, size?, updatedAt}] } — directories first, then the name; the entry list is bounded",
      schema: (p) =>
        sanitizePath(p?.path)
          ? { ok: true }
          : { ok: false, message: "path required (absolute string)" },
      handler: async (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        try {
          return await browseLocal(path, { showHidden: p?.showHidden === true });
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.preview",
      description:
        "preview a file; params: { path } -> {kind:'text',content,truncated,ext} | {kind:'image',dataUrl} | {kind:'binary',size,ext} — a NUL byte in the first 8 KB means binary; the text is capped at 1 MB and the image at 6 MB",
      schema: absPathSchema,
      handler: async (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        try {
          return await previewLocal(path);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.search",
      description:
        "search the machine from a root folder; params: { path, query, showHidden? } -> [{path, name, isDirectory, line?, snippet?}] — the name matches AND the content matches (ripgrep), merged and bounded to 200 hits; a new search for the same root supersedes the running one",
      schema: (p) =>
        sanitizePath(p?.path) && typeof p?.query === "string"
          ? { ok: true }
          : { ok: false, message: "path (absolute string) and query required" },
      handler: async (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        if (typeof p?.query !== "string") return badParams("query required");
        try {
          return await searchLocal(
            path,
            p.query,
            { showHidden: p?.showHidden === true },
            nextGeneration(path),
            spawnRipgrep,
          );
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.reveal",
      description:
        "show a file in the OS file manager via shell.showItemInFolder; params: { path: absolute string } -> { path }",
      schema: absPathSchema,
      handler: (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        shell.showItemInFolder(path);
        return { path };
      },
    },
    {
      kind: "bridge",
      id: "fs.open",
      description:
        "open a file with the operating system; params: { path: absolute string } -> { path, opened: bool, error? } (the OS opens it; the OS's own error is reported back)",
      schema: absPathSchema,
      handler: async (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        try {
          const result = await shell.openPath(path);
          if (typeof result === "string" && result.length > 0) {
            return { path, opened: false, error: result };
          }
          return { path, opened: true };
        } catch (e) {
          return { path, opened: false, error: String((e as Error)?.message ?? e) };
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.rename",
      description:
        "rename a file or folder in place; params: { path, newName } -> { path: newPath } — the name may not contain a separator, and the destination must not exist",
      schema: (p) =>
        sanitizePath(p?.path) && typeof p?.newName === "string" && p.newName.length > 0
          ? { ok: true }
          : { ok: false, message: "path (absolute string) and newName required" },
      handler: async (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string)");
        let name: string;
        try {
          name = safeName(p?.newName);
        } catch (e) {
          return badParams(String((e as Error)?.message ?? e));
        }
        if (!existsSync(path)) return handlerError("Not found");
        const dest = join(dirname(path), name);
        if (existsSync(dest)) return handlerError("A file with that name already exists");
        try {
          await rename(path, dest);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { path: dest };
      },
    },
    {
      kind: "bridge",
      id: "fs.move",
      description:
        "move files or folders into another folder; params: { paths[], destDir } -> { moved, collisions[], failed[] } — the collisions and the failures are reported, never silent",
      schema: (p) =>
        Array.isArray(p?.paths) && sanitizePath(p?.destDir)
          ? { ok: true }
          : { ok: false, message: "paths[] and destDir (absolute string) required" },
      handler: async (p) => {
        const destDir = sanitizePath(p?.destDir);
        if (!destDir) return badParams("destDir required (absolute string)");
        if (!Array.isArray(p?.paths)) return badParams("paths[] required");
        try {
          return moveLocal(p.paths.map((x) => String(x)), destDir);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.copyInto",
      description:
        "copy files or folders into another folder; params: { paths[], destDir } -> { moved, collisions[], failed[] } (the source is never touched)",
      schema: (p) =>
        Array.isArray(p?.paths) && sanitizePath(p?.destDir)
          ? { ok: true }
          : { ok: false, message: "paths[] and destDir (absolute string) required" },
      handler: async (p) => {
        const destDir = sanitizePath(p?.destDir);
        if (!destDir) return badParams("destDir required (absolute string)");
        if (!Array.isArray(p?.paths)) return badParams("paths[] required");
        try {
          return copyIntoLocal(p.paths.map((x) => String(x)), destDir);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
    {
      kind: "bridge",
      id: "fs.trash",
      description:
        "move files to the OS trash; params: { paths[] } -> { trashed, failed[] } (the OS trash is used; the platform's trash folder is the fallback)",
      schema: (p) =>
        Array.isArray(p?.paths) ? { ok: true } : { ok: false, message: "paths[] required" },
      handler: async (p) => {
        if (!Array.isArray(p?.paths)) return badParams("paths[] required");
        const result = await trashLocal(
          p.paths.map((x) => String(x)),
          typeof shell.trashItem === "function" ? (path: string) => shell.trashItem!(path) : undefined,
        );
        return result;
      },
    },
    {
      kind: "bridge",
      id: "fs.mkdir",
      description:
        "create a folder inside an existing one; params: { parentDir, name } -> { path } — the name may not contain a separator, and the folder must not exist",
      schema: (p) =>
        sanitizePath(p?.parentDir) && typeof p?.name === "string" && p.name.length > 0
          ? { ok: true }
          : { ok: false, message: "parentDir (absolute string) and name required" },
      handler: async (p) => {
        const parentDir = sanitizePath(p?.parentDir);
        if (!parentDir) return badParams("parentDir required (absolute string)");
        let name: string;
        try {
          name = safeName(p?.name);
        } catch (e) {
          return badParams(String((e as Error)?.message ?? e));
        }
        if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
          return handlerError("Not a folder");
        }
        const dest = join(parentDir, name);
        if (existsSync(dest)) return handlerError("Already exists");
        try {
          await mkdir(dest);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { path: dest };
      },
    },
    {
      kind: "bridge",
      id: "fs.pathForFile",
      description:
        "sanitize a renderer-supplied file path; params: { path: string } (absolute, no NUL) -> { path: normalized }",
      schema: absPathSchema,
      handler: (p) => {
        const path = sanitizePath(p?.path);
        if (!path) return badParams("path required (absolute string, no NUL)");
        return { path };
      },
    },
  ];

  return handlers;
}
