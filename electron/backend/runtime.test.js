"use strict";
// layer-1 tests for the runtime bridge ids (docs/architecture/backend.md W2-2).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeRuntimeHandlers } = require("./runtime.ts");

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeRuntimeHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

const EXPECTED_IDS = ["runtime.ensureNode", "runtime.installCloudRuntime", "runtime.removeCloudRuntime"];

beforeEach(() => reg.reset());

test("id surface: the 3 renderer-used runtime ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 3);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("runtime.ensureNode returns the REAL node version", async () => {
  const { call } = build();
  const res = await call("runtime.ensureNode", {});
  assert.equal(res.node, process.version);
  assert.equal(typeof res.platform, "string");
  assert.equal(res.arch, process.arch);
});

test("runtime.installCloudRuntime / removeCloudRuntime are honest not-implemented envelopes", async () => {
  const { call } = build();
  for (const id of ["runtime.installCloudRuntime", "runtime.removeCloudRuntime"]) {
    const res = await call(id, {});
    assert.equal(res.ok, false, id);
    assert.equal(res.error.code, "not-implemented", id);
    assert.match(res.error.message, /runtime/i);
  }
});

test("registry dispatch round-trip wraps payloads", async () => {
  reg.reset();
  const handlers = makeRuntimeHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "runtime.ensureNode", params: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.node, process.version);
  const ni = await reg.dispatch({ id: "runtime.installCloudRuntime", params: {} });
  assert.equal(ni.ok, false);
  assert.equal(ni.error.code, "not-implemented");
});
