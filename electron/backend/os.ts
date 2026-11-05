// autumn — Wave-1 handlers: clipboard (3) + find (3) + thumbnails (1); 7 renderer-used dispatchable (doc 31).
//
// Implements the 7 renderer-used bridge ids over the injected electron surfaces
// (deps.clipboard for clipboard.*, deps.screen for thumbnails.capture) and a
// small LOCAL file walk for find.* — autumn has NO search index backing, so
// find.recent/candidates/rank are an honest bounded walk/scorer over files the
// backend can actually stat (doc 31 §4), never a fake index.
// Registered by index.ts; do not edit shared files (w1-deps.ts, index.ts,
// handlers.ts, registry, manifest). Contract: every id must exist in
// electron/ipc/manifest.json bridge namespaces (conformance test enforces it).
// Envelope rules: plain payload on success (registry wraps {ok:true,result}),
// { ok:false, error:{ code, message } } for bad-params / not-found /
// not-implemented. No events: none of these handlers has a real trigger, so
// events.onBrowserFind is deliberately never emitted (doc 31 §3 — a fabricated
// event would be worse than none).

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { FsPromises, W1Deps } from "./w1-deps";

// ---------------------------------------------------------------------------
// Envelope helpers + shared param validation (doc 31 §2)
// ---------------------------------------------------------------------------

/** Deliberate bad-input envelope — never throw for user input. */
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/** Missing entity envelope (clipboard with no image, …). */
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

/** Genuinely unperformable operation envelope (doc 31 §4) — with a why. */
const notImplemented = (message: string) => ({
  ok: false as const,
  error: { code: "not-implemented" as const, message },
});

/** non-empty string — the floor for text/query params */
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
/** non-empty and NUL-free — enough to be a safe fs path / clipboard payload */
const isCleanString = (v: unknown): v is string => isNonEmptyString(v) && !v.includes("\0");
/** finite number >= 1 (limits, capture sizes) */
const isPositiveNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 1;

// ---------------------------------------------------------------------------
// find.* — bounded local walk (no search index; doc 31 §4 honest-minimal)
// ---------------------------------------------------------------------------

/** Files stat'ed per call — keeps the walk small and fast (tests stay quick). */
const WALK_MAX_FILES = 2000;
/** Nested directory levels below the root dir (the root itself is level 0). */
const WALK_MAX_DEPTH = 3;
const DEFAULT_LIMIT = 20;
const LIMIT_MAX = 100;

interface WalkEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * Breadth-first walk of `root` collecting regular files with mtime/size.
 * Bounded twice over: at most WALK_MAX_DEPTH nested levels and at most
 * WALK_MAX_FILES stat() attempts. Missing and unreadable directories are
 * SKIPPED (never thrown) so one bad dir cannot fail the whole query; symlinked
 * files are not followed or listed — only `dirent.isFile()` entries count.
 */
async function walkFiles(fs: FsPromises, root: string): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  let budget = WALK_MAX_FILES;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && budget > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const dirents = await fs.readdir(cur.dir, { withFileTypes: true }).catch(() => null);
    if (!dirents) continue; // missing / unreadable dir — skipped (doc 31 §4)
    for (const dirent of dirents) {
      if (budget <= 0) break;
      const full = join(cur.dir, dirent.name);
      if (dirent.isDirectory()) {
        if (cur.depth < WALK_MAX_DEPTH) queue.push({ dir: full, depth: cur.depth + 1 });
      } else if (dirent.isFile()) {
        budget -= 1;
        const st = await fs.stat(full).catch(() => null); // raced away -> skip
        if (st) out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }
  return out;
}

/** `dir` default = process.cwd() — homedir() would be far too big to walk. */
function resolveDir(v: unknown): string | null {
  if (v === undefined) return process.cwd();
  return isCleanString(v) ? v : null;
}

/** `limit` default 20, clamped to 1..100; non-number or < 1 -> null (bad-params). */
function resolveLimit(v: unknown): number | null {
  if (v === undefined) return DEFAULT_LIMIT;
  if (!isPositiveNumber(v)) return null;
  return Math.min(LIMIT_MAX, Math.floor(v));
}

/** Locale-independent path ordering (ties break deterministically). */
const byPathAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** find.rank `items`: an array of non-empty { path: string } (schema + handler agree). */
const validItems = (v: unknown): v is Array<{ path: string }> =>
  Array.isArray(v) &&
  v.every((it) => it && typeof it === "object" && isNonEmptyString((it as { path?: unknown }).path));

