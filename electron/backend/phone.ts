// autumn — Wave-2 handlers: phone (12 dispatchable + phone.onChanged push;
// doc 32 §2g). The WebSocket RELAY itself lands at W2-10 with the `ws`
// dependency — this module owns the identity, pairing, and device registry so
// the relay plugs straight in: every state transition here is already real and
// already emits phone.onChanged.
//
// RE-derived (October out/main/index.js, RemoteMobileService):
//   status()      → {enabled, port?, paired: n, since?} (doc §2g shape; autumn adds
//                   an honest `relay:{running, reason}` because there is no listener
//                   until W2-10 — never claim a port we don't hold)
//   enable()      → identity (ed25519 keypair, generated once, persisted under
//                   <userData>/phone/) + enabled:true + relay attempt; emits onChanged
//   disable()     → enabled:false; emits onChanged
//   createPairing() → RE auto-enables first (this.listenerPort check → enable());
//                   6-digit code via crypto.randomInt, expires in 10 min, ONLY the
//                   sha256 hash is stored ({codeHash, expiresAt}); returns {code, expiresAt}
//   pending()     → unexpired pairing intents (fed by the relay at W2-10; the
//                   _queueIntent seam is the same entry point the relay will use)
//   decide(intentId, decision) → RE validates decision ∈ {approve, deny} else throws
//                   "Invalid pairing decision."; RE throws "Phone access is not
//                   enabled." when pairing is off → autumn handler-error envelope
//                   with that exact message; approve moves the intent into devices
//                   {id, label, pairedAt, keyFingerprint} + emits onChanged
//   devices()     → registry summaries (real file)
//   revoke(bind)  → RE idempotent revoke → autumn removes the device if present
//                   (emits onChanged only on a REAL removal)
//   connectedApps() → list (relay-fed later; honest [] now)
//   disconnectApp(id) → drops the app entry → {disconnected: bool}
//   resetIdentity(confirmed) → RE passes confirmed===true; without confirm →
//                   bad-params; with it → wipe identity+devices+apps+intents,
//                   disable, emit onChanged (real destructive transition)
//   keepAwake(enabled) → RE: non-boolean throws "enabled must be boolean" →
//                   bad-params; real powerSaveBlocker when Electron is present,
//                   honest {applied:false, reason} headless (doc §2g)
//
// Storage: <userData>/db/phone.json {enabled, since, port, keepAwake,
// identity?, devices[], apps[], intents[], codes[]} + <userData>/phone/
// identity-key.pem (private, 0600) / identity-pub.pem.

import { generateKeyPairSync, createHash, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson, userDataDir } from "./store";
import { paramsOf, str, ostr, pick, lazyElectron } from "./params";

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

const PAIRING_TTL_MS = 10 * 60 * 1000;

interface Device {
  id: string;
  label: string;
  pairedAt: number;
  keyFingerprint: string | null;
}
interface Intent {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  keyFingerprint?: string | null;
}
interface PhoneState {
  enabled: boolean;
  since?: number;
  port: number | null;
  keepAwake: { desired: boolean; applied: boolean; blockerId?: number; reason?: string };
  identity?: { fingerprint: number; algorithm: string; createdAt: number };
  devices: Device[];
  apps: { id: string; name: string; connectedAt: number }[];
  intents: Intent[];
  codes: { codeHash: string; expiresAt: number }[];
}

const phoneDir = () => join(userDataDir(), "phone");
const privKeyFile = () => join(phoneDir(), "identity-key.pem");
const pubKeyFile = () => join(phoneDir(), "identity-pub.pem");

