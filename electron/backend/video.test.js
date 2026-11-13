"use strict";
// layer-1 tests for the video bridge ids (docs/architecture/backend.md W2-5 §2h). 4 ids, no
// boundary ids: every capability gate is {supported:false} (ffmpeg absent,
// no dialog without Electron) — never a fake path, never fake output.
// Subtitle/bgm run REAL child processes through deps.spawn (faked here),
// claim jobs per input like the target, and journal to <userData>/video/.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeVideoHandlers, parseSrt } = require("./video.ts");

const DISPATCHABLE = manifest.bridge.namespaces.video; // 4

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:02,500",
  "Hello there",
  "",
  "2",
  "00:00:03,000 --> 00:00:04,000",
  "General Kenobi",
  "",
].join("\n");

function fakeProc() {
  const ls = {};
  const proc = {
    killed: false,
    pid: 77,
    on(ev, cb) { (ls[ev] ||= []).push(cb); return proc; },
    stdout: { on(ev, cb) { (ls[`stdout:${ev}`] ||= []).push(cb); } },
    stderr: { on(ev, cb) { (ls[`stderr:${ev}`] ||= []).push(cb); } },
    kill() { proc.killed = true; (ls.exit || []).forEach((cb) => cb(null)); return true; },
    emitExit(code) { (ls.exit || []).forEach((cb) => cb(code)); },
    emitStderr(s) { (ls["stderr:data"] || []).forEach((cb) => cb(s)); },
    emitError(e) { (ls.error || []).forEach((cb) => cb(e)); },
  };
  return proc;
}

function build(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: {
      spawn: (command, args, opts) => {
        const proc = fakeProc();
        state.spawns.push({ command, args, opts, proc });
        // The stream probe (`ffmpeg -hide_banner -i <file>`) answers at once
        // with an audio stream — the fake video has one.
        if (args.includes("-hide_banner")) {
          setImmediate(() => {
            proc.emitStderr("  Stream #0:1: Audio: aac (LC)\n");
            proc.emitExit(0);
          });
        }
        return proc;
      },
    },
    ...overrides,
  };
  const handlers = makeVideoHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

async function withPath(dir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}

function fakeBin(name = "ffmpeg") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-ff-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
  try { fs.chmodSync(p, 0o755); } catch { /* win32 */ }
  return dir;
}

/** Temp media files: <dir>/clip.mp4 + clip.srt (+ song.mp3). */
function mediaFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-media-"));
  const input = path.join(dir, "clip.mp4");
  const srt = path.join(dir, "clip.srt");
  const audio = path.join(dir, "song.mp3");
  fs.writeFileSync(input, Buffer.alloc(64, 3));
  fs.writeFileSync(srt, SRT, "utf8");
  fs.writeFileSync(audio, Buffer.alloc(32, 4));
  return { dir, input, srt, audio };
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./video.ts")]) delete require.cache[p];
});