/**
 * Documented scoring heuristic — evaluated on the case-folded BASENAME and
 * shared by find.candidates and find.rank so they can never disagree:
 *   100 — exact basename match
 *    80 — basename starts with the query (prefix)
 *    60 — basename contains the query (substring)
 *     0 — no match (find.rank keeps these, sorted last; candidates filters them)
 * Ties sort by path ascending (code-unit order, locale independent).
 */
function scoreBasename(nameLower: string, queryLower: string): number {
  if (nameLower === queryLower) return 100;
  if (nameLower.startsWith(queryLower)) return 80;
  if (nameLower.includes(queryLower)) return 60;
  return 0;
}

/** Pure ranker: score every { path } item, best first. No fs access. */
function rankItems(
  query: string,
  items: Array<{ path: string }>,
): Array<{ path: string; score: number }> {
  const q = query.toLowerCase();
  return items
    .map((it) => ({ path: it.path, score: scoreBasename(basename(it.path).toLowerCase(), q) }))
    .sort((a, b) => b.score - a.score || byPathAsc(a.path, b.path));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function makeOsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { clipboard, screen, fs } = deps;

  // `dir`/`limit` schema shared by find.recent and find.candidates.
  const walkParamsSchema = (p: Record<string, any>) =>
    (p?.dir === undefined || isCleanString(p.dir)) &&
    (p?.limit === undefined || isPositiveNumber(p.limit))
      ? { ok: true as const }
      : { ok: false, message: "dir must be a non-empty string; limit must be a number >= 1 (max 100)" };

  const handlers: RegisteredHandler[] = [
    // ---------------- clipboard (electron.clipboard) ----------------
    {
      kind: "bridge",
      id: "clipboard.writeText",
      description:
        "write text to the OS clipboard; params: { text: non-empty string } -> { ok: true, length: number }",
      schema: (p) =>
        isNonEmptyString(p?.text)
          ? { ok: true }
          : { ok: false, message: "text required (non-empty string)" },
      handler: (p = {}) => {
        const text = p?.text;
        if (!isNonEmptyString(text)) return badParams("text required (non-empty string)");
        clipboard.writeText(text);
        // Plain payload: `ok:true` WITHOUT a `result` key is not an envelope
        // (envelope.js isEnvelope), so the registry wraps it as
        // { ok:true, result:{ ok:true, length } }.
        return { ok: true, length: text.length };
      },
    },
    {
      kind: "bridge",
      id: "clipboard.readText",
      description:
        "read text from the OS clipboard; params: {} -> { text: string } (\"\" when the clipboard holds no text)",
      handler: () => ({ text: clipboard.readText() }),
    },
    {
      kind: "bridge",
      id: "clipboard.readImagePath",
      description:
        "save the OS clipboard image as a PNG file; params: { path?: string } (explicit destination, else os.tmpdir()/autumn-clipboard-<uuid>.png; parent dir must exist) -> { path, exists: true } | not-found when no image is on the clipboard",
      schema: (p) =>
        p?.path === undefined || isCleanString(p.path)
          ? { ok: true }
          : { ok: false, message: "path must be a non-empty string without NUL when given" },
      handler: async (p = {}) => {
        const target = p?.path;
        if (target !== undefined && !isCleanString(target)) {
          return badParams("path must be a non-empty string without NUL when given");
        }
        const image = clipboard.readImage(); // real read of the OS clipboard
        if (!image) return notFound("no image on clipboard");
        const png = image.toPNG(); // real bytes from electron NativeImage.toPNG()
        // Default destination: os.tmpdir() + a per-call-unique name. An explicit
        // `path` is written instead (overwriting). A failed write surfaces as
        // handler-error via the registry — never as fake success.
        const dest = target ?? join(tmpdir(), `autumn-clipboard-${randomUUID()}.png`);
        await fs.writeFile(dest, png);
        const st = await fs.stat(dest); // `exists` is verified, not assumed
        return { path: dest, exists: st.isFile() };
      },
    },

    // ---------------- find (local bounded walk — no search index) ----------------
    {
      kind: "bridge",
      id: "find.recent",
      description:
        "recently-modified files under dir via a bounded walk (depth <= 3, <= 2000 files); params: { dir?: string (default process.cwd()), limit?: number (1-100, default 20) } -> { items: [{ path, mtimeMs, size }] } sorted mtime desc (missing dir -> { items: [] })",
      schema: walkParamsSchema,
      handler: async (p = {}) => {
        const dir = resolveDir(p?.dir);
        if (dir === null) return badParams("dir must be a non-empty string");
        const limit = resolveLimit(p?.limit);
        if (limit === null) return badParams("limit must be a number >= 1 (max 100)");
        const entries = await walkFiles(fs, dir); // missing dir -> [] (walk skips it)
        entries.sort((a, b) => b.mtimeMs - a.mtimeMs || byPathAsc(a.path, b.path));
        return { items: entries.slice(0, limit) };
      },
    },
    {
      kind: "bridge",
      id: "find.candidates",
      description:
        "basename substring search over the same bounded walk as find.recent; params: { query: non-empty string, dir?: string, limit?: number (1-100, default 20) } -> { items: [{ path, score }] } with score 100 exact / 80 prefix / 60 contains (case-insensitive)",
      schema: (p) =>
        isNonEmptyString(p?.query) && walkParamsSchema(p).ok
          ? { ok: true }
          : {
              ok: false,
              message:
                "query required (non-empty string); dir must be a non-empty string; limit must be a number >= 1",
            },
      handler: async (p = {}) => {
        if (!isNonEmptyString(p?.query)) return badParams("query required (non-empty string)");
        const dir = resolveDir(p?.dir);
        if (dir === null) return badParams("dir must be a non-empty string");
        const limit = resolveLimit(p?.limit);
        if (limit === null) return badParams("limit must be a number >= 1 (max 100)");
        const q = p.query.toLowerCase();
        const entries = await walkFiles(fs, dir);
        return {
          items: entries
            .map((e) => ({ path: e.path, score: scoreBasename(basename(e.path).toLowerCase(), q) }))
            .filter((e) => e.score > 0) // substring match only
            .sort((a, b) => b.score - a.score || byPathAsc(a.path, b.path))
            .slice(0, limit),
        };
      },
    },
    {
      kind: "bridge",
      id: "find.rank",
      description:
        "pure scoring helper (no fs access): rank explicit paths by basename match; params: { query: non-empty string, items?: [{ path }] } -> { items: [{ path, score }] } sorted by score desc (100 exact / 80 prefix / 60 contains / 0 none), ties by path asc (empty or missing items -> { items: [] })",
      schema: (p) =>
        isNonEmptyString(p?.query) && (p?.items === undefined || validItems(p.items))
          ? { ok: true }
          : { ok: false, message: "query required (non-empty string); items must be [{ path }] when given" },
      handler: (p = {}) => {
        if (!isNonEmptyString(p?.query)) return badParams("query required (non-empty string)");
        const raw = p.items;
        if (raw === undefined) return { items: [] };
        if (!validItems(raw)) return badParams("items must be an array of { path: non-empty string }");
        return { items: rankItems(p.query, raw) };
      },
    },

    // ---------------- thumbnails (electron desktopCapturer) ----------------
    {
      kind: "bridge",
      id: "thumbnails.capture",
      description:
        "capture the primary display as a PNG data-URL; params: { width?: number, height?: number } (positive numbers, advisory — injected screen.capture() takes no size arg, fixed 1280x720 desktop thumbnail) -> { dataUrl } | not-implemented when no display is available",
      schema: (p) =>
        (p?.width === undefined || isPositiveNumber(p.width)) &&
        (p?.height === undefined || isPositiveNumber(p.height))
          ? { ok: true }
          : { ok: false, message: "width/height must be positive numbers when given" },
      handler: async (p = {}) => {
        // Handler validates too (not just the registry schema) so direct calls
        // agree with dispatched ones (doc 31 §2).
        if (
          (p?.width !== undefined && !isPositiveNumber(p.width)) ||
          (p?.height !== undefined && !isPositiveNumber(p.height))
        ) {
          return badParams("width/height must be positive numbers when given");
        }
        // width/height are validated but NOT forwarded: W1Deps.screen.capture()
        // exposes no size parameter (index.ts realW1Deps asks desktopCapturer for
        // a fixed 1280x720 thumbnail). Documented in the description — the size
        // returned is whatever the injected capture produces; nothing is scaled
        // or fabricated here.
        const dataUrl = await screen.capture();
        if (typeof dataUrl === "string" && dataUrl.length > 0) return { dataUrl };
        // No display / headless: desktopCapturer returned no sources, so there
        // is genuinely nothing to capture — honest not-implemented, and NEVER
        // invented image bytes (doc 31 §4).
        return notImplemented(
          "screen capture unavailable: desktopCapturer returned no sources (headless / no display)",
        );
      },
    },
  ];

  return handlers;
}
