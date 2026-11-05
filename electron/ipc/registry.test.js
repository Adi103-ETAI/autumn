"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const reg = require("./registry");
const { ERR } = require("./envelope");

beforeEach(() => reg.reset());

test("protocol version comes from the target manifest (October Desktop v1.0.56, RE'd)", () => {
  assert.equal(reg.API_VERSION, 2);
  assert.equal(reg.SCHEMA, 8);
  assert.equal(reg.manifest.project, "autumn");
});

test("register + dispatch roundtrip (sync handler)", async () => {
  reg.register("bridge", "settings.get", (params) => ({ key: params.key, value: "v" }));
  const e = await reg.dispatch({ kind: "bridge", id: "settings.get", principal: "desktop", params: { key: "theme" } });
  assert.equal(e.ok, true);
  assert.deepEqual(e.result, { key: "theme", value: "v" });
});

test("async handlers are awaited", async () => {
  reg.register("core", "bus.wait", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { waited: true };
  });
  const e = await reg.dispatch({ kind: "core", id: "bus.wait" });
  assert.equal(e.ok, true);
  assert.deepEqual(e.result, { waited: true });
});

test("unregistered method -> not-found", async () => {
  const e = await reg.dispatch({ kind: "bridge", id: "nope.missing" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, ERR.NOT_FOUND);
});

test("forbidden principal -> forbidden", async () => {
  reg.register("core", "remote.enable", () => ({ on: true }));
  const e = await reg.dispatch({ kind: "core", id: "remote.enable", principal: "remote" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, ERR.FORBIDDEN);
});

test("handler-thrown error -> handler-error envelope (never throws)", async () => {
  reg.register("bridge", "files.read", () => { throw new Error("boom"); });
  const e = await reg.dispatch({ kind: "bridge", id: "files.read" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, ERR.HANDLER_ERROR);
  assert.match(e.error.message, /boom/);
});

test("rejected promise -> handler-error envelope", async () => {
  reg.register("bridge", "git.status", () => Promise.reject(new Error("no repo")));
  const e = await reg.dispatch({ kind: "bridge", id: "git.status" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, ERR.HANDLER_ERROR);
});

test("schema validator can reject params -> bad-params", async () => {
  reg.register("bridge", "files.write", () => ({ wrote: true }), {
    schema: (p) => (typeof p.path === "string" ? { ok: true } : { ok: false, message: "path required" }),
  });
  const bad = await reg.dispatch({ kind: "bridge", id: "files.write", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, ERR.BAD_PARAMS);
  const good = await reg.dispatch({ kind: "bridge", id: "files.write", params: { path: "/a" } });
  assert.equal(good.ok, true);
});

test("handler returning a deliberate envelope is passed through (not-implemented)", async () => {
  const { err } = require("./envelope");
  reg.register("bridge", "voice.speak", () => err(ERR.NOT_IMPLEMENTED, "voice not built yet"));
  const e = await reg.dispatch({ kind: "bridge", id: "voice.speak" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, ERR.NOT_IMPLEMENTED);
});

test("duplicate registration throws; validation of kind/id/handler", () => {
  reg.register("bridge", "settings.get", () => 1);
  assert.throws(() => reg.register("bridge", "settings.get", () => 2), /duplicate/);
  assert.throws(() => reg.register("weird", "settings.get", () => 1), /kind/);
  assert.throws(() => reg.register("bridge", "nodot", () => 1), /dotted/);
  assert.throws(() => reg.register("bridge", "settings.get", "not-a-fn"), /function/);
});

test("bridge and core kinds are distinct keys for the same id", async () => {
  reg.register("bridge", "fs.read", () => "from-bridge");
  const missingCore = await reg.dispatch({ kind: "core", id: "fs.read" });
  assert.equal(missingCore.error.code, ERR.NOT_FOUND);
  reg.register("core", "fs.read", () => "from-core");
  const core = await reg.dispatch({ kind: "core", id: "fs.read" });
  assert.equal(core.result, "from-core");
});

test("implemented() introspects registered handlers (Bridge Inspector source)", () => {
  reg.register("bridge", "settings.get", () => 1, { description: "read setting" });
  const list = reg.implemented();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { kind: "bridge", id: "settings.get", description: "read setting" });
});

test("inManifest() checks the target surface (no invented methods)", () => {
  assert.equal(reg.inManifest("core", "bus.query"), true);
  assert.equal(reg.inManifest("bridge", "files.read"), true);
  assert.equal(reg.inManifest("bridge", "nope.nope"), false);
  assert.equal(reg.inManifest("core", "made.up"), false);
});
