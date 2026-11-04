"use strict";
// layer-1 tests for the terminal bridge ids (doc 29 §T, doc 31 §5). Fake deps only.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeTerminalHandlers } = require("./terminal.ts");

const EXPECTED_IDS = [
  "terminal.dismissForkInstruction", "terminal.foreground", "terminal.foregroundCached",
  "terminal.interrupt", "terminal.launchAgentOnBus", "terminal.openFork",
  "terminal.openShell", "terminal.peekSession", "terminal.pendingForks",
  "terminal.rawSnapshot", "terminal.reclaimHost", "terminal.reconcileSidecar",
  "terminal.recoverCodexDaemon", "terminal.replace", "terminal.restart",
  "terminal.resumeHistory", "terminal.scanExternalSessions", "terminal.seedResume",
  "terminal.sessionExists", "terminal.sessionHistory", "terminal.sessionModel",
  "terminal.snapshot", "terminal.whichAgents",
];

function build(overrides = {}) {
  const state = {
    emitted: [], spawned: [], writes: [], kills: [], subs: [], ptyExists: new Set(["node-abc123"]),
    messageRows: [
      { id: "m1", role: "user", text: "hello", createdAt: new Date(100) },
      { id: "m2", role: "assistant", text: "hi back", createdAt: new Date(200) },
    ],
    messageCreate: [],
    spawnerCalled: [],
  };
  const deps = {
    pty: {
      createPty: (opts) => { state.spawned.push(opts); state.ptyExists.add(opts.nodeId); return true; },
      killPty: (nodeId) => { state.kills.push(nodeId); state.ptyExists.delete(nodeId); },
      writePty: (nodeId, data) => { state.writes.push([nodeId, data]); return true; },
      resizePty: () => {},
      ptyExists: (nodeId) => state.ptyExists.has(nodeId),
      ptyKind: () => "shell",
      ptyCount: () => state.ptyExists.size,
      subscribePty: (nodeId, cb) => { state.subs.push({ nodeId, cb }); return () => {}; },
      onPtyExit: (cb) => { state.onPtyExit = cb; return () => {}; },
      ...(overrides.pty || {}),
    },
    spawner: {
      runAgent: async () => ({ text: "AGENT", simulated: true }),
      resolveAgentCommand: async (h) => (h === "missing-harness" ? null : { command: "/bin/x", args: ["--a"], env: {} }),
      HARNESS_BIN: { claude: "claude", codex: "codex" },
      ...(overrides.spawner || {}),
    },
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      message: {
        findMany: async ({ where, orderBy, take }) => {
          const rows = [...state.messageRows];
          const sorted = rows.sort((a, b) => (orderBy?.createdAt === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
          return sorted.slice(0, take ?? rows.length);
        },
        create: async ({ data }) => { state.messageCreate.push(data); return { id: "m3", ...data, createdAt: new Date(400) }; },
      },
      session: { findMany: async () => [], findUnique: async () => null, create: async ({ data }) => data, count: async () => 0 },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      task: {}, node: {}, artifact: {}, artifactVersion: {},
      ...(overrides.db || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeTerminalHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 23 new terminal ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 23);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("sessionExists / snapshot / rawSnapshot / peekSession reflect the fake PTY", async () => {
  const { call } = build();
  assert.deepEqual(await call("terminal.sessionExists", { node: "node-abc123" }), { node: "node-abc123", exists: true });
  assert.equal((await call("terminal.snapshot", { node: "node-abc123" })).exists, true);
  assert.equal((await call("terminal.rawSnapshot", { node: "node-abc123" })).snapshot, null);
  const peek = await call("terminal.peekSession", { node: "node-abc123" });
  assert.equal(peek.kind, "shell");
});

test("interrupt writes \\x03; not-found for ghost node", async () => {
  const { call, state } = build();
  const ok = await call("terminal.interrupt", { node: "node-abc123" });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(state.writes, [["node-abc123", "\x03"]]);

  const ghost = await call("terminal.interrupt", { node: "node-ghost" });
  assert.equal(ghost.error.code, "not-found");
});

test("openShell spawns a PTY and emits terminal.onLifecycle", async () => {
  const { call, state } = build();
  const res = await call("terminal.openShell", { node: "node-newshell", dir: "/tmp" });
  assert.deepEqual(res, { node: "node-newshell", ok: true });
  assert.deepEqual(state.spawned, [{ nodeId: "node-newshell", dir: "/tmp" }]);
  const lifecycle = state.emitted.find(([id]) => id === "terminal.onLifecycle");
  assert.equal(lifecycle[1].status, "started");
});

test("restart kills and re-creates, emitting terminal.onLifecycle", async () => {
  const { call, state } = build();
  const res = await call("terminal.restart", { node: "node-abc123" });
  assert.equal(res.ok, true);
  assert.deepEqual(state.kills, ["node-abc123"]);
  assert.equal(state.spawned.length, 1);
  const lifecycle = state.emitted.find(([id]) => id === "terminal.onLifecycle");
  assert.equal(lifecycle[1].status, "restarted");
});

test("whichAgents lists the real HARNESS_BIN keys", async () => {
  const { call } = build();
  const res = await call("terminal.whichAgents", {});
  assert.deepEqual(res.agents, [
    { harness: "claude", installed: true, binary: "claude" },
    { harness: "codex", installed: true, binary: "codex" },
  ]);
});

test("sessionHistory (desc) and resumeHistory (asc) read db.message rows; honest shapes", async () => {
  const { call } = build();
  const hist = await call("terminal.sessionHistory", { node: "node-abc123" });
  assert.equal(hist.history.length, 2);
  assert.equal(hist.history[0].text, "hi back"); // desc order

  const resume = await call("terminal.resumeHistory", { node: "node-abc123" });
  assert.equal(resume.history.length, 2);
  assert.equal(resume.history[0].text, "hello"); // asc order
});

test("onPtyExit pushes terminal.onExit with real exit info", async () => {
  const { call, state } = build();
  state.onPtyExit("node-abc123", { exitCode: 1, signal: undefined, kind: "shell" });
  const exit = state.emitted.find(([id]) => id === "terminal.onExit");
  assert.equal(exit[1].node, "node-abc123");
  assert.equal(exit[1].exitCode, 1);
});

test("honest-minimal surface: not-implemented / supported:false / empty shapes", async () => {
  const { call } = build();
  assert.equal((await call("terminal.reclaimHost", { node: "node-abc123" })).error.code, "not-implemented");
  assert.equal((await call("terminal.reconcileSidecar", { node: "node-abc123" })).error.code, "not-implemented");
  assert.equal((await call("terminal.recoverCodexDaemon", { node: "node-abc123" })).error.code, "not-implemented");
  assert.deepEqual(await call("terminal.scanExternalSessions", {}), { supported: false, sessions: [], reason: "no external-session scanner in autumn" });
  assert.deepEqual(await call("terminal.pendingForks", {}), { forks: [] });
});

test("seedResume writes a db.message row", async () => {
  const { call, state } = build();
  const res = await call("terminal.seedResume", { node: "node-abc123", message: "resume me" });
  assert.deepEqual(res, { ok: true, node: "node-abc123" });
  assert.equal(state.messageCreate.length, 1);
  assert.equal(state.messageCreate[0].role, "system");
});

test("bad node id -> bad-params across handlers", async () => {
  const { call } = build();
  for (const id of ["terminal.sessionExists", "terminal.snapshot", "terminal.interrupt", "terminal.restart", "terminal.replace", "terminal.openShell"]) {
    assert.equal((await call(id, { node: "bad id!" })).error.code, "bad-params", id);
  }
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makeTerminalHandlers({
    pty: {
      createPty: () => true, killPty: () => {}, writePty: () => true, resizePty: () => {},
      ptyExists: () => false, ptyKind: () => undefined, ptyCount: () => 0,
      subscribePty: () => () => {}, onPtyExit: () => () => {},
    },
    spawner: { runAgent: async () => ({ text: "" }), resolveAgentCommand: async () => null, HARNESS_BIN: {} },
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      message: { findMany: async () => [], create: async ({ data }) => data },
      session: { findMany: async () => [], findUnique: async () => null, create: async (x) => x.data, count: async () => 0 },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      task: {}, node: {}, artifact: {}, artifactVersion: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "terminal.sessionExists", params: { node: "node-abc123" } });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.exists, false);

  const bad = await reg.dispatch({ id: "terminal.sessionExists", params: { node: "!!" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const ni = await reg.dispatch({ id: "terminal.reclaimHost", params: { node: "node-abc123" } });
  assert.equal(ni.ok, false);
  assert.equal(ni.error.code, "not-implemented");
});