function readState(): PhoneState {
  const s = loadJson<PhoneState>(dbPath("phone.json"), {
    enabled: false,
    port: null,
    keepAwake: { desired: false, applied: false },
    devices: [],
    apps: [],
    intents: [],
    codes: [],
  });
  return {
    enabled: !!s.enabled,
    ...(s.since ? { since: s.since } : {}),
    port: s.port ?? null,
    keepAwake: s.keepAwake ?? { desired: false, applied: false },
    ...(s.identity ? { identity: s.identity } : {}),
    devices: Array.isArray(s.devices) ? s.devices : [],
    apps: Array.isArray(s.apps) ? s.apps : [],
    intents: Array.isArray(s.intents) ? s.intents : [],
    codes: Array.isArray(s.codes) ? s.codes : [],
  };
}
function writeState(s: PhoneState): void {
  saveJson(dbPath("phone.json"), s);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Status snapshot — what phone.status and the onChanged payload both report. */
function statusOf(s: PhoneState): {
  enabled: boolean;
  port: number | null;
  paired: number;
  since?: number;
  relay: { running: boolean; reason: string };
} {
  return {
    enabled: s.enabled,
    port: s.port,
    paired: s.devices.length,
    ...(s.since ? { since: s.since } : {}),
    relay: { running: false, reason: "WebSocket relay ships with the phone integration (doc 32 §W2-10)" },
  };
}

export function makePhoneHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;
  const push = () => emit("phone.onChanged", statusOf(readState()));

  /** Real identity generation (ed25519, persisted once). */
  function ensureIdentity(s: PhoneState): PhoneState {
    if (s.identity && existsSync(privKeyFile()) && existsSync(pubKeyFile())) return s;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const priv = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const pub = publicKey.export({ type: "spki", format: "pem" }) as string;
    mkdirSync(phoneDir(), { recursive: true });
    writeFileSync(privKeyFile(), priv, { mode: 0o600 });
    writeFileSync(pubKeyFile(), pub, { mode: 0o644 });
    try {
      chmodSync(privKeyFile(), 0o600);
    } catch {
      /* best effort on platforms without posix modes */
    }
    const fingerprint = parseInt(sha256(pub).slice(0, 8), 16);
    s.identity = { fingerprint, algorithm: "ed25519", createdAt: now() };
    return s;
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "phone.status",
      description:
        "phone access status; params: {} -> {enabled, port, paired, since?, relay:{running, reason}} (real registry; honest relay state until the W2-10 ws listener)",
      handler: () => statusOf(readState()),
    },
    {
      kind: "bridge",
      id: "phone.enable",
      description:
        "enable phone access (RE: generate identity + start listener); params: {} -> status — ed25519 identity generated once, enabled:true persisted, emits phone.onChanged; relay reports honest reason until W2-10",
      handler: () => {
        const s = readState();
        const fresh = ensureIdentity(s);
        if (!fresh.enabled) {
          fresh.enabled = true;
          fresh.since = now();
          writeState(fresh);
          push(); // real transition
        } else {
          writeState(fresh); // identity may have just been created
        }
        return statusOf(fresh);
      },
    },
    {
      kind: "bridge",
      id: "phone.disable",
      description: "disable phone access; params: {} -> status (enabled:false persisted, emits phone.onChanged)",
      handler: () => {
        const s = readState();
        if (s.enabled) {
          s.enabled = false;
          s.port = null;
          writeState(s);
          push(); // real transition
        }
        return statusOf(s);
      },
    },
    {
      kind: "bridge",
      id: "phone.keepAwake",
      description:
        "hold a keep-awake blocker while phone access serves; params: enabled (boolean, RE positional; non-bool -> bad-params 'enabled must be boolean') -> {enabled, applied, blockerId?} | {applied:false, reason} without Electron",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const enabled = pick(obj, pos, "enabled", 0);
        if (typeof enabled !== "boolean") return badParams("enabled must be boolean");
        const s = readState();
        const blocker = lazyElectron()?.powerSaveBlocker;
        if (!blocker?.start || !blocker?.stop) {
          s.keepAwake = { desired: enabled, applied: false, reason: "powerSaveBlocker needs the Electron runtime" };
          writeState(s);
          return { enabled, applied: false, reason: s.keepAwake.reason };
        }
        try {
          if (enabled) {
            const blockerId = blocker.start("prevent-display-sleep");
            s.keepAwake = { desired: true, applied: true, blockerId };
          } else {
            if (typeof s.keepAwake.blockerId === "number") blocker.stop(s.keepAwake.blockerId);
            s.keepAwake = { desired: false, applied: false };
          }
          writeState(s);
          return { enabled, applied: true, ...(typeof s.keepAwake.blockerId === "number" ? { blockerId: s.keepAwake.blockerId } : {}) };
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },

    // ----- pairing -------------------------------------------------------------
    {
      kind: "bridge",
      id: "phone.createPairing",
      description:
        "create a 6-digit pairing code (RE: auto-enables first; 10 min expiry; only the sha256 hash is stored); params: {label?} -> {code, expiresAt} — the code is shown once",
      handler: (params) => {
        const { obj } = paramsOf(params);
        let s = readState();
        if (!s.enabled) {
          s = ensureIdentity(s);
          s.enabled = true;
          s.since = now();
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const expiresAt = now() + PAIRING_TTL_MS;
        s.codes = s.codes.filter((c) => c.expiresAt > now());
        s.codes.push({ codeHash: sha256(code), expiresAt });
        writeState(s);
        push(); // pairing window opened — real change
        return { code, expiresAt, label: str(obj, [], "label") };
      },
    },
    {
      kind: "bridge",
      id: "phone.pending",
      description: "list unexpired pairing intents awaiting a decision; params: {} -> [{id,label,createdAt,expiresAt}] (relay feeds these; _queueIntent is its entry point)",
      handler: () => {
        const s = readState();
        const t = now();
        return s.intents.filter((i) => i.expiresAt > t);
      },
    },
    {
      kind: "bridge",
      id: "phone.decide",
      description:
        "approve or deny a pairing intent; params: intentId, decision (RE positional; decision ∉ {approve,deny} -> bad-params 'Invalid pairing decision.'; pairing off -> handler-error 'Phone access is not enabled.') -> {approved|denied} + device record; emits phone.onChanged",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return str(obj, pos, "intentId", "id") ? { ok: true } : { ok: false, message: "intentId required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const intentId = str(obj, pos, "intentId", "id") as string;
        // RE positional is (intentId, decision) — decision is the SECOND arg.
        const decision = ostr(obj, "decision") ?? (typeof pos[1] === "string" ? (pos[1] as string) : undefined);
        if (decision !== "approve" && decision !== "deny") return badParams("Invalid pairing decision.");
        const s = readState();
        if (!s.enabled) return handlerError("Phone access is not enabled.");
        const intent = s.intents.find((i) => i.id === intentId);
        if (!intent) return notFound(`no pending pairing intent: ${intentId}`);
        s.intents = s.intents.filter((i) => i.id !== intentId);
        s.codes = s.codes.filter((c) => c.expiresAt > now());
        if (decision === "deny") {
          writeState(s);
          push();
          return { denied: true, intentId };
        }
        const device: Device = {
          id: `dev-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          label: intent.label || "Paired device",
          pairedAt: now(),
          keyFingerprint: intent.keyFingerprint ?? null,
        };
        s.devices.push(device);
        writeState(s);
        push(); // real pairing
        return { approved: true, device };
      },
    },

    // ----- devices / apps ------------------------------------------------------
    {
      kind: "bridge",
      id: "phone.devices",
      description: "list paired devices; params: {} -> [{id,label,pairedAt,keyFingerprint}] (real registry)",
      handler: () => readState().devices,
    },
    {
      kind: "bridge",
      id: "phone.revoke",
      description:
        "revoke a paired device; params: id (RE positional bind) -> {revoked: bool, device?} — idempotent (RE revoke is), emits phone.onChanged only on a real removal",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = str(obj, pos, "id", "bind");
        if (!id) return badParams("id required");
        const s = readState();
        const device = s.devices.find((d) => d.id === id);
        if (!device) return { revoked: false, paired: s.devices.length };
        s.devices = s.devices.filter((d) => d.id !== id);
        writeState(s);
        push(); // real removal
        return { revoked: true, device, paired: s.devices.length };
      },
    },
    {
      kind: "bridge",
      id: "phone.connectedApps",
      description: "apps connected through the phone relay; params: {} -> [{id,name,connectedAt}] (relay-fed from W2-10; honest empty registry until then)",
      handler: () => readState().apps,
    },
    {
      kind: "bridge",
      id: "phone.disconnectApp",
      description: "disconnect an app from the relay; params: id -> {disconnected: bool} (idempotent; false when nothing matched)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = str(obj, pos, "id");
        if (!id) return badParams("id required");
        const s = readState();
        const apps = s.apps.filter((a) => a.id !== id);
        const disconnected = apps.length < s.apps.length;
        if (disconnected) {
          s.apps = apps;
          writeState(s);
          push();
        }
        return { disconnected };
      },
    },
    {
      kind: "bridge",
      id: "phone.resetIdentity",
      description:
        "reset the phone identity; params: {confirm:true} (RE passes confirmed===true) — without confirm -> bad-params; with it -> keypair + devices + apps + intents wiped, disabled, emits phone.onChanged",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return pick(obj, pos, "confirm", 0) === true ? { ok: true } : { ok: false, message: "confirm:true is required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        if (pick(obj, pos, "confirm", 0) !== true) return badParams("confirm:true is required to reset the phone identity");
        for (const f of [privKeyFile(), pubKeyFile()]) {
          try {
            if (existsSync(f)) rmSync(f, { force: true });
          } catch {
            /* best effort */
          }
        }
        const s = readState();
        const wiped: PhoneState = {
          enabled: false,
          port: null,
          keepAwake: { desired: false, applied: false },
          devices: [],
          apps: [],
          intents: [],
          codes: [],
        };
        writeState(wiped);
        push(); // real reset
        const removed = s.devices.length;
        return { reset: true, identity: null, paired: 0, removedDevices: removed };
      },
    },
  ];

  return handlers;
}

/** Test/integration seam — the exact entry point the W2-10 relay uses when a
 *  device submits a pairing code: append a real intent to the registry. */
export function _queueIntent(entry: { id?: string; label?: string; ttlMs?: number; keyFingerprint?: string | null }): {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
} {
  const s = loadJson<PhoneState>(dbPath("phone.json"), {
    enabled: false,
    port: null,
    keepAwake: { desired: false, applied: false },
    devices: [],
    apps: [],
    intents: [],
    codes: [],
  });
  const t = Date.now();
  const intent: Intent = {
    id: entry.id ?? `intent-${t.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: entry.label ?? "Paired device",
    createdAt: t,
    expiresAt: t + (entry.ttlMs ?? PAIRING_TTL_MS),
    keyFingerprint: entry.keyFingerprint ?? null,
  };
  s.intents = [...(s.intents ?? []), intent];
  s.codes = (s.codes ?? []).filter((c) => c.expiresAt > t);
  saveJson(dbPath("phone.json"), s);
  return intent;
}

/** Test seam: read the raw identity key files that enable() really wrote. */
export function _identityFilesExist(): { priv: boolean; pub: boolean } {
  return { priv: existsSync(privKeyFile()), pub: existsSync(pubKeyFile()) };
}
