"use strict";
// layer-1 tests for the voice bridge ids (doc 32 W2-5 §2f). 10 real ids
// (mic platform probes, OS TTS, mic control, BYO tokens, usage, cache) +
// 5 permanent boundary ids (compile/cancelCompile/intentReady/parakeet/
// voicePack — doc 32 §2a). No network: the BYO token mints must answer
// {supported:false} when the env key is absent and NEVER fabricate a token.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeVoiceHandlers } = require("./voice.ts");

const DISPATCHABLE = manifest.bridge.namespaces.voice; // 15
const BOUNDARY = ["voice.compile", "voice.cancelCompile", "voice.intentReady", "voice.parakeet", "voice.voicePack"];

/** Minimal fake child process — records spawn calls, drives exit by hand. */
function fakeSpawn(state) {
  return {
    spawn: (command, args, opts) => {
      const listeners = {};
      const stdoutListeners = [];
      const proc = {
        killed: false,
        pid: 4242,
        stdout: { on(ev, cb) { if (ev === "data") stdoutListeners.push(cb); } },
        on(ev, cb) { (listeners[ev] ||= []).push(cb); return proc; },
        kill() { proc.killed = true; (listeners.exit || []).forEach((cb) => cb(null)); return true; },
        emitExit(code) { (listeners.exit || []).forEach((cb) => cb(code)); },
        emitError(err) { (listeners.error || []).forEach((cb) => cb(err)); },
      };
      state.spawns.push({ command, args, opts, proc });
      // A device probe answers immediately with its stdout and exits.
      const isProbe = args.includes("-list_devices") || command === "arecord" || command === "system_profiler";
      if (isProbe) {
        setImmediate(() => {
          stdoutListeners.forEach((cb) => cb("card 1: Device [USB Audio Device], device 0\n"));
          (listeners.exit || []).forEach((cb) => cb(0));
        });
      }
      return proc;
    },
  };
}

function build(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: fakeSpawn(state),
    ...overrides,
  };
  const handlers = makeVoiceHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

/** Run `fn` with PATH replaced (empty = "no executables at all"), then restore. */
async function withPath(dir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}

/** A temp dir containing fake TTS + ffmpeg executables (all platform names). */
function fakeBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-bins-"));
  for (const name of ["say", "spd-say", "powershell", "ffmpeg"]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    try { fs.chmodSync(p, 0o755); } catch { /* win32: F_OK is enough */ }
  }
  return dir;
}

/** Drop BYO env keys for the duration of `fn`. */
async function withoutKeys(fn) {
  const keys = ["DEEPGRAM_API_KEY", "OPENAI_API_KEY"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    return await fn();
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./voice.ts")]) delete require.cache[p];
});

