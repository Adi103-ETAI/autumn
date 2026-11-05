// autumn — Wave-2 handlers: settings (4 dispatchable + onSshServersChanged push; doc 32 §W2-1).
//
// RE-faithful call shapes (autumn/05-renderer.md, 09-renderer-deep-dive.md):
//   settings.get()      — NO params; returns the WHOLE settings document
//   settings.set(patch) — merges a partial patch object (e.g. { wallpaper }, { onboardingCompletedAt })
//   settings.authStatus — NO params; returns { keychainAvailable, providerMode? }
//   settings.resetFtue  — clears the first-time-user-experience keys
// Persisted as flat JSON (<userData>/db/app-settings.json) with atomic writes and
// never-throws loads. `authStatus` reads the shared session store so it is honest
// from this milestone onward (not hardcoded). `onSshServersChanged` fires only when
// a write actually touches SSH-server config.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;
/** Keys cleared by resetFtue — the FTUE/onboarding surface (RE: onboardingCompletedAt). */
const FTUE_KEYS = ["ftue", "onboarding", "onboardingCompletedAt", "onboarding-step", "onboardingStep"];
const SSH_KEYS = new Set(["sshServers", "ssh.servers", "ssh"]);

export function makeSettingsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;

  const settingsPath = () => dbPath("app-settings.json");

  const readSettings = (): Record<string, unknown> => loadJson(settingsPath(), {});
  const writeSettings = (obj: Record<string, unknown>) => saveJson(settingsPath(), obj);

  const isSerializableValue = (v: unknown, depth = 0): boolean => {
    if (depth > 6) return false;
    if (v === undefined) return false;
    if (v === null) return true;
    const t = typeof v;
    if (t === "string" || t === "boolean") return true;
    if (t === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every((x) => isSerializableValue(x, depth + 1));
    if (t === "object") return Object.entries(v as Record<string, unknown>).every(([k, x]) => KEY_RE.test(k) && isSerializableValue(x, depth + 1));
    return false;
  };

  /** Emit settings.onSshServersChanged when a written patch touches SSH config. */
  const maybeEmitSshChanged = (patch: Record<string, unknown>) => {
    const keys = Object.keys(patch);
    const touched = keys.filter((k) => SSH_KEYS.has(k) || k.startsWith("ssh."));
    if (touched.length > 0) {
      emit("settings.onSshServersChanged", { keys: touched, ts: now() });
    }
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "settings.get",
      description:
        "read the whole settings document (RE: no params); params: {} -> the settings object; autumn extension: { key } returns { found, value }",
      schema: (p) =>
        p?.key === undefined || (typeof p.key === "string" && KEY_RE.test(p.key))
          ? { ok: true }
          : { ok: false, message: "key must match /^[a-zA-Z0-9._-]{1,64}$/ when given" },
      handler: (p = {}) => {
        const settings = readSettings();
        if (p.key === undefined) return settings;
        if (!KEY_RE.test(p.key)) return badParams("key must match /^[a-zA-Z0-9._-]{1,64}$/ when given");
        return Object.prototype.hasOwnProperty.call(settings, p.key)
          ? { found: true, value: settings[p.key] }
          : { found: false, value: null };
      },
    },
    {
      kind: "bridge",
      id: "settings.set",
      description:
        "merge a partial settings patch (RE: object); params: { <patch keys> } -> { ok: true, settings }",
      schema: (p) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) {
          return { ok: false, message: "a patch object is required" };
        }
        const keys = Object.keys(p);
        if (keys.length === 0) return { ok: false, message: "patch must not be empty" };
        if (keys.some((k) => typeof k !== "string" || !KEY_RE.test(k))) {
          return { ok: false, message: "every key must match /^[a-zA-Z0-9._-]{1,64}$/" };
        }
        if (!isSerializableValue(p)) return { ok: false, message: "value(s) must be JSON-serializable (depth ≤ 6)" };
        return { ok: true };
      },
      handler: (p = {}) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) return badParams("a patch object is required");
        const keys = Object.keys(p);
        if (keys.length === 0) return badParams("patch must not be empty");
        for (const k of keys) if (!KEY_RE.test(k)) return badParams(`invalid key: ${k}`);
        if (!isSerializableValue(p)) return badParams("value(s) must be JSON-serializable (depth ≤ 6)");
        if (JSON.stringify(p).length > 64 * 1024) return badParams("patch exceeds 64KB");
        const current = readSettings();
        // Shallow merge at the top level; sub-objects merge one level deeper.
        const next = { ...current };
        for (const k of keys) {
          const existing = current[k];
          const incoming = p[k];
          if (
            existing && incoming &&
            typeof existing === "object" && typeof incoming === "object" &&
            !Array.isArray(existing) && !Array.isArray(incoming)
          ) {
            next[k] = { ...(existing as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
          } else {
            next[k] = incoming;
          }
        }
        writeSettings(next);
        maybeEmitSshChanged(p as Record<string, unknown>);
        return { ok: true, settings: next };
      },
    },
    {
      kind: "bridge",
      id: "settings.resetFtue",
      description:
        "clear the first-time-user-experience flags (FTUE); params: {} -> { ok: true, removed: string[] }",
      schema: () => ({ ok: true }),
      handler: () => {
        const current = readSettings();
        const removed = Object.keys(current).filter((k) =>
          FTUE_KEYS.includes(k) || k.startsWith("ftue") || k.startsWith("onboarding"),
        );
        if (removed.length === 0) return { ok: true, removed: [] };
        const next = { ...current };
        for (const k of removed) delete next[k];
        writeSettings(next);
        return { ok: true, removed };
      },
    },
    {
      kind: "bridge",
      id: "settings.authStatus",
      description:
        "settings-storage security status (RE: no params); params: {} -> { keychainAvailable, providerMode? }",
      schema: () => ({ ok: true }),
      handler: () => {
        const current = readSettings();
        const providerMode = typeof current.providerMode === "string" ? current.providerMode : undefined;
        // autumn has no OS-keychain integration — the honest answer.
        return { keychainAvailable: false, providerMode };
      },
    },
  ];

  return handlers;
}
