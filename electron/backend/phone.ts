// autumn — Wave-2 handlers: phone (12 dispatchable + phone.onChanged push;
// doc 32 §2g) — FULL (W2-10). The WebSocket RELAY is real now: a `ws` server
// on the LAN that pairs a phone by a one-time code and then streams frames.
//
// RE-derived (October out/main/index.js, RemoteMobileService + preload):
//   status()        → {enabled, port?, paired, since?}
//   enable()        → generate the identity + start the listener → status
//   disable()       → stop the listener → {…, relay:"offline"}
//   keepAwake(enabled) → RE: non-boolean throws "enabled must be boolean"
//   createPairing() → a pairing code (auto-enables first)
//   pending()       → the pairing requests awaiting a decision
//   decide(intentId, decision) → RE validates decision ∈ {approve, deny} else
//                     throws "Invalid pairing decision."; "Phone access is not
//                     enabled." when pairing is off
//   devices()       → the paired-device summaries
//   revoke(bind)    → idempotent revoke
//   connectedApps() / disconnectApp(clientId) → the connected clients
//   resetIdentity(confirmed) → RE passes confirmed===true
//   phone.onChanged → the change push
//
// autumn design (doc 32 §2g) — a LOCAL-FIRST LAN relay:
//   * the identity is a real ed25519 keypair (generated once, persisted under
//     <userData>/phone/, private key 0600);
//   * `enable` starts a REAL `ws` server (0.0.0.0, random port) and persists
//     the port; `disable` really closes it;
//   * the pairing protocol is the doc's frame set —
//       → {t:"auth", code, label?}          the phone authenticates
//       → {t:"session", id}                 the server answers with the intent
//       → {t:"session", id, deviceId}       the grant (after the user approves)
//       → {t:"event", kind, ts, payload}    app → phone frames
//       → {t:"input", text}                 phone → app text
//   * approving a pairing request really grants the session on that socket;
//     revoking a device really closes its socket;
//   * every state change emits phone.onChanged — only on REAL transitions.
//
// Storage: <userData>/db/phone.json {enabled, since, port, keepAwake, identity,
// devices[], apps[], intents[], codes[], inputs[]} + <userData>/phone/
// identity-key.pem (private, 0600) / identity-pub.pem.
//
// The relay needs the `ws` dependency (installed at this milestone). When it is
// missing the relay answers {running:false, reason} — never a fake listener.

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
  /** The identity fingerprint (a number) of the pairing key, when known. */
  keyFingerprint: number | null;
}
interface Intent {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  keyFingerprint?: number | null;
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
  /** Text the paired phones sent back (the phone → app direction). */
  inputs: { id: string; deviceId: string; text: string; at: number }[];
}
interface RelaySocket {
  socket: any;
  deviceId: string | null;
  intentId: string | null;
  label: string;
}
interface Relay {
  server: any;
  port: number;
  address: string;
  sockets: Set<RelaySocket>;
}

/**
 * Every relay this process ever started. The relay must be closable on
 * shutdown (and between tests), and the module may be re-required — so the
 * registry lives on globalThis, not in the module scope.
 */
