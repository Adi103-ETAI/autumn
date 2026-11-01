"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildFacade, isEventMethod } = require("./facade");
const manifest = require("./manifest.json");

function build(overrides = {}) {
  const calls = [];
  const subs = [];
  const facade = buildFacade({
    manifest,
    invoke: (req) => {
      calls.push(req);
      return Promise.resolve({ ok: true, result: null });
    },
    subscribe: (id, cb) => {
      subs.push({ id, cb });
      return () => subs.pop(); // unsubscribe
    },
    legacy: { openFileDialog: () => "legacy", onTerminalData: () => () => {} },
    inspect: () => "inspector",
    ...overrides,
  });
  return { facade, calls, subs };
}

test("facade exposes all 68 namespaces from the manifest", () => {
  const { facade } = build();
  const ns = Object.keys(manifest.bridge.namespaces);
  for (const name of ns) {
    assert.ok(facade[name], `namespace ${name} missing`);
    assert.equal(typeof facade[name], "object");
  }
});

test("facade exposes all 572 methods, callable with (params) => envelope", async () => {
  const { facade, calls } = build();
  let count = 0;
  for (const [ns, methods] of Object.entries(manifest.bridge.namespaces)) {
    for (const m of methods) {
      count++;
      const fn = facade[ns][m];
      assert.equal(typeof fn, "function", `${ns}.${m} not a function`);
      if (/^on[A-Z]/.test(m)) continue; // subscriptions tested separately
      await fn({ path: "/x" });
      const req = calls[calls.length - 1];
      assert.deepEqual(req, { kind: "bridge", id: `${ns}.${m}`, params: { path: "/x" } });
    }
  }
  assert.equal(count, 572);
});

test("callable methods default params to {} (argument-optional calls)", async () => {
  const { facade, calls } = build();
  await facade.settings.get(); // no args at all — real UI does this
  assert.deepEqual(calls[calls.length - 1], {
    kind: "bridge",
    id: "settings.get",
    params: {},
  });
});

test("on* methods subscribe and return an unsubscribe function", async () => {
  const { facade, subs } = build();
  const cb = () => {};
  const unsub = facade.artifacts.onChanged(cb);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, "artifacts.onChanged");
  assert.equal(subs[0].cb, cb);
  assert.equal(typeof unsub, "function");
  unsub();
  assert.equal(subs.length, 0);
});

test("68 subscription methods and 504 callable methods partition the surface", () => {
  let on = 0,
    call = 0;
  for (const methods of Object.values(manifest.bridge.namespaces)) {
    for (const m of methods) isEventMethod(m) ? on++ : call++;
  }
  assert.equal(on, 68);
  assert.equal(call, 504);
  assert.ok(isEventMethod("onData"));
  assert.ok(!isEventMethod("openFileNode"));
  assert.ok(!isEventMethod("list"));
});

test("legacy autumn members and __bridge inspector are attached without collisions", () => {
  const { facade } = build();
  assert.equal(typeof facade.openFileDialog, "function");
  assert.equal(typeof facade.onTerminalData, "function");
  assert.equal(facade.__bridge(), "inspector");
});

test("private ops expose as __ops.<name> and dispatch to __ops.<name> ids", async () => {
  const { facade, calls } = build({ privateOps: ["__ops.commander", "__ops.agentRun"] });
  assert.equal(typeof facade.__ops.commander, "function");
  assert.equal(typeof facade.__ops.agentRun, "function");
  await facade.__ops.commander({ command: "connect a to b", canvas: {} });
  assert.deepEqual(calls[calls.length - 1], {
    kind: "bridge",
    id: "__ops.commander",
    params: { command: "connect a to b", canvas: {} },
  });
  await facade.__ops.agentRun(); // params default to {}
  assert.deepEqual(calls[calls.length - 1], { kind: "bridge", id: "__ops.agentRun", params: {} });
});

test("no privateOps -> no __ops namespace on the facade", () => {
  const { facade } = build();
  assert.equal("__ops" in facade, false);
});

test("legacy member colliding with a target namespace throws", () => {
  assert.throws(
    () => buildFacade({ manifest, invoke: () => {}, subscribe: () => () => {}, legacy: { files: () => 1 } }),
    /collides with target namespace/
  );
});

test("two builds are structurally identical (october alias can share the shape)", () => {
  const a = build().facade;
  const b = build().facade;
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const ns of Object.keys(manifest.bridge.namespaces)) {
    assert.deepEqual(Object.keys(a[ns]), Object.keys(b[ns]));
  }
});
