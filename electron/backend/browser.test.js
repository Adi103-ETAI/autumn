"use strict";
// layer-1 tests for the browser bridge ids (doc 32 W2-5 §2e). 11 dispatchable
// (view registry, profiles/history/downloads, links, capture, present,
// workspace preview) + 2 push-only subscriptions (onActivity,
// onPresentationStopped). No Electron, no network: every window/view-dependent
// op must report an honest {supported:false} or null instead of pretending.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeBrowserHandlers, _appendHistory, _noteActivity, _recordDownload, _browserDir } = require("./browser.ts");

const DISPATCHABLE = manifest.bridge.namespaces.browser.filter((m) => !/^on[A-Z]/.test(m)); // 11
const SUBSCRIPTIONS = manifest.bridge.namespaces.browser.filter((m) => /^on[A-Z]/.test(m)); // 2

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeBrowserHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const register = () => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  };
  return { handlers, byId, call, register, state, deps };
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./browser.ts")]) delete require.cache[p];
});

test("id surface: 11 dispatchable browser ids in the manifest; the 2 on* ids are push-only", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 11);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `browser.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
  for (const m of SUBSCRIPTIONS) {
    assert.ok(reg.inManifest("bridge", `browser.${m}`), `browser.${m} must stay in the target surface`);
    assert.ok(!handlers.some((h) => h.id === `browser.${m}`), `browser.${m} must be a subscription, not a handler`);
  }
});

test("register/unregister track views (RE positional shape)", async () => {
  useTempUserData();
  const { call } = build();
  const regd = await call("browser.register", { args: ["canvas-1", "node-9", 42, "doc-a"] });
  assert.deepEqual(regd, { registered: true, views: 1 });

  const again = await call("browser.register", { canvasId: "canvas-1", nodeId: "node-9" });
  assert.equal(again.views, 1, "re-registering the same pair must not duplicate");

  const missing = await call("browser.register", { nodeId: "only-node" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "bad-params");

  const un = await call("browser.unregister", { args: ["canvas-1", "node-9"] });
  assert.deepEqual(un, { unregistered: true, views: 0 });
  const un2 = await call("browser.unregister", { canvasId: "canvas-1", nodeId: "node-9" });
  assert.equal(un2.unregistered, false, "unregistering twice is idempotent");
});

test("history: newest-first, prefix filter, RE 256-char validation, clear", async () => {
  useTempUserData();
  const { call } = build();
  _appendHistory("partition-default", "https://example.com/one", "One");
  _appendHistory("partition-default", "https://example.com/two", "Two");
  _appendHistory("partition-default", "https://other.test/x", "Other");

  const all = await call("browser.history", { action: "query" });
  assert.equal(all.length, 3);
  assert.equal(all[0].url, "https://other.test/x", "newest first");

  const filtered = await call("browser.history", { action: "query", prefix: "https://example.com/" });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((e) => e.url.startsWith("https://example.com/")));

  const long = "x".repeat(257);
  const bad = await call("browser.history", { action: "query", prefix: long });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.match(bad.error.message, /Invalid history query\./);

  const cleared = await call("browser.history", { action: "clear" });
  assert.equal(cleared.cleared, 3);
  assert.deepEqual(await call("browser.history", { action: "query" }), []);
});

test("profiles: default seeded, create/rename/remove with not-found and guard rails", async () => {
  useTempUserData();
  const { call } = build();
  const list = await call("browser.profiles", {});
  assert.equal(list[0].id, "default");

  const created = await call("browser.profiles", { action: "create", name: "Work Profile" });
  assert.equal(created.name, "Work Profile");
  assert.ok(created.partition);

  const renamed = await call("browser.profiles", { action: "rename", id: created.id, name: "Renamed" });
  assert.equal(renamed.name, "Renamed");

  const missingName = await call("browser.profiles", { action: "create" });
  assert.equal(missingName.ok, false);
  assert.equal(missingName.error.code, "bad-params");

  const missingId = await call("browser.profiles", { action: "rename", id: "ghost", name: "x" });
  assert.equal(missingId.ok, false);
  assert.equal(missingId.error.code, "not-found");

  const removeDefault = await call("browser.profiles", { action: "remove", id: "default" });
  assert.equal(removeDefault.ok, false);
  assert.equal(removeDefault.error.code, "bad-params");

  const removed = await call("browser.profiles", { action: "remove", id: created.id });
  assert.equal(removed.removed, true);

  const unknown = await call("browser.profiles", { action: "teleport" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-params");
});

test("downloads: real records via the seam, resetDir clears, pickDir honest headless", async () => {
  useTempUserData();
  const { call } = build();
  assert.deepEqual(await call("browser.downloads", {}), []);
  _recordDownload({ name: "clip.mp4", bytes: 1024, state: "completed" });
  const list = await call("browser.downloads", { action: "list" });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "clip.mp4");
  assert.ok(fs.existsSync(path.join(_browserDir(), "downloads.json")));

  const reset = await call("browser.downloads", { action: "resetDir" });
  assert.deepEqual(reset, { dir: null, reset: true });

  const pick = await call("browser.downloads", { action: "pickDir" });
  assert.equal(pick.supported, false, "no dialog without the Electron runtime");
  assert.ok(typeof pick.reason === "string" && pick.reason.length > 0);
});

test("import: cookies honest headless; sources/run answer with the W2-8 pointer; unknown action → bad-params", async () => {
  useTempUserData();
  const { call } = build();
  const cookies = await call("browser.import", { action: "cookies" });
  assert.equal(cookies.supported, false);
  const sources = await call("browser.import", { action: "sources" });
  assert.equal(sources.supported, false);
  assert.match(sources.reason, /W2-8/);
  const unknown = await call("browser.import", { action: "beam" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-params");
});

test("setLinks: validates and persists the allowlist; applied only with a live webContents", async () => {
  useTempUserData();
  const { call, register } = build();
  const ok = await call("browser.setLinks", { allowlist: ["https://ok.example/*", { pattern: "*.cdn.net" }] });
  assert.equal(ok.links, 2);
  assert.equal(ok.applied, 0, "headless: no live view to apply to");
  const saved = JSON.parse(fs.readFileSync(path.join(_browserDir(), "links.json"), "utf8"));
  assert.deepEqual(saved.allowlist, ["https://ok.example/*", "*.cdn.net"]);

  const bad = await call("browser.setLinks", { allowlist: [42] });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  register();
  const schemaRejected = await reg.dispatch({ id: "browser.setLinks", params: {} });
  assert.equal(schemaRejected.ok, false);
  assert.equal(schemaRejected.error.code, "bad-params");
});

test("clearData: wipes the partition history for real; storage clear needs the session", async () => {
  useTempUserData();
  const { call } = build();
  _appendHistory("partition-default", "https://a.test/");
  _appendHistory("partition-default", "https://b.test/");
  const res = await call("browser.clearData", {});
  assert.equal(res.cleared, true);
  assert.equal(res.history, 2);
  assert.equal(res.storage, false, "no Electron session → storage not cleared, reported honestly");
  assert.deepEqual(await call("browser.history", { action: "query" }), []);
});

test("capture: null when there is no live view (renderer treats null as failure — never a truthy object)", async () => {
  useTempUserData();
  const { call } = build();
  const noDest = await call("browser.capture", { nodeId: "n1" });
  assert.equal(noDest.ok, false);
  assert.equal(noDest.error.code, "bad-params");

  await call("browser.register", { canvasId: "c1", nodeId: "n1" }); // no webContentsId → no live view
  const dest = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "autumn-cap-"));
  const res = await call("browser.capture", { args: ["n1", dest] });
  assert.equal(res, null, "falsy result for a failed/absent capture");
});

test("present: RE boolean gate error, stop idempotent, open honest headless", async () => {
  useTempUserData();
  const { call, state } = build();
  const gated = await call("browser.present", { args: ["c1", "cloud-1", "n1", "not-a-boolean"] });
  assert.equal(gated.ok, false);
  assert.equal(gated.error.code, "bad-params");
  assert.match(gated.error.message, /Choose whether to present this browser\./);

  const stopNothing = await call("browser.present", { enabled: false });
  assert.deepEqual(stopNothing, { presented: false, stopped: 0 });
  assert.equal(state.emitted.length, 0, "stopping nothing must not emit");

  const open = await call("browser.present", { enabled: true, url: "https://example.com" });
  assert.equal(open.supported, false, "no window without Electron");
  assert.ok(open.reason);
});

test("workspacePreview: honest {supported:false} without the Electron runtime", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("browser.workspacePreview", { url: "https://example.com" });
  assert.equal(res.supported, false);
  assert.match(res.reason, /Autumn window/);
});

test("onActivity: the seam path emits and appends history — one real navigation observation", async () => {
  useTempUserData();
  const { call, state } = build();
  const emit = (id, payload) => state.emitted.push([id, payload]);
  _noteActivity(emit, { canvasId: "c1", nodeId: "n1", url: "https://nav.example/", title: "Nav" });
  const evt = state.emitted.find(([id]) => id === "browser.onActivity");
  assert.ok(evt, "browser.onActivity must fire on the observed navigation");
  assert.equal(evt[1].url, "https://nav.example/");
  assert.equal(evt[1].canvasId, "c1");
  const hist = await call("browser.history", { action: "query" });
  assert.equal(hist[0].url, "https://nav.example/");
  assert.equal(hist[0].title, "Nav");
});
