"use strict";
// layer-1 tests for the cues bridge ids (docs/architecture/backend.md W2-2). Real temp userData store,
// FAKE spawn dep (no real processes).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");
const { makeCuesHandlers } = require("./cues.ts");

const EXPECTED_IDS = [
  "cues.save", "cues.list", "cues.read", "cues.remove",
  "cues.prepareCommand", "cues.cancelCommand", "cues.invoke", "cues.cancelInvoke",
];

function build(overrides = {}) {
  const state = {
    spawns: [],
    emits: [],
    exitCbs: new Map(),
    killed: [],
  };
  const deps = {
    emit: (id, payload) => state.emits.push([id, payload]),
    now: () => Date.now(),
    spawn: {
      spawn: (command, args, opts) => {
        const proc = {
          killed: false,
          on: (event, cb) => {
            if (event === "exit") state.exitCbs.set(proc, cb);
          },
          kill: () => { proc.killed = true; state.killed.push(command); },
        };
        state.spawns.push({ command, args, opts, proc });
        return proc;
      },
      ...(overrides.spawn || {}),
    },
    ...overrides,
  };
  const handlers = makeCuesHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: the 8 renderer-used cues ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 8);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id));
});

test("save -> list -> read -> remove CRUD round-trips", async () => {
  useTempUserData();
  const { call } = build();
  const saved = await call("cues.save", { name: "run dev", command: "npm", args: ["run", "dev"] });
  assert.ok(saved.id);
  assert.equal(saved.name, "run dev");
  assert.equal(saved.command, "npm");

  const list = await call("cues.list", {});
  assert.deepEqual(list.cues.map((c) => c.name), ["run dev"]);

  const read = await call("cues.read", { id: saved.id });
  assert.equal(read.name, "run dev");

  assert.deepEqual(await call("cues.remove", { id: saved.id }), { ok: true });
  assert.deepEqual(await call("cues.list", {}), { cues: [] });
  assert.equal((await call("cues.read", { id: saved.id })).error.code, "not-found");
});

test("save with id UPDATES the existing cue (no duplicate)", async () => {
  useTempUserData();
  const { call } = build();
  const first = await call("cues.save", { id: "cue-1", name: "a", command: "ls" });
  const second = await call("cues.save", { id: "cue-1", name: "b", command: "pwd" });
  assert.equal(second.id, first.id);
  const list = await call("cues.list", {});
  assert.equal(list.cues.length, 1);
  assert.equal(list.cues[0].name, "b");
});

test("save rejects bad input with bad-params", async () => {
  useTempUserData();
  const { call } = build();
  assert.equal((await call("cues.save", { command: "ls" })).error.code, "bad-params");
  assert.equal((await call("cues.save", { name: "x" })).error.code, "bad-params");
  assert.equal((await call("cues.save", { name: "x", command: "ls", args: "nope" })).error.code, "bad-params");
  assert.equal((await call("cues.save", { name: "x", command: "ls", id: "bad id" })).error.code, "bad-params");
});

test("prepareCommand validates the cue for invocation", async () => {
  useTempUserData();
  const { call } = build();
  const saved = await call("cues.save", { name: "web-dev", command: "npm", args: ["run", "dev"] });
  const prepared = await call("cues.prepareCommand", { id: saved.id });
  assert.equal(prepared.valid, true);
  assert.deepEqual(prepared.args, ["run", "dev"]);
  assert.equal((await call("cues.prepareCommand", { id: "ghost" })).error.code, "not-found");
});

test("invoke runs the command via deps.spawn; double-invoke is handler-error; cancelInvoke kills it", async () => {
  useTempUserData();
  const { call, state } = build();
  const saved = await call("cues.save", { name: "serve", command: "node", args: ["server.js"] });

  const started = await call("cues.invoke", { id: saved.id });
  assert.deepEqual(started, { id: saved.id, running: true });
  assert.equal(state.spawns.length, 1);
  assert.equal(state.spawns[0].command, "node");
  assert.deepEqual(state.spawns[0].args, ["server.js"]);

  const double = await call("cues.invoke", { id: saved.id });
  assert.equal(double.ok, false);
  assert.equal(double.error.code, "handler-error");

  assert.deepEqual(await call("cues.cancelInvoke", { id: saved.id }), { ok: true });
  assert.deepEqual(state.killed, ["node"]);
  assert.equal((await call("cues.cancelInvoke", { id: saved.id })).error.code, "not-found");
});

test("cues.invoke on ghost id -> not-found; cancelInvoke on ghost -> not-found", async () => {
  useTempUserData();
  const { call } = build();
  assert.equal((await call("cues.invoke", { id: "ghost" })).error.code, "not-found");
  assert.equal((await call("cues.cancelInvoke", { id: "ghost" })).error.code, "not-found");
});

test("cues.cancelCommand is a documented no-op success", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("cues.cancelCommand", { id: "anything" });
  assert.equal(res.ok, true);
});

test("exit listener auto-drops the live record on real child exit", async () => {
  useTempUserData();
  const { call, state } = build();
  const saved = await call("cues.save", { name: "brief", command: "echo", args: ["hi"] });
  await call("cues.invoke", { id: saved.id });
  for (const cb of state.exitCbs.values()) cb(0); // simulate child exit
  const again = await call("cues.invoke", { id: saved.id });
  assert.equal(again.running, true);
});

test("registry dispatch round-trip wraps payloads", async () => {
  useTempUserData();
  reg.reset();
  const handlers = makeCuesHandlers({
    emit: () => {},
    now: () => Date.now(),
    spawn: { spawn: () => ({ on: () => {}, kill: () => {} }) },
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "cues.list", params: {} });
  assert.equal(ok.ok, true);
  const bad = await reg.dispatch({ id: "cues.save", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
