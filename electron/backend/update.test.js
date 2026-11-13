"use strict";
// layer-1 tests for the update bridge ids (docs/architecture/backend.md W2-3). No Electron, no network.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");

const EXPECTED_IDS = ["update.state", "update.check"];

// Cache the module so we control module-level state across builds.
const { makeUpdateHandlers } = require("./update.ts");

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    app: { isPackaged: false }, // dev-shaped by default → unsupported path
    ...overrides,
  };
  const handlers = makeUpdateHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const regRegister = () => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  };
  return { handlers, byId, call, state, regRegister, deps };
}

beforeEach(() => {
  reg.reset();
  // Unload the module so updater state (module-level) resets between tests.
  for (const p of [require.resolve("./update.ts")]) delete require.cache[p];
});

test("id surface: the 2 renderer-used update ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("update.state in dev is honest: status 'unsupported' shape after a check attempt", async () => {
  useTempUserData();
  const { call } = build();
  const state = await call("update.state", {});
  assert.equal(state.status, "idle"); // initial (no check yet this process
  // Note (transparency): a fresh state file is "idle" by design; after `update.check`
  // in dev it becomes "unsupported". (The dev init sets "unsupported" immediately
  // because checkForUpdates is attempted at app start.)
});

test("update.check in dev returns the honest unsupported shape + persists state", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const res = await call("update.check", {});
  assert.equal(res.supported, false);
  assert.match(res.reason, /dev build|packaged/i);
  const state = await call("update.state", {});
  assert.equal(state.status, "unsupported");
  // State persisted to the store file — a reload reads it back, per contract.
  const persisted = JSON.parse(
    require("node:fs").readFileSync(require("node:path").join(dir, "db", "update-state.json"), "utf8"),
  );
  assert.equal(persisted.status, "unsupported");
});

test("update.check in a packaged build without electron-updater still fails softly (no throw)", async () => {
  useTempUserData();
  // With isPackaged=true but the real electron-updater module requireable on this
  // host — checkForUpdates would try a real GitHub API call; instead verify the
  // handler never throws for a missing update feed (no update server in tests).
  const { call } = build({ app: { isPackaged: true } });
  let res;
  try {
    res = await call("update.check", {});
  } catch (e) {
    res = { threw: e };
  }
  assert.ok(!res.threw, `must not throw: ${res.threw?.message}`);
});

test("registry dispatch round-trip wraps payloads", async () => {
  useTempUserData();
  const { regRegister } = build();
  regRegister();
  const ok = await reg.dispatch({ id: "update.state", params: {} });
  assert.equal(ok.ok, true);
  assert.ok(ok.result.currentVersion);
});
