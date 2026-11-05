// autumn — Wave-2 handlers: update (2 dispatchable + events.onUpdate push; doc 32 §W2-3).
//
// RE-derived (06-native-and-packaging.md §3): electron-updater autoUpdater with
// autoDownload=false, autoInstallOnAppQuit=true; GitHub-Releases provider via
// resources/app-update.yml; init skipped entirely when !app.isPackaged →
// status "unsupported". IPC: update:state / update:start / update:install /
// update:check. State shape: { status, currentVersion, forced, minimumVersion,
// message, version, progress, error } with status ∈ idle|checking|available|
// downloading|downloaded|error|unsupported.
//
// autumn adaptation (NOT the target's remote policy feed): the only minimum-
// version floor is DEFINED IN APP (minimumVersion in app-update.yml) — no
// Supabase call. The GitHub Releases provider works against OUR repo releases.
// update:state fetches through the updater's RUNTIME HTTP path (main process),
// not the renderer's — the facade-only rule is untouched.
//
// State also persists to <userData>/db/update-state.json so a renderer reload
// reads back the honest last state instead of re-checking mindlessly.

import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error" | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  forced: boolean;
  minimumVersion: string;
  message?: string;
  version?: string;
  progress?: number;
  error?: string;
  checkedAt?: number;
}

const stateFile = () => dbPath("update-state.json");

/** Minimum-version floor: read from app-update.yml when present (defined in-app). */
function minimumVersion(): string {
  try {
    const yml = require("node:fs").readFileSync(join(__dirname, "..", "..", "resources", "app-update.yml"), "utf8");
    const m = yml.match(/minimumVersion\s*:\s*(\S+)/);
    return m ? m[1].replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function currentVersion(): string {
  try {
    return require("../../package.json")?.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** semverLt without a dependency — dotted numeric compare (a<b, missing parts = 0). */
function semverLt(a: string, b: string): boolean {
  const pa = a.replace(/^[v=]/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^[v=]/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function makeUpdateHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;

  let inMemory: UpdateState | null = null;

  const write = (state: UpdateState) => {
    inMemory = state;
    try {
      saveJson(stateFile(), state);
    } catch {
      /* persistence is best-effort; state still lives in memory */
    }
    return state;
  };

  const read = (): UpdateState => {
    if (inMemory) return inMemory;
    const fallback: UpdateState = base();
    return loadJson(stateFile(), fallback);
  };

  const base = (): UpdateState => {
    const min = minimumVersion();
    const current = currentVersion();
    const forced = min ? semverLt(current, min) : false;
    return { status: "idle", currentVersion: current, forced, minimumVersion: min };
  };

  /** Emit events.onUpdate on real transitions (no re-broadcasting the same state). */
  const pushState = (state: UpdateState) => {
    const prev = read();
    write(state);
    if (prev.status !== state.status || prev.version !== state.version || prev.progress !== state.progress) {
      emit("events.onUpdate", state);
    }
  };

  /** Lazily build the updater; in dev builds returns null (→ unsupported). */
  let updater: any = null;
  let triedUpdater = false;

  function getUpdater() {
    if (triedUpdater) return updater;
    triedUpdater = true;
    const app = (deps as any).app;
    const isPackaged = app ? !!app.isPackaged : true;
    if (!isPackaged) return null;
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      try {
        autoUpdater.setFeedURL({ provider: "github", owner: "Adi103-ETAI", repo: "autumn" });
      } catch {
        /* feed unset → checkForUpdates errors, surfaced as handler-error */
      }
      autoUpdater.on("checking-for-update", () => pushState({ ...read(), status: "checking", checkedAt: now() }));
      autoUpdater.on("update-available", (info: { version?: string }) => {
        const cur = read();
        const next: UpdateState = { ...cur, status: "available", version: info?.version, checkedAt: now() };
        if (next.forced) {
          try {
            autoUpdater.downloadUpdate();
          } catch {
            /* workers don't care — progress events update state */
          }
          pushState({ ...next, status: "downloading" });
        } else {
          pushState(next);
        }
      });
      autoUpdater.on("update-not-available", () => pushState({ ...read(), status: "idle", checkedAt: now() }));
      autoUpdater.on("download-progress", (p: { percent?: number }) => {
        pushState({ ...read(), status: "downloading", progress: typeof p?.percent === "number" ? Math.round(p.percent) : undefined });
      });
      autoUpdater.on("update-downloaded", (info: { version?: string }) => {
        pushState({ ...read(), status: "downloaded", version: info?.version, progress: 100, checkedAt: now() });
      });
      autoUpdater.on("error", (err: Error) => {
        pushState({ ...read(), status: "error", error: String(err?.message ?? err), checkedAt: now() });
      });
      return autoUpdater;
    } catch {
      return null; // electron-updater unavailable (native context) → unsupported
    }
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "update.state",
      description:
        "current update state (RE: state()); params: {} -> { status, currentVersion, forced, minimumVersion, version?, progress?, error? }",
      schema: () => ({ ok: true }),
      handler: () => read(),
    },
    {
      kind: "bridge",
      id: "update.check",
      description:
        "trigger an update check (RE: check()); params: {} -> { checked: true, status } | { supported: false, reason } when dev/unpackaged",
      schema: () => ({ ok: true }),
      handler: async () => {
        const u = getUpdater();
        if (!u) {
          // Dev/unpackaged: nothing to check against — honest shape, never faked.
          write({ ...read(), status: "unsupported", checkedAt: now() });
          return { supported: false, reason: "dev build — updates ship only in packaged builds" };
        }
        try {
          const res = await u.checkForUpdates();
          return { checked: true, status: read().status, version: res?.updateInfo?.version ?? read().version };
        } catch (e) {
          write({ ...read(), status: "error", error: String((e as Error)?.message ?? e) });
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },
  ];

  return handlers;
}
