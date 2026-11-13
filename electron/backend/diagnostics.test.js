"use strict";
// layer-1 tests for the diagnostics bridge ids (docs/architecture/backend.md W2-1). Real temp userData dir.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");
const { makeDiagnosticsHandlers, buildDiagnosticsReport, localCode } = require("./diagnostics.ts");

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeDiagnosticsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

const EXPECTED_IDS = ["diagnostics.report", "diagnostics.save"];

beforeEach(() => reg.reset());

test("id surface: both renderer-used diagnostics ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id));
});

test("diagnostics.report returns a local code and writes the bundle to userData/logs", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const res = await call("diagnostics.report", { note: "save button broken on Linux" });
  assert.match(res.code, /^autumn-[0-9a-f]{12}$/);
  const logs = fs.readdirSync(path.join(dir, "logs"));
  assert.equal(logs.length, 1);
  const bundle = JSON.parse(fs.readFileSync(path.join(dir, "logs", logs[0]), "utf8"));
  assert.equal(bundle.app.name, "autumn");
  assert.equal(bundle.host.platform, process.platform);
  assert.equal(bundle.note, "save button broken on Linux");
  assert.ok(bundle.git && typeof bundle.git === "object");
});

test("diagnostics.report twice with same note produces the same code (deterministic)", async () => {
  useTempUserData();
  const { call } = build();
  const a = await call("diagnostics.report", { note: "x" });
  const b = await call("diagnostics.report", { note: "x" });
  assert.equal(a.code, b.code);
});

test("diagnostics.save persists the default bundle and reports path + bytes", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const res = await call("diagnostics.save", {});
  assert.equal(res.saved, true);
  assert.ok(res.path.endsWith(".json"));
  assert.ok(res.bytes > 100);
  const parsed = JSON.parse(fs.readFileSync(res.path, "utf8"));
  assert.equal(parsed.app.name, "autumn");
});

test("diagnostics.save with explicit payload writes exactly that payload", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("diagnostics.save", { payload: { custom: 42, nested: { ok: true } } });
  const parsed = JSON.parse(fs.readFileSync(res.path, "utf8"));
  assert.deepEqual(parsed, { custom: 42, nested: { ok: true } });
});

test("bad params -> bad-params envelope", async () => {
  useTempUserData();
  const { call } = build();
  assert.equal((await call("diagnostics.report", { note: 42 })).error.code, "bad-params");
  assert.equal((await call("diagnostics.save", { payload: [1, 2] })).error.code, "bad-params");
  assert.equal((await call("diagnostics.save", { payload: null })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads", async () => {
  useTempUserData();
  reg.reset();
  const handlers = makeDiagnosticsHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "diagnostics.report", params: {} });
  assert.equal(ok.ok, true);
  assert.match(String(ok.result.code), /^autumn-/);
  const bad = await reg.dispatch({ id: "diagnostics.report", params: { note: 7 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