test("id surface: 15 voice ids, all in the manifest; the 5 boundary ids are handlers too", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 15);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `voice.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
  for (const id of BOUNDARY) assert.ok(handlers.some((h) => h.id === id), `${id} must dispatch`);
});

test("boundary: the 5 voice-pack ecosystem ids → not-implemented envelopes", async () => {
  useTempUserData();
  const { dispatch } = build();
  for (const id of BOUNDARY) {
    const env = await dispatch(id, { action: "status" });
    assert.equal(env.ok, false, `${id} must fail`);
    assert.equal(env.error.code, "not-implemented", `${id} must be the boundary envelope`);
    assert.match(env.error.message, /boundary id/);
  }
});

test("micPermission: string status; headless (no Electron API) is honest 'unknown'", async () => {
  useTempUserData();
  const { call } = build();
  const status = await call("voice.micPermission", {});
  assert.ok(["granted", "denied", "prompt", "unknown"].includes(status), `unexpected status ${status}`);
  assert.equal(status, "unknown", "require('electron') is the binary string headless → no systemPreferences");
});

test("ensureMicAccess: boolean (linux → true without Electron; win32 → not-denied; darwin → false without the ask API)", async () => {
  useTempUserData();
  const { call } = build();
  const ok = await call("voice.ensureMicAccess", {});
  assert.equal(typeof ok, "boolean");
  if (process.platform === "darwin") assert.equal(ok, false, "cannot prompt without Electron — honest false");
  else assert.equal(ok, true, process.platform === "win32" ? "win32: no denied status without the API" : "RE: other platforms → true");
});

test("openMicSettings: {opened:false, guidance} without the Electron shell (deviation, not an envelope)", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("voice.openMicSettings", {});
  assert.deepEqual(Object.keys(res).sort(), ["guidance", "opened"]);
  assert.equal(res.opened, false);
  assert.equal(typeof res.guidance, "string");
});

test("speak: positional text, sliced to 500 chars; no TTS on PATH → false (awaited boolean, RE shape)", async () => {
  useTempUserData();
  const { call, state } = build();
  const res = await withPath("", () => call("voice.speak", "hello world"));
  assert.equal(res, false, "unavailable TTS must resolve false, never a truthy object");
  assert.equal(state.spawns.length, 0, "nothing to spawn without a TTS binary");
});

test("speak: real platform TTS run resolves true only on exit 0; slice limit honored", async () => {
  useTempUserData();
  const bins = fakeBinDir();
  const { call, state } = build();
  await withPath(bins, async () => {
    const long = "z".repeat(600);
    const p = call("voice.speak", { text: long });
    assert.equal(state.spawns.length, 1, "one TTS child");
    const { args } = state.spawns[0];
    assert.ok(args.join(" ").length <= 500 + 8, "text must be sliced to 500 chars before the TTS");
    state.spawns[0].proc.emitExit(0);
    assert.equal(await p, true);
  });
});

test("speak: TTS failure → false", async () => {
  useTempUserData();
  const bins = fakeBinDir();
  const { call, state } = build();
  await withPath(bins, async () => {
    const p = call("voice.speak", "hi");
    state.spawns[0].proc.emitExit(1);
    assert.equal(await p, false);
  });
});

test("stopSpeak: kills the live utterance (true once, false when idle)", async () => {
  useTempUserData();
  const bins = fakeBinDir();
  const { call, state } = build();
  await withPath(bins, async () => {
    void call("voice.speak", "a long sentence"); // child never exits on its own
    assert.equal(state.spawns.length, 1);
    assert.equal(await call("voice.stopSpeak", {}), true);
    assert.equal(state.spawns[0].proc.killed, true, "the tracked child must really be killed");
    assert.equal(await call("voice.stopSpeak", {}), false, "nothing left to stop");
  });
});

test("mic: mute/unmute/state/lockBypass — real in-memory control state", async () => {
  useTempUserData();
  const { call } = build();
  let s = await call("voice.mic", { action: "state" });
  assert.deepEqual({ state: s.state, muted: s.muted, lockBypass: s.lockBypass }, { state: "idle", muted: false, lockBypass: false });

  s = await call("voice.mic", { action: "mute" });
  assert.equal(s.muted, true);
  s = await call("voice.mic", { action: "unmute" });
  assert.equal(s.muted, false);

  s = await call("voice.mic", { action: "lockBypass", on: true });
  assert.equal(s.lockBypass, true);
  const bad = await call("voice.mic", { action: "lockBypass", on: "yes" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const unknown = await call("voice.mic", { action: "levitate" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-params");
});

test("mic record mode: ffmpeg gated → {supported:false}; with a fake bin, start/stop track a real child", async () => {
  useTempUserData();
  const { call, state } = build();
  const gated = await withPath("", () => call("voice.mic", { action: "start" }));
  assert.equal(gated.supported, false);
  assert.match(gated.reason, /ffmpeg/);

  const bins = fakeBinDir();
  await withPath(bins, async () => {
    const started = await call("voice.mic", { action: "start", durationMs: 2000 });
    assert.equal(started.started, true);
    assert.equal(started.recording, true);
    assert.ok(started.path.includes(path.join("voice"))); // <userData>/voice/<ts>.wav
    assert.equal(path.basename(state.spawns[0].command), "ffmpeg");
    assert.ok(state.spawns[0].args.includes("2"), "duration passed to ffmpeg -t in whole seconds");

    const again = await call("voice.mic", { action: "start" });
    assert.equal(again.alreadyRecording, true, "one recording at a time");

    const stopped = await call("voice.mic", { action: "stop" });
    assert.equal(stopped.stopped, true);
    assert.equal(typeof stopped.durationMs, "number");
    const idle = await call("voice.mic", { action: "state" });
    assert.equal(idle.state, "idle");
  });
});

test("reportUsage: RE shape counts sessions+seconds; unusable shape → {ok:false, code:'invalid_request'}", async () => {
  const dir = useTempUserData();
  const { call } = build();
  // RE validation: sessionId /^[A-Za-z0-9_-]{8,128}$/, purpose ∈ {desktop-ftue,
  // desktop-voice}, seconds an integer 0..3600.
  const okRes = await call("voice.reportUsage", { sessionId: "session-0001", purpose: "desktop-voice", seconds: 42 });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.usage.sessions, 1);
  assert.equal(okRes.usage.seconds, 42);
  assert.equal(okRes.usage.byKind["desktop-voice"].count, 1);

  const docRes = await call("voice.reportUsage", { kind: "tts", ms: 500 });
  assert.equal(docRes.ok, true);
  assert.equal(docRes.usage.byKind.tts.count, 1);
  assert.equal(docRes.usage.byKind.tts.ms, 500);

  // RE rejections.
  assert.deepEqual(await call("voice.reportUsage", { sessionId: "s" }), { ok: false, code: "invalid_request" }, "sessionId too short");
  assert.deepEqual(
    await call("voice.reportUsage", { sessionId: "session-0001", purpose: "dictation", seconds: 5 }),
    { ok: false, code: "invalid_request" },
    "unknown purpose",
  );
  assert.deepEqual(
    await call("voice.reportUsage", { sessionId: "session-0001", purpose: "desktop-voice", seconds: 99999 }),
    { ok: false, code: "invalid_request" },
    "seconds beyond the RE maximum",
  );
  assert.deepEqual(await call("voice.reportUsage", {}), { ok: false, code: "invalid_request" });

  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "voice", "usage.json"), "utf8"));
  assert.equal(persisted.sessions, 1, "counters persist for real");
});

test("deleteOldModel: stale cache files removed, fresh ones kept → {deleted, freedMb} (RE shape)", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const cache = path.join(dir, "voice", "cache");
  fs.mkdirSync(cache, { recursive: true });
  const oldFile = path.join(cache, "old.bin");
  const freshFile = path.join(cache, "fresh.bin");
  fs.writeFileSync(oldFile, Buffer.alloc(1024, 1));
  fs.writeFileSync(freshFile, Buffer.alloc(16, 2));
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldFile, old, old);

  const res = await call("voice.deleteOldModel", { olderThanDays: 30 });
  assert.equal(res.deleted, true);
  assert.ok(Number.isInteger(res.freedMb) && res.freedMb >= 0);
  assert.ok(!fs.existsSync(oldFile), "stale file must be deleted");
  assert.ok(fs.existsSync(freshFile), "fresh file must survive");
});

test("BYO tokens: no key → the RE refusal shape — never a fabricated token", async () => {
  useTempUserData();
  const { call } = build();
  await withoutKeys(async () => {
    const dg = await call("voice.deepgramToken", {});
    assert.equal(dg.ok, false);
    assert.equal(dg.code, "voice_grant_unavailable");
    assert.match(dg.message, /Deepgram API key/i);
    const oa = await call("voice.openaiRealtimeToken", {});
    assert.equal(oa.ok, false);
    assert.equal(oa.code, "voice_grant_unavailable");
    assert.match(oa.message, /OpenAI API key/i);
    for (const res of [dg, oa]) {
      assert.ok(!("token" in res) && !("value" in res) && !("access_token" in res), "must not fabricate tokens");
    }
  });
});

test("BYO tokens: the key may come from the SETTINGS document (RE: getSettings().openaiApiKey)", async () => {
  useTempUserData();
  const { call } = build();
  await withoutKeys(async () => {
    const { dbPath } = require("./store.ts");
    fs.writeFileSync(dbPath("app-settings.json"), JSON.stringify({ openaiApiKey: "sk-test" }), "utf8");
    const oa = await call("voice.openaiRealtimeToken", { language: "en" });
    // No network in the test → the failure must be honest, and it must NOT be
    // "no key configured" (the key was really read from the settings).
    assert.equal(oa.ok, false);
    assert.equal(oa.code, "voice_network_error");
  });
});

test("deepgramToken: an invalid purpose → the RE invalid_request refusal", async () => {
  useTempUserData();
  const { call } = build();
  await withoutKeys(async () => {
    const bad = await call("voice.deepgramToken", { purpose: "dictation" });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "invalid_request");
  });
});

test("devices: real enumeration via the platform probe; absent probe → honest {supported:false}", async () => {
  useTempUserData();
  const { call, state } = build();
  // No probe binary on PATH → the honest answer, never a fabricated device list.
  const gated = await withPath("", () => call("voice.mic", { action: "devices" }));
  assert.equal(gated.supported, false);
  assert.ok(gated.reason);

  // With a probe present the device names are parsed out of the REAL output.
  const bins = fakeBinDir();
  fs.writeFileSync(path.join(bins, "arecord"), "#!/bin/sh\necho 'card 1: Device [USB Audio Device], device 0'\n", "utf8");
  fs.chmodSync(path.join(bins, "arecord"), 0o755);
  await withPath(bins, async () => {
    const res = await call("voice.mic", { action: "devices" });
    assert.ok(Array.isArray(res.devices));
    assert.ok(res.devices.length >= 1, "the probe output is really parsed");
    assert.ok(res.devices[0].includes("USB Audio Device"));
    assert.equal(state.spawns.length, 1, "the probe really ran");
  });
});

test("ensureMicAccess: {devices:true} enumerates the REAL inputs (and still answers the boolean without it)", async () => {
  useTempUserData();
  const { call } = build();
  const plain = await call("voice.ensureMicAccess", {});
  assert.equal(typeof plain, "boolean");

  const bins = fakeBinDir();
  fs.writeFileSync(path.join(bins, "arecord"), "#!/bin/sh\necho 'card 1: Device [USB Audio Device], device 0'\n", "utf8");
  fs.chmodSync(path.join(bins, "arecord"), 0o755);
  await withPath(bins, async () => {
    const res = await call("voice.ensureMicAccess", { devices: true });
    assert.equal(typeof res.granted, "boolean");
    assert.ok(Array.isArray(res.devices));
    assert.ok(res.devices.length >= 1);
  });
});

test("registry-level: every voice id dispatch-resolves", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  await withoutKeys(async () => {
    for (const h of handlers) {
      const env = await dispatch(h.id, {});
      assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
      if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
    }
  });
});
