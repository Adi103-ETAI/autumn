// autumn — Wave-1 handlers: fs (12; 5 renderer-used: places/browse/open/reveal/pathForFile) (doc 31).
//
// Implements the 5 renderer-used fs bridge ids over node:os/node:fs/node:path
// plus the injected electron shell (deps.shell). Registered by index.ts; do not
// edit shared files (w1-deps.ts, index.ts, handlers.ts, registry, manifest).
// Contract: every id must exist in electron/ipc/manifest.json bridge namespaces
// (conformance test enforces it). Envelope rules: return a plain payload on
// success (registry wraps {ok:true,result}), or { ok: false, error: { code,
// message } } for bad-params; fs.browse returns the doc-31 §4 not-implemented
// envelope (native dialog cannot run headless — see comment there).

import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

/** Deliberate bad-input envelope (doc 31 §2) — never throw for user input. */
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/**
 * Sanitize a renderer-supplied file path: non-empty string, no NUL bytes and
 * absolute -> lexically normalized; anything else -> null (caller returns
 * bad-params). No fs access: sanitizing does not require the file to exist.
 */
function sanitizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.includes("\0")) return null;
  if (!isAbsolute(raw)) return null;
  return normalize(raw);
}

/** Schema twin of sanitizePath so the registry rejects bad input before dispatch. */
const absPathSchema = (p: Record<string, any>) =>
  sanitizePath(p?.path) ? { ok: true as const } : { ok: false, message: "path required (absolute string)" };

export function makeFsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { shell } = deps;

  // Common user dirs, derived from node:os — headless-safe (no Electron).
  // `exists` lets the renderer gray out dirs that are absent on this machine.
  const listPlaces = () => {
    const home = homedir();
    const specs: Array<[string, string]> = [
      ["home", home],
      ["desktop", join(home, "Desktop")],
      ["documents", join(home, "Documents")],
      ["downloads", join(home, "Downloads")],
      ["music", join(home, "Music")],
      ["pictures", join(home, "Pictures")],
      ["videos", join(home, "Videos")],
      ["temp", tmpdir()],
    ];
    return specs.map(([name, dir]) => ({ name, path: dir, exists: existsSync(dir) }));
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "fs.places",
      description:
        "list common user dirs; params: {} -> { places: [{ name, path, exists }] } (home/desktop/documents/downloads/music/pictures/videos/temp via node:os)",
      handler: () => ({ places: listPlaces() }),
    },
    {
      kind: "bridge",
      id: "fs.browse",
      description:
        "native pick-a-directory/file dialog; params: { title?: string } -> not-implemented envelope (native dialog is wired at the facade layer)",
      schema: (p) =>
        p?.title === undefined || typeof p.title === "string"
          ? { ok: true }
          : { ok: false, message: "title must be a string" },
      handler: (p) => {
        if (p?.title !== undefined && typeof p.title !== "string") {
          return badParams("title must be a string");
        }
        // Electron's dialog.showOpenDialog is wired at the facade layer; this
        // headless backend has no native dialog, so honestly report
        // not-implemented rather than fabricating a picked path (doc 31 §4).
        return {
          ok: false,
          error: {
            code: "not-implemented",
            message:
              "fs.browse requires a native dialog (Electron dialog.showOpenDialog, wired at the facade layer)",
          },
        };
      },
    },
    {
      kind: "bridge",
      id: "fs.open",
      description:
        "record the path the renderer just opened (last-opened echo); params: { path: non-empty string } -> { path }",
      schema: (p) =>
        typeof p?.path === "string" && p.path.length > 0
          ? { ok: true }
          : { ok: false, message: "path required (non-empty string)" },
      handler: (p) => {
        const raw = p?.path;
        if (typeof raw !== "string" || raw.length === 0) {
          return badParams("path required (non-empty string)");
        }
        return { path: raw }; // plain payload — registry wraps { ok: true, result }
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
