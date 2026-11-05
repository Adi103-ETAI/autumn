"use strict";
// layer-1 tests for the settings bridge ids (doc 32 W2-1). Real JSON store
// against a temp AUTUMN_USER_DATA_DIR — no Electron, no Prisma.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");
const { makeSettingsHandlers } = require("./settings.ts");

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeSettingsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

const EXPECTED_IDS = ["settings.get", "settings.set", "settings.resetFtue", "settings.authStatus"];

beforeEach(() => reg.reset());

test("id surface: the 4 renderer-used settings ids, all in the manifest", () => {
  useTempUserData();
  const { handlers, byId } = build();
  assert.equal(handlers.length, 4);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("settings.get() with no keys returns the WHOLE document (RE shape)", async () => {
  useTempUserData();
  const { call } = build();
  const initial = await call("settings.get", {});
  assert.deepEqual(initial, {}); // fresh store = empty object
  await call("settings.set", { theme: "dark", minimapVisible: true });
  const whole = await call("settings.get", {});
  assert.equal(whole.theme, "dark");
  assert.equal(whole.minimapVisible, true);
});

test("settings.set(patch) merges shallowly, one level deeper for objects", async () => {
  useTempUserData();
  const { call } = build();
  await call("settings.set", { autoMergeSessions: false, sshServers: ["a", "b"] });
  await call("settings.set", { sshServers: ["c"], wallpaper: "autumn:maple" });
  const whole = await call("settings.get", {});
  assert.deepEqual(whole.sshServers, ["c"]); // replaced, not appended
  assert.equal(whole.wallpaper, "autumn:maple");
  assert.equal(whole.autoMergeSessions, false);
});

test("settings survive restart: a fresh factory instance reads the same file", async () => {
  const dir = useTempUserData();
  const first = build();
  await first.call("settings.set", { defaultHarness: "claude", onboardingCompletedAt: 1234 });
  const second = build(); // fresh load path — same data dir
  const doc = await second.call("settings.get", {});
  assert.equal(doc.defaultHarness, "claude");
  assert.equal(doc.onboardingCompletedAt, 1234);
  const files = fs.readdirSync(path.join(dir, "db"));
  assert.ok(files.includes("app-settings.json"), "settings file persisted under <userData>/db");
});

test("settings.resetFtue clears FTUE/onboarding keys only", async () => {
  useTempUserData();
  const { call } = build();
  await call("settings.set", { onboardingCompletedAt: 111, theme: "dark", ftue: "done" });
  const res = await call("settings.resetFtue", {});
  assert.deepEqual(res.removed.sort(), ["ftue", "onboardingCompletedAt"]);
  const doc = await call("settings.get", {});
  assert.equal(doc.onboardingCompletedAt, undefined);
  assert.equal(doc.ftue, undefined);
  assert.equal(doc.theme, "dark");
});

test("settings.authStatus is honest: keychainAvailable false (no OS keychain), providerMode read-through", async () => {
  useTempUserData();
  const { call } = build();
  await call("settings.set", { providerMode: "api-key" });
  const res = await call("settings.authStatus", {});
  assert.equal(res.keychainAvailable, false);
  assert.equal(res.providerMode, "api-key");
});

test("settings.set(patch) emits settings.onSshServersChanged when patch touches ssh keys", async () => {
  useTempUserData();
  const { call, state } = build();
  await call("settings.set", { theme: "dark" });
  assert.deepEqual(state.emitted, []); // non-ssh patch: no event
  await call("settings.set", { sshServers: ["prod.internal"] });
  const ev = state.emitted.find(([id]) => id === "settings.onSshServersChanged");
  assert.ok(ev, "ssh write must emit onSshServersChanged");
  assert.deepEqual(ev[1].keys, ["sshServers"]);
});

test("settings.set rejects bad patches with bad-params", async () => {
  useTempUserData();
  const { call } = build();
  assert.equal((await call("settings.set", {})).error.code, "bad-params"); // empty
  assert.equal((await call("settings.set", [])).error.code, "bad-params"); // array not object
  assert.equal((await call("settings.set", { "bad key!": 1 })).error.code, "bad-params");
  assert.equal((await call("settings.set", { key: undefined })).error.code, "bad-params"); // not serializable
  assert.equal((await call("settings.set", { arr: [1, undefined] })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  useTempUserData();
  reg.reset();
  const handlers = makeSettingsHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "settings.get", params: {} });
  assert.equal(ok.ok, true);
  const bad = await reg.dispatch({ id: "settings.set", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
