"use strict";
// layer-1 tests for the slides bridge ids (doc 32 W2-5 §2h). 4 dispatchable:
// create (RE slug+uuid8+"-slides" + freeChildName nesting), start (DECK mode —
// real self-contained deck HTML; FOLDER mode — RE ownership error-state),
// status (persisted deck record / RE folder state), stop (RE empty-owned-folder
// cleanup). Headless: no Electron runtime → honest opened:false + error states,
// never a claimed running view.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeSlidesHandlers } = require("./slides.ts");

const DISPATCHABLE = manifest.bridge.namespaces.slides; // 4

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeSlidesHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

/** Point the projects root at a temp dir for the duration of `fn`. */
async function withProjectsRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-projects-"));
  const saved = process.env.AUTUMN_PROJECTS_DIR;
  process.env.AUTUMN_PROJECTS_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (saved === undefined) delete process.env.AUTUMN_PROJECTS_DIR;
    else process.env.AUTUMN_PROJECTS_DIR = saved;
  }
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./slides.ts")]) delete require.cache[p];
});

test("id surface: 4 slides ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 4);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `slides.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("create: RE slug + uuid8 + '-slides' under the projects root", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const folder = await call("slides.create", {});
    assert.ok(folder.startsWith(root + path.sep), `must land under the projects root: ${folder}`);
    assert.match(path.basename(folder), /^autumn-[0-9a-f]{8}-slides$/);
    assert.ok(fs.existsSync(folder), "folder really created");

    const named = await call("slides.create", { name: "Quarterly Review!" });
    assert.match(path.basename(named), /^quarterly-review-[0-9a-f]{8}-slides$/);
  });
});

test("create: nesting under an OWNED parent via freeChildName (empty → slides, taken → slides-2)", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const parent = path.join(root, "deck-parent");
    fs.mkdirSync(parent, { recursive: true });

    const first = await call("slides.create", { parent });
    assert.equal(path.dirname(first), parent);
    assert.equal(path.basename(first), "slides", "empty child name is free");

    fs.writeFileSync(path.join(first, "x.html"), "<html></html>", "utf8"); // now non-empty
    const second = await call("slides.create", { parent });
    assert.equal(path.basename(second), "slides-2", "taken → slides-2");

    // Non-owned parent falls back to the top-level slug+uuid8 form.
    const foreign = await call("slides.create", { parent: "/tmp/definitely-not-ours" });
    assert.match(path.basename(foreign), /^autumn-[0-9a-f]{8}-slides$/);
  });
});

test("start DECK mode: real deck HTML written; headless honest opened:false; status returns the record", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const res = await call("slides.start", { title: "Wave 2", slides: ["One", "Two", "Three"] });
  assert.equal(res.title, "Wave 2");
  assert.equal(res.slides, 3);
  assert.equal(res.opened, false, "no Electron runtime → window never shown");
  assert.equal(res.active, false, "never claim active for a window that wasn't opened");
  assert.ok(res.reason, "honest reason explains why");
  assert.ok(fs.existsSync(res.path), "deck HTML really rendered");
  const html = fs.readFileSync(res.path, "utf8");
  assert.match(html, /Wave 2/);
  assert.match(html, /ArrowRight/, "keyboard navigation really present");
  assert.match(html, /3\/3|One/, "slide content really rendered");
  assert.ok(res.path.startsWith(path.join(dir, "slides")));

  const status = await call("slides.status", {});
  assert.equal(status.deckId, res.deckId);
  assert.equal(status.active, false);
  assert.equal(status.slides, 3);
});

test("start FOLDER mode: non-owned → RE error-state pointing outside the root", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const res = await call("slides.start", "/etc");
    assert.equal(res.status, "error");
    assert.match(res.message, /points outside/);
    assert.match(res.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    void root;
  });
});

test("start FOLDER mode: owned without index.html → error; owned headless → Electron-runtime error", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const empty = path.join(root, "empty-deck");
    fs.mkdirSync(empty, { recursive: true });
    const noEntry = await call("slides.start", { folder: empty });
    assert.equal(noEntry.status, "error");
    assert.match(noEntry.message, /no index\.html/);

    const withEntry = path.join(root, "real-deck");
    fs.mkdirSync(withEntry, { recursive: true });
    fs.writeFileSync(path.join(withEntry, "index.html"), "<!doctype html><title>hi</title>", "utf8");
    const res = await call("slides.start", withEntry);
    assert.equal(res.status, "error");
    assert.match(res.message, /Electron runtime/, "headless must not claim a running view");
  });
});

test("status: default {status:'idle'} for an unknown folder; RE shape after start", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const fresh = await call("slides.status", path.join(root, "never-started"));
    assert.deepEqual(fresh, { folder: path.join(root, "never-started"), status: "idle" });
    void root;
  });
});

test("stop FOLDER mode: RE cleanup — removes an OWNED empty folder, leaves a non-empty one", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const empty = path.join(root, "doomed-deck");
    fs.mkdirSync(empty, { recursive: true });
    const res = await call("slides.stop", { folder: empty });
    assert.equal(res.status, "idle");
    assert.ok(!fs.existsSync(empty), "empty owned folder removed, like RE");

    const busy = path.join(root, "busy-deck");
    fs.mkdirSync(busy, { recursive: true });
    fs.writeFileSync(path.join(busy, "index.html"), "<html></html>", "utf8");
    await call("slides.stop", busy);
    assert.ok(fs.existsSync(busy), "non-empty folder survives cleanup");
  });
});

test("stop (deck mode): clears the persisted record → {active:false, deckId}", async () => {
  useTempUserData();
  const { call } = build();
  const started = await call("slides.start", { title: "T", slides: ["a"] });
  const stopped = await call("slides.stop", {});
  assert.deepEqual(stopped, { active: false, deckId: started.deckId });
  const status = await call("slides.status", {});
  assert.equal(status.active, false);
  const again = await call("slides.stop", {});
  assert.equal(again.active, false, "idempotent — already stopped");
  assert.equal(again.deckId, started.deckId);
});

test("registry-level: every slides id dispatch-resolves", async () => {
  useTempUserData();
  await withProjectsRoot(async () => {
    const { handlers, dispatch } = build();
    const paramsFor = { "slides.create": {}, "slides.start": {}, "slides.status": {}, "slides.stop": {} };
    for (const h of handlers) {
      const env = await dispatch(h.id, paramsFor[h.id] ?? {});
      assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
      if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
    }
  });
});
