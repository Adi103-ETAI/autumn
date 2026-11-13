"use strict";
// layer-1 tests for the browser bridge ids (docs/architecture/backend.md W2-8 §2e). 11 dispatchable
// (view registry, profiles, history, downloads, import, links, capture,
// present, workspace preview, clear data) + 2 push-only subscriptions
// (onActivity, onPresentationStopped).
//
// shapes that must hold: register/unregister/setLinks/capture/present take
// positional args; history.prefix must be a string ≤256 ("Invalid history
// query."); profiles expose the profile manager (resolve/create/rename/
// duplicate/clear/delete/setAgentAccess/bind/discardUnrecoverable) over REAL
// session partitions; present's enabled gate is a boolean; import really
// parses a cookie file.
//
// No Electron, no network: every window/view-dependent op must report an
// honest {supported:false} or null instead of pretending.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const {
  makeBrowserHandlers,
  _appendHistory,
  _noteActivity,
  _recordDownload,
  _browserDir,
  _readProfiles,
  _parseCookieFile,
  _listBrowserRoots,
  _readDownloadsDir,
  _readLinks,
  _listViews,
} = require("./browser.ts");

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
  const dispatch = async (id, params = {}) => {
    register();
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, register, dispatch, state, deps };
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

test("register/unregister track views (positional shape)", async () => {
  useTempUserData();
  const { call } = build();
  const regd = await call("browser.register", { args: ["canvas-1", "node-9", 42, "doc-a"] });
  assert.deepEqual(regd, { registered: true, views: 1, profileId: "default" });

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

test("profiles: the profile manager over REAL session partitions", async () => {
  useTempUserData();
  const { call } = build();
  const list = await call("browser.profiles", {});
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "default");
  assert.equal(list[0].partition, "persist:autumn-embedded", "the default profile's partition");
  assert.equal(list[0].agentAccess, "allowed");

  const created = await call("browser.profiles", { action: "create", name: "Work Profile" });
  assert.match(created.id, /^bp_[0-9a-f-]{36}$/, "profile id shape");
  assert.match(created.partition, /^persist:autumn-bp-[0-9a-f-]{36}$/, "partition shape");
  assert.ok(created.boundNodes === 0);
  assert.ok(fs.existsSync(path.join(_browserDir(), "partitions", created.id)), "the profile dir really exists");

  const renamed = await call("browser.profiles", { action: "rename", id: created.id, name: "Renamed" });
  assert.equal(renamed.name, "Renamed");

  const dup = await call("browser.profiles", { action: "duplicate", id: created.id });
  assert.equal(dup.name, "Renamed copy");
  assert.notEqual(dup.id, created.id);
  assert.notEqual(dup.partition, created.partition, "a duplicate gets its own partition");

  const missingName = await call("browser.profiles", { action: "create" });
  assert.equal(missingName.ok, false);
  assert.equal(missingName.error.code, "bad-params");

  const tooLong = await call("browser.profiles", { action: "create", name: "x".repeat(65) });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error.code, "bad-params");

  const missingId = await call("browser.profiles", { action: "rename", id: "ghost", name: "x" });
  assert.equal(missingId.ok, false);
  assert.equal(missingId.error.code, "not-found");

  const removeDefault = await call("browser.profiles", { action: "delete", id: "default" });
  assert.equal(removeDefault.ok, false);
  assert.equal(removeDefault.error.code, "bad-params");

  const removed = await call("browser.profiles", { action: "delete", id: created.id });
  assert.equal(removed.deleted, true);

  const unknown = await call("browser.profiles", { action: "teleport" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-params");
});

test("profiles: agent access ladder, binding and the review gate", async () => {
  useTempUserData();
  const { call } = build();
  const created = await call("browser.profiles", { action: "create", name: "Policy" });

  const blocked = await call("browser.profiles", { action: "setAgentAccess", id: created.id, access: "blocked" });
  assert.equal(blocked.agentAccess, "blocked");

  const bad = await call("browser.profiles", { action: "setAgentAccess", id: created.id, access: "open" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const bound = await call("browser.profiles", { action: "bind", canvasId: "c1", nodeId: "n1", id: created.id });
  assert.equal(bound.boundNodes, 1);
  const resolved = await call("browser.profiles", { action: "resolve", canvasId: "c1", nodeId: "n1" });
  assert.equal(resolved.id, created.id, "the bound profile is resolved");

  const missing = await call("browser.profiles", { action: "bind", canvasId: "c1", nodeId: "n1", id: "ghost" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
});

test("profiles: clear wipes the partition's history; discardUnrecoverable drops broken profiles", async () => {
  useTempUserData();
  const { call } = build();
  const created = await call("browser.profiles", { action: "create", name: "Clearable" });
  _appendHistory(created.partition, "https://example.com/");

  const cleared = await call("browser.profiles", { action: "clear", id: created.id });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.history, 1);
  assert.equal(cleared.storage, false, "no Electron session → storage not cleared, reported honestly");

  // A profile whose directory vanished is unrecoverable.
  fs.rmSync(path.join(_browserDir(), "partitions", created.id), { recursive: true, force: true });
  const discarded = await call("browser.profiles", { action: "discardUnrecoverable" });
  assert.equal(discarded.count, 1);
  assert.ok(discarded.discarded.includes(created.id));
  const after = await call("browser.profiles", {});
  assert.equal(after.length, 1, "only the default profile survives");
});

test("history: newest-first, prefix filter, 256-char validation, clear", async () => {
  useTempUserData();
  const { call } = build();
  _appendHistory("persist:autumn-embedded", "https://example.com/one", "One");
  _appendHistory("persist:autumn-embedded", "https://example.com/two", "Two");
  _appendHistory("persist:autumn-embedded", "https://other.test/x", "Other");

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
  assert.equal(_readDownloadsDir(), null);

  const pick = await call("browser.downloads", { action: "pickDir" });
  assert.equal(pick.supported, false, "no dialog without the Electron runtime");
  assert.ok(typeof pick.reason === "string" && pick.reason.length > 0);
});

test("import: sources really detect the installed browsers; run imports a cookie file", async () => {
  useTempUserData();
  const { call } = build();
  const sources = await call("browser.import", { action: "sources" });
  assert.ok(Array.isArray(sources));
  assert.ok(sources.length >= 1, "at least the known browser roots are listed");
  assert.ok(sources.every((s) => typeof s.installed === "boolean"));
  assert.ok(sources.every((s) => s.importable === false), "reading a browser's own store needs the OS keychain");
  assert.ok(sources.some((s) => s.reason && /keychain/i.test(s.reason)));
  assert.ok(_listBrowserRoots().length >= 1);

  // A real cookie file (Netscape format) really parses.
  const file = path.join(os.tmpdir(), `autumn-cookies-${Date.now()}.txt`);
  fs.writeFileSync(
    file,
    ["# Netscape HTTP Cookie File", ".example.com\tTRUE\t/\tTRUE\t0\tname\tvalue", "example.com\tFALSE\t/\tFALSE\t0\tother\t2"].join("\n"),
    "utf8",
  );
  const parsed = _parseCookieFile(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "name");
  assert.equal(parsed[0].domain, ".example.com");
  assert.equal(parsed[0].secure, true);
  assert.equal(parsed[1].value, "2");

  // JSON cookies parse too.
  const json = _parseCookieFile(JSON.stringify([{ name: "a", value: "b", domain: "x.test" }]));
  assert.equal(json.length, 1);
  assert.equal(json[0].name, "a");

  // Without a file there is nothing to import — honest, never a fake success.
  const noFile = await call("browser.import", { action: "run", profileId: "default" });
  assert.equal(noFile.supported, false);
  assert.match(noFile.reason, /cookie file/i);

  const empty = await call("browser.import", { action: "run", profileId: "default", file: path.join(os.tmpdir(), "does-not-exist.txt") });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "handler-error");
});

test("setLinks: validates and persists the allowlist; pair shape; applied only with a live webContents", async () => {
  useTempUserData();
  const { call, register } = build();
  const ok = await call("browser.setLinks", { allowlist: ["https://ok.example/*", { pattern: "*.cdn.net" }] });
  assert.equal(ok.links, 2);
  assert.equal(ok.applied, 0, "headless: no live view to apply to");
  assert.equal(ok.ready, true, "no browser ids were named → nothing pending");
  assert.deepEqual(_readLinks().map((r) => r.pattern), ["https://ok.example/*", "*.cdn.net"]);

  // pairs: [pattern, browserId].
  const pairs = await call("browser.setLinks", { args: ["canvas-1", [["https://x.test/*", "node-1"]]] });
  assert.equal(pairs.links, 1);
  assert.equal(pairs.ready, false, "the named browser is not live → pending");
  assert.deepEqual(pairs.pendingBrowserIds, ["node-1"]);

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
  _appendHistory("persist:autumn-embedded", "https://a.test/");
  _appendHistory("persist:autumn-embedded", "https://b.test/");
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
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-cap-"));
  const res = await call("browser.capture", { args: ["n1", dest] });
  assert.equal(res, null, "falsy result for a failed/absent capture");
});

test("present: boolean gate error, stop idempotent, open honest headless", async () => {
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

test("workspacePreview: honest {supported:false} without the Electron runtime; session resolves the partition", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("browser.workspacePreview", { action: "request", url: "https://example.com" });
  assert.equal(res.supported, false);
  assert.match(res.reason, /Autumn window/);

  const session = await call("browser.workspacePreview", { action: "session" });
  assert.equal(session.partition, "persist:autumn-embedded");
  assert.equal(session.profileId, "default");

  const release = await call("browser.workspacePreview", { action: "release", leaseId: "lease-nope" });
  assert.equal(release.released, false);

  const unknown = await call("browser.workspacePreview", { action: "levitate" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-params");
});

test("onActivity: the seam path emits and appends history — one real navigation observation", async () => {
  useTempUserData();
  const { call, state } = build();
  _noteActivity((id, payload) => state.emitted.push([id, payload]), { canvasId: "c1", nodeId: "n1", url: "https://nav.example/", title: "Nav" });
  const evt = state.emitted.find(([id]) => id === "browser.onActivity");
  assert.ok(evt, "browser.onActivity must fire on the observed navigation");
  assert.equal(evt[1].url, "https://nav.example/");
  assert.equal(evt[1].canvasId, "c1");
  const hist = await call("browser.history", { action: "query" });
  assert.equal(hist[0].url, "https://nav.example/");
  assert.equal(hist[0].title, "Nav");
});

test("registry-level: every browser id dispatch-resolves", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  const paramsFor = {
    "browser.workspacePreview": { action: "session" },
    "browser.downloads": { action: "list" },
    "browser.import": { action: "sources" },
    "browser.history": { action: "query" },
    "browser.profiles": { action: "list" },
    "browser.present": { enabled: false },
    "browser.register": { canvasId: "c1", nodeId: "n1" },
    "browser.unregister": { canvasId: "c1", nodeId: "n1" },
    "browser.setLinks": { allowlist: ["https://ok.test/*"] },
    "browser.clearData": {},
    "browser.capture": { nodeId: "n1", destDir: os.tmpdir() },
  };
  for (const h of handlers) {
    const env = await dispatch(h.id, paramsFor[h.id] ?? {});
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
  }
});
