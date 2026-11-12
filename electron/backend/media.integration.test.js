"use strict";
// W2-11 integration tests — the media + video-editor pipelines against the
// REAL tools on this machine (doc 32 §2h).
//
// These are skipped when the tool is absent, so the suite stays green on a
// machine without ffmpeg / Remotion — but where the tool IS present, the test
// proves the REAL pipeline end to end (a real transcode, a real render, a real
// deck on disk), not a fake.
//
//   ffmpeg    → a real subtitle burn and a real bgm mix (real output files)
//   remotion  → the bundled template really bundles, lists and renders
//   slides    → a created deck really is a project on disk
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");

const { makeVideoHandlers } = require("./video.ts");
const { makeRemotionHandlers, findRemotionBin, templateDir } = require("./remotion.ts");
const { makeSlidesHandlers, scaffoldDeck } = require("./slides.ts");
const { resolveBin } = require("./params.ts");

const FFMPEG = resolveBin("ffmpeg");
const REMOTION = findRemotionBin();
const HAS_FFMPEG = !!FFMPEG;
const HAS_REMOTION = !!REMOTION;

/**
 * The REAL child_process spawn — this suite drives the real tools, so the
 * processes must be real too.
 */
function realSpawn() {
  const cp = require("node:child_process");
  return {
    spawn: (command, args, opts) => cp.spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }),
  };
}

function buildVideo(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: realSpawn(),
    ...overrides,
  };
  const handlers = makeVideoHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

before(() => {
  reg.reset();
});

test("ffmpeg: a REAL subtitle burn produces a real playable file", { skip: !HAS_FFMPEG ? "ffmpeg is not installed" : false }, async () => {
  useTempUserData();
  const { call } = buildVideo();

  // A real 2-second test clip (lavfi) — no fixtures needed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-media-"));
  const input = path.join(dir, "clip.mp4");
  const srt = path.join(dir, "clip.srt");
  const { spawnSync } = require("node:child_process");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10", "-pix_fmt", "yuv420p", input], { encoding: "utf8" });
  assert.equal(made.status, 0, `ffmpeg could not create the test clip: ${made.stderr}`);
  assert.ok(fs.existsSync(input));
  fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,500\nAutumn burns this in\n\n", "utf8");

  const res = await call("video.subtitle", { path: input, srtPath: srt });
  assert.equal(res.ok, undefined, "a real transcode does not answer an error envelope");
  assert.ok(res.path, "the transcode really wrote a file");
  assert.ok(fs.existsSync(res.path), "the output file really exists");
  assert.ok(res.bytes > 0, "the output file is not empty");
  assert.ok(res.durationMs >= 0);

  // The output really is a video: ffmpeg can probe it.
  const probe = spawnSync(FFMPEG, ["-i", res.path], { encoding: "utf8" });
  assert.match(probe.stderr, /Video:.*h264|mpeg4/, "the output really is a video stream");
});

test("ffmpeg: a REAL bgm mix produces a real file with the audio track", { skip: !HAS_FFMPEG ? "ffmpeg is not installed" : false }, async () => {
  useTempUserData();
  const { call } = buildVideo();
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-bgm-"));
  const input = path.join(dir, "clip.mp4");
  const audio = path.join(dir, "song.m4a");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10", "-pix_fmt", "yuv420p", input], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const tone = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", audio], { encoding: "utf8" });
  assert.equal(tone.status, 0, tone.stderr);

  const res = await call("video.bgm", { args: [input, audio] });
  assert.ok(res.path, "the mix really wrote a file");
  assert.ok(fs.existsSync(res.path));
  assert.ok(res.bytes > 0);
  const probe = spawnSync(FFMPEG, ["-i", res.path], { encoding: "utf8" });
  assert.match(probe.stderr, /Audio:/, "the mixed file really has an audio stream");
});

test("ffmpeg: the progress ffmpeg reports is really journaled", { skip: !HAS_FFMPEG ? "ffmpeg is not installed" : false }, async () => {
  const dir = useTempUserData();
  const { call } = buildVideo();
  const { spawnSync } = require("node:child_process");
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-prog-"));
  const input = path.join(media, "clip.mp4");
  const srt = path.join(media, "clip.srt");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10", "-pix_fmt", "yuv420p", input], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,500\nProgress\n\n", "utf8");

  await call("video.subtitle", { path: input, srtPath: srt });
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "video", "jobs.json"), "utf8"));
  assert.equal(journal[0].status, "done");
  assert.ok(typeof journal[0].progressSeconds === "number", "the parsed ffmpeg progress is journaled");
  assert.ok(journal[0].progressSeconds >= 0);
});

