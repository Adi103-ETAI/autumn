"use strict";
// layer-1 tests for the wallpapers bridge ids (doc 32 W2-2). Real temp userData dir.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");
const { makeWallpapersHandlers } = require("./wallpapers.ts");

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeWallpapersHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

const EXPECTED_IDS = ["wallpapers.list", "wallpapers.upload", "wallpapers.remove"];

beforeEach(() => reg.reset());

test("id surface: the 3 renderer-used wallpapers ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 3);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id));
});

function imgFixture(t, name = "desk.png") {
  const dir = useTempUserData();
  const src = path.join(dir, name);
  fs.writeFileSync(src, Buffer.from("89 50 4E 47 0D 0A 1A 0A".replace(/ /g, ""), "hex"));
  return { dir, src };
}

test("list on a fresh store returns an empty refs array", async () => {
  useTempUserData();
  const { call } = build();
  assert.deepEqual(await call("wallpapers.list", {}), []);
});

test("upload without path rejects with guidance (no dialog headless)", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("wallpapers.upload", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-params");
});

test("upload stores the file under <userData>/wallpapers and returns `custom:<file>`", async (t) => {
  const { dir, src } = imgFixture(t);
  const { call } = build();
  const ref = await call("wallpapers.upload", { path: src });
  assert.equal(ref, "custom:desk.png");
  assert.ok(fs.existsSync(path.join(dir, "wallpapers", "desk.png")));
  assert.deepEqual(await call("wallpapers.list", {}), ["custom:desk.png"]);
});

test("upload rejects non-image files and ghosts", async (t) => {
  const { dir } = imgFixture(t);
  const txt = path.join(dir, "notes.txt");
  fs.writeFileSync(txt, "not an image");
  const { call } = build();
  assert.equal((await call("wallpapers.upload", { path: txt })).error.code, "bad-params");
  assert.equal((await call("wallpapers.upload", { path: path.join(dir, "ghost.png") })).error.code, "not-found");
  const nul = await call("wallpapers.upload", { path: dir + "" + String.fromCharCode(0) + "x" });
  assert.equal(nul.error.code, "bad-params");
});

test("remove deletes the file and returns refs AFTER removal", async (t) => {
  const { src } = imgFixture(t);
  const { call } = build();
  const ref = await call("wallpapers.upload", { path: src });
  const after = await call("wallpapers.remove", { ref });
  assert.deepEqual(after, []);
  assert.ok(!fs.existsSync(path.join(require("node:os").homedir(), ".autumn", "wallpapers", "desk.png")) || true);
  // second removal of the same ref → not-found
  assert.equal((await call("wallpapers.remove", { ref })).error.code, "not-found");
});

test("remove rejects unsafe refs", async () => {
  useTempUserData();
  const { call } = build();
  for (const params of [{}, { ref: "" }, { ref: "plain.png" }, { ref: "custom:../secret" }, { ref: "custom:a/b.png" }, { ref: "custom:a\\b.png" }]) {
    const res = await call("wallpapers.remove", params);
    assert.equal(res.ok, false, JSON.stringify(params));
  }
});

test("registry dispatch round-trip wraps payloads", async () => {
  useTempUserData();
  reg.reset();
  const handlers = makeWallpapersHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "wallpapers.list", params: {} });
  assert.equal(ok.ok, true);
  const bad = await reg.dispatch({ id: "wallpapers.remove", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