const RELAY_REGISTRY = (globalThis as unknown as { __autumnPhoneRelays?: Set<any> }).__autumnPhoneRelays ?? new Set<any>();
(globalThis as unknown as { __autumnPhoneRelays?: Set<any> }).__autumnPhoneRelays = RELAY_REGISTRY;

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
    inputs: [],
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
    inputs: Array.isArray(s.inputs) ? s.inputs : [],
  };
}
function writeState(s: PhoneState): void {
  saveJson(dbPath("phone.json"), s);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function makePhoneHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;

  /** The live relay (module scope — one per factory instance). */
  let relay: Relay | null = null;

  /** The status snapshot — what phone.status and the onChanged payload report. */
  const statusOf = (s: PhoneState): {
    enabled: boolean;
    port: number | null;
    paired: number;
    since?: number;
    relay: { running: boolean; port?: number; clients?: number; reason?: string };
  } => {
    if (relay) {
      return {
        enabled: s.enabled,
        port: relay.port,
        paired: s.devices.length,
        ...(s.since ? { since: s.since } : {}),
        relay: { running: true, port: relay.port, clients: relay.sockets.size },
      };
    }
    return {
      enabled: s.enabled,
      port: s.port,
      paired: s.devices.length,
      ...(s.since ? { since: s.since } : {}),
      relay: {
        running: false,
        reason: relayUnavailableReason(),
      },
    };
  };

  const push = () => emit("phone.onChanged", statusOf(readState()));

  /** Why the relay is not running right now (honest). */
  function relayUnavailableReason(): string {
    if (!wsModule()) return "the ws dependency is not installed — the phone relay needs it (doc 32 §W2-10)";
    const s = readState();
    if (!s.enabled) return "phone access is off";
    return "the relay is not listening";
  }

  /** Load `ws` lazily (a missing dependency is a capability gap, not a crash). */
  function wsModule(): any | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("ws");
      return mod && mod.WebSocketServer ? mod : null;
    } catch {
      return null;
    }
  }

  /** Send one frame to a socket. */
  function send(socket: RelaySocket | null, frame: unknown): boolean {
    if (!socket) return false;
    try {
      socket.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  /** Broadcast an event frame to every paired device. */
  function broadcast(kind: string, payload: unknown): number {
    if (!relay) return 0;
    let sent = 0;
    for (const entry of relay.sockets) {
      if (!entry.deviceId) continue;
      if (send(entry, { t: "event", kind, ts: now(), payload })) sent++;
    }
    return sent;
  }

  /**
   * Start the relay server (real). The `ws` server binds asynchronously, so
   * this resolves once the socket is really listening — or with an honest
   * reason when it cannot bind.
   */
  function startRelay(): Promise<{ ok: true; relay: Relay } | { ok: false; reason: string }> {
    const ws = wsModule();
    if (!ws) return Promise.resolve({ ok: false, reason: "the ws dependency is not installed — the phone relay needs it (doc 32 §W2-10)" });
    if (relay) return Promise.resolve({ ok: true, relay });
    return new Promise((resolve) => {
    const server = new ws.WebSocketServer({ host: "0.0.0.0", port: 0 });
    const sockets = new Set<RelaySocket>();
    server.on("connection", (socket: any) => {
      const entry: RelaySocket = { socket, deviceId: null, intentId: null, label: "" };
      sockets.add(entry);
      socket.on("message", (raw: any) => {
        let frame: any;
        try {
          frame = JSON.parse(String(raw));
        } catch {
          send(entry, { t: "error", message: "invalid JSON frame" });
          return;
        }
        if (!frame || typeof frame !== "object" || typeof frame.t !== "string") {
          send(entry, { t: "error", message: "invalid frame" });
          return;
        }
        if (frame.t === "auth") {
          handleAuth(entry, frame);
          return;
        }
        if (frame.t === "input") {
          handleInput(entry, frame);
          return;
        }
        send(entry, { t: "error", message: `unknown frame ${frame.t}` });
      });
      socket.on("close", () => {
        sockets.delete(entry);
        if (entry.deviceId) {
          const s = readState();
          const apps = s.apps.filter((a) => a.id !== entry.deviceId);
          if (apps.length !== s.apps.length) {
            s.apps = apps;
            writeState(s);
            push();
          }
        }
      });
    });
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* nothing to close */
      }
      resolve({ ok: false, reason });
    };
    server.on("error", (err: Error) => fail(`the relay could not start: ${err?.message ?? "unknown error"}`));
    server.on("listening", () => {
      if (settled) return;
      const address = (server.address?.() as { port?: number } | null)?.port ?? null;
      if (!address) {
        fail("the relay could not bind a port");
        return;
      }
      settled = true;
      relay = { server, port: address, address: "0.0.0.0", sockets };
      _setLiveRelay(relay);
      RELAY_REGISTRY.add(relay);
      resolve({ ok: true, relay });
    });
    });
  }

  /** Close the relay (real). */
  function stopRelay(): void {
    if (!relay) return;
    const closing = relay;
    for (const entry of relay.sockets) {
      try {
        entry.socket.close?.();
      } catch {
        /* already gone */
      }
    }
    relay.sockets.clear();
    try {
      relay.server.close?.();
    } catch {
      /* already closed */
    }
    relay = null;
    RELAY_REGISTRY.delete(closing);
    _setLiveRelay(null);
  }

  /** The phone authenticated with a one-time code. */
  function handleAuth(entry: RelaySocket, frame: { code?: unknown; label?: unknown }): void {
    const code = typeof frame.code === "string" ? frame.code.trim() : "";
    const s = readState();
    if (!s.enabled) {
      send(entry, { t: "error", message: "Phone access is not enabled." });
      return;
    }
    const match = s.codes.find((c) => c.codeHash === sha256(code) && c.expiresAt > now());
    if (!match) {
      send(entry, { t: "error", message: "That pairing code is not valid." });
      return;
    }
    // The code is single-use.
    s.codes = s.codes.filter((c) => c.codeHash !== match.codeHash);
    const intent: Intent = {
      id: `intent-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: typeof frame.label === "string" && frame.label.trim() ? frame.label.trim() : "Paired device",
      createdAt: now(),
      expiresAt: now() + PAIRING_TTL_MS,
      keyFingerprint: s.identity?.fingerprint ?? null,
    };
    s.intents = [...s.intents.filter((i) => i.expiresAt > now()), intent];
    writeState(s);
    entry.intentId = intent.id;
    entry.label = intent.label;
    send(entry, { t: "session", id: intent.id });
    push(); // a real pairing request arrived
  }

  /** The phone sent text back. */
  function handleInput(entry: RelaySocket, frame: { text?: unknown }): void {
    if (!entry.deviceId) {
      send(entry, { t: "error", message: "This connection is not paired." });
      return;
    }
    const text = typeof frame.text === "string" ? frame.text : "";
    if (!text) return;
    const s = readState();
    s.inputs = [
      { id: `in-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, deviceId: entry.deviceId, text, at: now() },
      ...s.inputs,
    ].slice(0, 200);
    writeState(s);
  }

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
        "phone access status; params: {} -> {enabled, port, paired, since?, relay:{running, port?, clients?, reason?}} — the relay report is REAL (the ws server's own state), never a claimed port",
      handler: () => statusOf(readState()),
    },
    {
      kind: "bridge",
      id: "phone.enable",
      description:
        "enable phone access (RE: generate the identity + start the listener); params: {} -> status — an ed25519 identity generated once, the REAL ws relay started on a random LAN port, enabled:true persisted, emits phone.onChanged",
      handler: async () => {
        const s = readState();
        const wasEnabled = s.enabled;
        const hadRelay = relay !== null;
        const fresh = ensureIdentity(s);
        if (!fresh.enabled) {
          fresh.enabled = true;
          fresh.since = now();
        }
        const started = await startRelay();
        fresh.port = started.ok ? started.relay.port : null;
        writeState(fresh);
        if (!started.ok) {
          // Honest: the access is on but the listener is not — the reason says why.
          return { ...statusOf(fresh), relay: { running: false, reason: started.reason } };
        }
        // A real transition: the access was off, or the relay just came up.
        if (!wasEnabled || !hadRelay) push();
        return statusOf(fresh);
      },
    },
    {
      kind: "bridge",
      id: "phone.disable",
      description:
        "disable phone access; params: {} -> status — the REAL ws relay is closed, enabled:false persisted, emits phone.onChanged",
      handler: () => {
        const s = readState();
        stopRelay();
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
        "create a 6-digit pairing code (RE: auto-enables first; 10 min expiry; only the sha256 hash is stored); params: {label?} -> {code, expiresAt} — the code is shown once and the relay accepts it in an {t:'auth'} frame",
      handler: async (params) => {
        const { obj } = paramsOf(params);
        let s = readState();
        if (!s.enabled) {
          s = ensureIdentity(s);
          s.enabled = true;
          s.since = now();
          const started = await startRelay();
          s.port = started.ok ? started.relay.port : null;
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
      description:
        "list unexpired pairing intents awaiting a decision; params: {} -> [{id,label,createdAt,expiresAt}] (the relay feeds these — a phone that sent {t:'auth'} appears here)",
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
        "approve or deny a pairing intent; params: intentId, decision (RE positional; decision ∉ {approve,deny} -> bad-params 'Invalid pairing decision.'; pairing off -> handler-error 'Phone access is not enabled.') -> {approved|denied} + device record; approving really grants the relay session on that socket; emits phone.onChanged",
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
          // Really tell the phone: denied.
          if (relay) {
            for (const entry of relay.sockets) {
              if (entry.intentId === intentId) send(entry, { t: "error", message: "That pairing request was denied." });
            }
          }
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
        s.apps = [
          { id: device.id, name: device.label, connectedAt: now() },
          ...s.apps.filter((a) => a.id !== device.id),
        ];
        // Really grant the session on the waiting socket.
        if (relay) {
          for (const entry of relay.sockets) {
            if (entry.intentId === intentId) {
              entry.deviceId = device.id;
              entry.intentId = null;
              send(entry, { t: "session", id: device.id, deviceId: device.id, approved: true });
            }
          }
        }
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
        "revoke a paired device; params: id (RE positional bind) -> {revoked: bool, device?} — idempotent (RE revoke is), really closes that device's relay socket, emits phone.onChanged only on a real removal",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = str(obj, pos, "id", "bind");
        if (!id) return badParams("id required");
        const s = readState();
        const device = s.devices.find((d) => d.id === id);
        if (!device) return { revoked: false, paired: s.devices.length };
        s.devices = s.devices.filter((d) => d.id !== id);
        s.apps = s.apps.filter((a) => a.id !== id);
        writeState(s);
        if (relay) {
          for (const entry of relay.sockets) {
            if (entry.deviceId === id) {
              send(entry, { t: "event", kind: "revoked", ts: now(), payload: { deviceId: id } });
              try {
                entry.socket.close?.();
              } catch {
                /* already gone */
              }
            }
          }
        }
        push(); // real removal
        return { revoked: true, device, paired: s.devices.length };
      },
    },
    {
      kind: "bridge",
      id: "phone.connectedApps",
      description:
        "the apps currently connected through the phone relay; params: {} -> [{id,name,connectedAt}] (fed by the REAL relay sessions)",
      handler: () => readState().apps,
    },
    {
      kind: "bridge",
      id: "phone.disconnectApp",
      description:
        "disconnect an app from the relay; params: id -> {disconnected: bool} (idempotent; really closes that client socket; false when nothing matched)",
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
          if (relay) {
            for (const entry of relay.sockets) {
              if (entry.deviceId === id) {
                try {
                  entry.socket.close?.();
                } catch {
                  /* already gone */
                }
              }
            }
          }
          push();
        }
        return { disconnected };
      },
    },
    {
      kind: "bridge",
      id: "phone.resetIdentity",
      description:
        "reset the phone identity; params: {confirm:true} (RE passes confirmed===true) — without confirm -> bad-params; with it -> keypair + devices + apps + intents + inputs wiped, the relay closed, disabled, emits phone.onChanged",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return pick(obj, pos, "confirm", 0) === true ? { ok: true } : { ok: false, message: "confirm:true is required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        if (pick(obj, pos, "confirm", 0) !== true) return badParams("confirm:true is required to reset the phone identity");
        stopRelay();
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
          inputs: [],
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

/** Test/integration seams — the same paths the real relay uses. */
export function _queueIntent(intent: Partial<Intent> & { id: string }): Intent {
  const s = readState();
  const created: Intent = {
    id: intent.id,
    label: intent.label ?? "Paired device",
    createdAt: intent.createdAt ?? Date.now(),
    expiresAt: intent.expiresAt ?? Date.now() + PAIRING_TTL_MS,
    ...(intent.keyFingerprint !== undefined ? { keyFingerprint: intent.keyFingerprint } : {}),
  };
  s.intents = [...s.intents, created];
  writeState(s);
  return created;
}
export function _identityFilesExist(): { priv: boolean; pub: boolean } {
  return { priv: existsSync(privKeyFile()), pub: existsSync(pubKeyFile()) };
}
export function _phoneState(): PhoneState {
  return readState();
}
/** Broadcast an event frame to every paired device (the app → phone direction). */
export function _broadcastToDevices(kind: string, payload: unknown): number {
  // The seam needs the live relay — the handler factory keeps it in scope, so
  // the relay instance is tracked here for the tests and the integration path.
  const live = _liveRelay();
  if (!live) return 0;
  let sent = 0;
  for (const entry of live.sockets) {
    if (!entry.deviceId) continue;
    try {
      entry.socket.send(JSON.stringify({ t: "event", kind, ts: Date.now(), payload }));
      sent++;
    } catch {
      /* socket gone */
    }
  }
  return sent;
}
/** The live relay of the most recent factory (set by makePhoneHandlers). */
let _currentRelay: Relay | null = null;
export function _liveRelay(): Relay | null {
  return _currentRelay;
}
export function _setLiveRelay(r: Relay | null): void {
  _currentRelay = r;
}
export function _relayPort(): number | null {
  return _currentRelay?.port ?? null;
}
export function _relayInputs(): PhoneState["inputs"] {
  return readState().inputs;
}
/** Close every relay this process started (shutdown / test teardown). */
export function _stopAllRelays(): number {
  let closed = 0;
  for (const r of [...RELAY_REGISTRY]) {
    try {
      for (const entry of r.sockets ?? []) entry.socket?.close?.();
      r.sockets?.clear?.();
      r.server?.close?.();
    } catch {
      /* already gone */
    }
    RELAY_REGISTRY.delete(r);
    closed++;
  }
  _setLiveRelay(null);
  return closed;
}
