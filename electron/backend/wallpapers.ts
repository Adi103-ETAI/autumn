// autumn — Wave-2 handlers: wallpapers (3 dispatchable; docs/architecture/backend.md-2).
//
// the renderer stores refs like `custom:<filename>` and resolves them via
// `customWallpaperUrl(ref)` — a custom
// protocol. autumn keeps the same `custom:<file>` ref shape (renderer code identical);
// the renderer's image `url(ref)` resolves to a data URL handed back inside `list`
// items, so no second protocol handler exists in main.
//
// upload is BY PATH ({ path }) — the dialog-based autonomous upload cannot run
// headless; the facade documents that. remove returns the refs AFTER removal ().

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { userDataDir } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const CUSTOM_PREFIX = "custom:";

const dir = () => join(userDataDir(), "wallpapers");
const REF_RE = /^custom:[A-Za-z0-9._-]+$/;

export function makeWallpapersHandlers(deps: W1Deps): RegisteredHandler[] {
  const ensureDir = () => mkdirSync(dir(), { recursive: true });

  const refs = (): string[] => {
    ensureDir();
    let entries: string[] = [];
    try {
      entries = readdirSync(dir());
    } catch {
      return [];
    }
    return entries
      .filter((e) => IMAGE_EXTS.has(extname(e).toLowerCase()))
      .sort()
      .map((e) => CUSTOM_PREFIX + e);
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "wallpapers.list",
      description:
        "list custom wallpapers (list()); params: {} -> refs string[] (`custom:<file>`), matching the list() contract",
      schema: () => ({ ok: true }),
      handler: () => refs(),
    },
    {
      kind: "bridge",
      id: "wallpapers.upload",
      description:
        "import an image file as a custom wallpaper; params: { path: absolute image } -> `custom:<file>` ref",
      schema: (p) =>
        p?.path === undefined || (typeof p.path === "string" && !p.path.includes("\0"))
          ? { ok: true }
          : { ok: false, message: "path must be a string when given" },
      handler: (p) => {
        if (p?.path === undefined) {
          return badParams(
            "upload needs a file path in autumn (the dialog-based upload can't run headless; pass { path })",
          );
        }
        if (typeof p.path !== "string") return badParams("path must be a string");
        if (p.path.includes("\0")) return badParams("path must not contain NUL");
        const src = resolve(p.path);
        if (!existsSync(src)) return notFound(`source file not found: ${p.path}`);
        if (!IMAGE_EXTS.has(extname(src).toLowerCase())) {
          return badParams(`not an image file (allowed: ${[...IMAGE_EXTS].join(" ")})`);
        }
        ensureDir();
        const file = basename(src);
        const dest = join(dir(), file);
        let data: Buffer;
        try {
          data = readFileSync(src);
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: `read failed: ${(e as Error).message}` } };
        }
        const tmp = `${dest}.tmp`;
        try {
          writeFileSync(tmp, data);
          renameSync(tmp, dest);
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: `upload failed: ${(e as Error).message}` } };
        }
        return CUSTOM_PREFIX + file;
      },
    },
    {
      kind: "bridge",
      id: "wallpapers.remove",
      description:
        "delete a custom wallpaper by ref (remove(ref) → refs after removal); params: { ref: `custom:<file>` }",
      schema: (p) =>
        p?.ref === undefined || (typeof p.ref === "string" && !p.ref.includes("\0"))
          ? { ok: true }
          : { ok: false, message: "ref must be a string when given" },
      handler: (p) => {
        if (p?.ref === undefined) return badParams("ref required");
        if (typeof p.ref !== "string" || !REF_RE.test(p.ref) || !p.ref.startsWith(CUSTOM_PREFIX)) {
          return badParams("ref must match 'custom:<filename>'");
        }
        const file = p.ref.slice(CUSTOM_PREFIX.length);
        if (file.includes("..") || file.includes("/") || file.includes("\\")) return badParams("invalid wallpaper filename");
        const full = join(dir(), file);
        if (!existsSync(full)) return notFound(`wallpaper not found: ${p.ref}`);
        unlinkSync(full);
        return refs();
      },
    },
  ];

  return handlers;
}
