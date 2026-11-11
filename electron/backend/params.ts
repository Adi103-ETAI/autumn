// autumn — shared param normalization for Wave-2 handler modules.
//
// The TARGET's renderer calls positionally (`signIn(email, password)`,
// `video.bgm(input, bgmPath)`, `phone.decide(intentId, decision)`); autumn's
// own UI passes objects; the preload facade packs multi-arg calls as
// {args:[...]}. paramsOf() accepts ALL three shapes so handlers can read
// either style. (auth.ts/agentAccounts.ts predate this module and carry
// identical local copies — left untouched to avoid churn on green tests.)

export function paramsOf(params: unknown): { pos: unknown[]; obj: Record<string, unknown> } {
  if (Array.isArray(params)) return { pos: params, obj: {} };
  if (params === null || params === undefined) return { pos: [], obj: {} };
  if (typeof params !== "object") return { pos: [params], obj: {} }; // string/number/boolean single arg
  const o = params as Record<string, unknown>;
  if (Array.isArray(o.args)) {
    const { args, ...rest } = o;
    return { pos: args, obj: rest };
  }
  return { pos: [], obj: o };
}

/** First non-empty string among the candidates (object keys first, then positional). */
export function str(obj: Record<string, unknown>, pos: unknown[], ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  for (const v of pos) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** First defined value among object keys, else positional at index. */
export function pick(obj: Record<string, unknown>, pos: unknown[], key: string, posIndex?: number): unknown {
  if (obj[key] !== undefined) return obj[key];
  if (posIndex !== undefined) return pos[posIndex];
  return undefined;
}

/**
 * Object-only string read. Unlike str() this NEVER scans positional args, so
 * it is the right helper for any parameter BEYOND the first positional one
 * (`bgm(input, audioPath)`, `decide(intentId, decision)`, `speak(text, …)`) —
 * str() would return pos[0] for every key.
 */
export function ostr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Lazily load the real Electron API. Returns null in headless tests (where
 * require("electron") resolves to the binary-path string, not the API) so
 * handlers can report an honest {supported:false} instead of crashing.
 */
export function lazyElectron(): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const e = require("electron");
    return e && typeof e === "object" ? e : null;
  } catch {
    return null;
  }
}

/**
 * Find an executable on PATH (agentAccounts.ts carries an identical local
 * copy — left untouched). Returns the absolute path or null when absent, so
 * callers can gate a subprocess behind an honest {supported:false, reason}.
 */
export function resolveBin(name: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { accessSync, constants } = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, delimiter } = require("node:path");
  const pathVar = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const candidates: string[] =
    process.platform === "win32"
      ? [name, ...exts.map((e) => name + e.toLowerCase()), ...exts.map((e) => name + e)]
      : [name];
  const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const cand of candidates) {
      const p = join(dir, cand);
      try {
        accessSync(p, mode);
        return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/**
 * autumn's projects root (slides/remotion/deck folders live here).
 * Default ~/Autumn — a visible, cross-platform user folder (the target used
 * ~/October); AUTUMN_PROJECTS_DIR overrides it for headless tests.
 */
export function projectsRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("node:os");
  const root = process.env.AUTUMN_PROJECTS_DIR || path.join(os.homedir(), "Autumn");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").mkdirSync(root, { recursive: true });
    return root;
  } catch {
    const fallback = path.join(os.tmpdir(), "Autumn");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

/**
 * Ownership check, ported from the RE'd isOctoberOwnedFolder: resolve the
 * nearest EXISTING ancestor (a not-yet-created child of an owned folder counts
 * when the parent exists below the root), realpath both sides, prefix-match.
 */
export function isOwnedFolder(folder: unknown): folder is string {
  if (!folder || typeof folder !== "string") return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs");
  try {
    let candidate = path.resolve(folder);
    let depthBelowExisting = 0;
    while (!fs.existsSync(candidate)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
      depthBelowExisting++;
    }
    const real = fs.realpathSync.native(candidate);
    const root = fs.realpathSync.native(projectsRoot());
    if (real.startsWith(root + path.sep)) return true;
    return real === root && depthBelowExisting > 0;
  } catch {
    return false;
  }
}