test(
  "remotion: the bundled template really bundles, lists its compositions and renders a video",
  {
    // Opt-in: the first render downloads the Remotion headless shell (~92 MB)
    // and takes ~50 s. Run it with AUTUMN_E2E_REMOTION=1 npm test.
    skip: !HAS_REMOTION
      ? "the Remotion CLI is not installed"
      : process.env.AUTUMN_E2E_REMOTION !== "1"
        ? "set AUTUMN_E2E_REMOTION=1 to run the real render (it downloads the headless shell)"
        : false,
    timeout: 900000,
  },
  async () => {
  useTempUserData();
  const { call } = (() => {
    const handlers = makeRemotionHandlers({ emit: () => {}, now: () => Date.now(), spawn: realSpawn() });
    const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
    return { byId, call: async (id, params = {}) => byId[id].handler(params, { principal: "desktop" }) };
  })();

  // The template really exists in the app tree.
  assert.ok(fs.existsSync(templateDir()), "the bundled template ships with the app");
  assert.ok(fs.existsSync(path.join(templateDir(), "src", "Root.tsx")));
  assert.ok(fs.existsSync(path.join(templateDir(), "package.json")));

  // A real project, created by the real handler.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-remotion-"));
  const saved = process.env.AUTUMN_PROJECTS_DIR;
  process.env.AUTUMN_PROJECTS_DIR = root;
  // The Remotion CLI downloads a ~350 MB headless shell into the project —
  // it MUST be removed again, or the tmpfs fills up and every other test
  // fails with ENOSPC.
  const { removeOnExit } = require("./store.ts");
  removeOnExit(root);
  try {
    const folder = await call("remotion.create", { name: "integration" });
    assert.ok(fs.existsSync(path.join(folder, "src", "Root.tsx")));
    assert.deepEqual(await call("remotion.compositions", folder), ["Caption", "PromoCard", "EndCard"]);

    // The REAL CLI really renders the composition (this downloads the headless
    // shell on the first run — hence the generous timeout).
    const out = path.join(root, "rendered.mp4");
    const res = await call("remotion.render", { folder, composition: "Caption", outPath: out });
    assert.equal(res.ok, undefined, `the real render must not fail: ${JSON.stringify(res)}`);
    assert.ok(fs.existsSync(out), "the real render really produced a video file");
    assert.ok(res.bytes > 1000, "the rendered video has real content");
    assert.ok(res.durationMs >= 0);
  } finally {
    if (saved === undefined) delete process.env.AUTUMN_PROJECTS_DIR;
    else process.env.AUTUMN_PROJECTS_DIR = saved;
  }
  },
);

test("slides: a created deck is a REAL project on disk (slides.json + index.html)", async () => {
  useTempUserData();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-slides-"));
  const saved = process.env.AUTUMN_PROJECTS_DIR;
  process.env.AUTUMN_PROJECTS_DIR = root;
  require("./store.ts").removeOnExit(root);
  try {
    const handlers = makeSlidesHandlers({ emit: () => {}, now: () => Date.now() });
    const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
    const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });

    const folder = await call("slides.create", { name: "Quarterly" });
    assert.ok(fs.existsSync(path.join(folder, "index.html")), "the deck really has an entry file");
    assert.ok(fs.existsSync(path.join(folder, "slides.json")));
    const meta = JSON.parse(fs.readFileSync(path.join(folder, "slides.json"), "utf8"));
    assert.equal(meta.title, "Quarterly");
    const html = fs.readFileSync(path.join(folder, "index.html"), "utf8");
    assert.match(html, /Quarterly/, "the deck really carries its title");
    assert.match(html, /ArrowRight/, "the deck really has the keyboard navigation");

    // The scaffold never overwrites an existing deck.
    fs.writeFileSync(path.join(folder, "index.html"), "<html>mine</html>", "utf8");
    const written = scaffoldDeck(folder, "Other", []);
    assert.deepEqual(written, [], "an existing deck is left alone");
    assert.equal(fs.readFileSync(path.join(folder, "index.html"), "utf8"), "<html>mine</html>");
  } finally {
    if (saved === undefined) delete process.env.AUTUMN_PROJECTS_DIR;
    else process.env.AUTUMN_PROJECTS_DIR = saved;
  }
});