test("id surface: 4 video ids, all in the manifest; no boundary ids in this namespace", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 4);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `video.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("pickInput headless → null (no dialog, never a fabricated path)", async () => {
  useTempUserData();
  const { call } = build();
  assert.equal(await call("video.pickInput", {}), null);
});

test("parseSrt: strict block validation (index, timestamp line, text)", () => {
  assert.deepEqual(parseSrt(SRT), { ok: true, cues: 2 });
  assert.equal(parseSrt("").ok, false);
  assert.match(parseSrt("nope").message, /malformed SRT/);
  assert.equal(parseSrt("1\nnot-a-time\nhi").ok, false);
  assert.match(parseSrt("x\n00:00:01,000 --> 00:00:02,000\nhi").message, /index is not a number/);
});

test("subtitle: validation chain — input required, missing files, malformed SRT", async () => {
  useTempUserData();
  const { call } = build();
  const noInput = await call("video.subtitle", {});
  assert.equal(noInput.ok, false);
  assert.equal(noInput.error.code, "bad-params");

  const noVideo = await call("video.subtitle", { path: "/no/such/clip.mp4" });
  assert.equal(noVideo.ok, false);
  assert.equal(noVideo.error.code, "not-found");

  const { input } = mediaFiles();
  const noSrt = await call("video.subtitle", { path: input, srtPath: "/no/clip.srt" });
  assert.equal(noSrt.ok, false);
  assert.equal(noSrt.error.code, "not-found");

  const srtFile = path.join(path.dirname(input), "clip.srt");
  fs.writeFileSync(srtFile, "garbage without structure", "utf8");
  const malformed = await call("video.subtitle", { path: input, srtPath: srtFile });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "bad-params");
});

test("subtitle: ffmpeg absent → {supported:false, reason}; present → real spawn with the subtitles filter", async () => {
  const dir = useTempUserData();
  const { call, state } = build();
  const { input, srt } = mediaFiles();
  const gated = await withPath("", () => call("video.subtitle", { path: input, srtPath: srt }));
  assert.equal(gated.supported, false);
  assert.match(gated.reason, /ffmpeg/);

  const bins = fakeBin();
  await withPath(bins, async () => {
    const p = call("video.subtitle", { path: input, srtPath: srt });
    await new Promise((r) => setImmediate(r));
    assert.equal(state.spawns.length, 1);
    const { command, args, proc } = state.spawns[0];
    assert.equal(path.basename(command), "ffmpeg");
    assert.ok(args.includes("-vf"), "burn filter passed");
    assert.ok(args.some((a) => a.startsWith("subtitles=")), "subtitles filter used");
    assert.equal(args[args.length - 1], path.join(path.dirname(input), "clip.subbed.mp4"), "default out path");

    fs.writeFileSync(args[args.length - 1], "ENCODED", "utf8");
    proc.emitExit(0);
    const res = await p;
    assert.equal(res.path, path.join(path.dirname(input), "clip.subbed.mp4"));
    assert.equal(res.bytes, 7);
    assert.ok(res.durationMs >= 0);
    assert.ok(res.jobId);

    const journal = JSON.parse(fs.readFileSync(path.join(dir, "video", "jobs.json"), "utf8"));
    assert.equal(journal[0].status, "done", "job journaled for real");
    void srt;
  });
});

test("subtitle: ffmpeg failure → handler-error with the stderr tail", async () => {
  useTempUserData();
  const { call, state } = build();
  const { input, srt } = mediaFiles();
  const bins = fakeBin();
  await withPath(bins, async () => {
    const p = call("video.subtitle", { path: input, srtPath: srt });
    state.spawns[0].proc.emitStderr("Error: no such filter 'subtitles'\n");
    state.spawns[0].proc.emitExit(1);
    const res = await p;
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "handler-error");
    assert.match(res.error.message, /exited 1/);
    assert.match(res.error.message, /no such filter/);
  });
});

test("bgm: positional (input, audioPath) — the audio arg must never be read as the input", async () => {
  const dir = useTempUserData();
  const { call, state } = build();
  const { input, audio } = mediaFiles();

  const missing = await call("video.bgm", { args: [input, "/no/song.mp3"] });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
  assert.match(missing.error.message, /audio not found/);

  const bins = fakeBin();
  await withPath(bins, async () => {
    const p = call("video.bgm", { args: [input, audio] });
    // The first spawn is the stream probe (ffmpeg -i <file>), the second is
    // the real mix.
    await new Promise((r) => setImmediate(r));
    const mix = state.spawns.find((s) => s.args.includes("-filter_complex"));
    assert.ok(mix, "ffmpeg must really run the mix for a valid positional pair");
    const { args, proc } = mix;
    assert.equal(args[args.indexOf("-i") + 1], input, "first -i is the video");
    assert.equal(args[args.lastIndexOf("-i") + 1], audio, "second -i is the audio");
    assert.ok(args.includes("-filter_complex"));
    assert.ok(args.some((a) => a.startsWith("[") && a.includes("amix")), "amix mixes the bgm under");

    fs.writeFileSync(args[args.length - 1], "MIXED", "utf8");
    proc.emitExit(0);
    const res = await p;
    assert.equal(res.path, path.join(path.dirname(input), "clip.bgm.mp4"));
    assert.equal(res.bytes, 5);

    const journal = JSON.parse(fs.readFileSync(path.join(dir, "video", "jobs.json"), "utf8"));
    assert.equal(journal[0].kind, "bgm");
    assert.equal(journal[0].status, "done");
  });
});

test("claim: one job per input — a second run refuses while the first is live", async () => {
  useTempUserData();
  const { call, state } = build();
  const { input, srt } = mediaFiles();
  const bins = fakeBin();
  await withPath(bins, async () => {
    void call("video.subtitle", { path: input, srtPath: srt }); // never exits
    const second = await call("video.subtitle", { path: input, srtPath: srt });
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "handler-error");
    assert.match(second.error.message, /already running/);
    assert.equal(state.spawns.length, 1, "no second child spawned");
  });
});

test("cancel: per-input kill like the target; idle → honest {cancelled:false, reason}", async () => {
  useTempUserData();
  const { call, state } = build();
  const { input, srt } = mediaFiles();

  const idle = await call("video.cancel", { args: [input, undefined] });
  assert.equal(idle.cancelled, false);
  assert.ok(idle.reason);

  const bins = fakeBin();
  await withPath(bins, async () => {
    void call("video.subtitle", { path: input, srtPath: srt });
    const badKind = await call("video.cancel", { args: [input, "remux"] });
    assert.equal(badKind.ok, false);
    assert.equal(badKind.error.code, "bad-params");

    const killed = await call("video.cancel", { args: [input, "subtitle"] });
    assert.equal(killed.cancelled, true);
    assert.equal(killed.kind, "subtitle");
    assert.equal(state.spawns[0].proc.killed, true, "the tracked ffmpeg child is really killed");

    const again = await call("video.cancel", { args: [input] });
    assert.equal(again.cancelled, false, "nothing left to cancel");

    const journal = JSON.parse(fs.readFileSync(path.join(require("./store.ts").userDataDir(), "video", "jobs.json"), "utf8"));
    assert.equal(journal[0].status, "cancelled");
  });
});

test("registry-level: every video id dispatch-resolves to an envelope", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  const paramsFor = { "video.pickInput": {}, "video.subtitle": {}, "video.bgm": {}, "video.cancel": {} };
  for (const h of handlers) {
    const env = await dispatch(h.id, paramsFor[h.id] ?? {});
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
  }
});
