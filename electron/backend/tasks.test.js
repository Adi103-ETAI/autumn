"use strict";
// layer-1 tests for the tasks bridge ids (doc 29 §T, doc 31 §5). Fake deps only.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeTasksHandlers } = require("./tasks.ts");

const EXPECTED_IDS = [
  "tasks.acknowledgeChatQueue", "tasks.cancel", "tasks.canvasEdit", "tasks.chatQueue",
  "tasks.closeChatSession", "tasks.decompose", "tasks.editChatQueueEntry", "tasks.forkChat",
  "tasks.previewGuiFunding", "tasks.removeChatQueueEntry", "tasks.resumeChatQueue",
  "tasks.steer", "tasks.undo",
];

function build(overrides = {}) {
  const state = {
    emitted: [],
    tasks: [
      { id: "t1", canvasId: "c", seq: 1, description: "task one", status: "open", assigneeId: null, afterIds: "[]", note: null, createdAt: new Date(100), updatedAt: new Date(100) },
    ],
    created: [],
    updated: [],
    spawnerCalled: [],
  };
  const spawner = {
    runAgent: async (opts) => {
      state.spawnerCalled.push(opts);
      return { text: "done", simulated: true, fellBack: false };
    },
    resolveAgentCommand: async () => ({ command: "/bin/x", args: [], env: {} }),
    HARNESS_BIN: { claude: "claude" },
    ...(overrides.spawner || {}),
  };
  const db = {
    task: {
      findMany: async ({ where }) => state.tasks.filter((t) =>
        (!where?.canvasId || t.canvasId === where.canvasId) &&
        (!where?.description || t.description === where.description)),
      findUnique: async () => null,
      create: async ({ data }) => { const t = { id: `t${state.tasks.length + 1}`, ...data, createdAt: new Date(400), updatedAt: new Date(400) }; state.tasks.push(t); state.created.push(t); return t; },
      update: async ({ where: { id }, data }) => { state.updated.push([id, data]); Object.assign(state.tasks.find((t) => t.id === id) ?? {}, data); return state.tasks.find((t) => t.id === id); },
      count: async () => state.tasks.length,
    },
    message: { findMany: async () => [], create: async ({ data }) => ({ id: "m", ...data, createdAt: new Date(1) }) },
    agentLog: { findMany: async () => [] },
    canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
    busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
    edge: { upsert: async () => ({}) },
    node: {}, session: {}, artifact: {}, artifactVersion: {},
    ...(overrides.db || {}),
  };
  const deps = {
    spawner,
    db,
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeTasksHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 13 dispatchable tasks ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 13);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("tasks.steer creates a task row, runs the agent, and emits events.onTask", async () => {
  const { call, state } = build();
  const res = await call("tasks.steer", { canvasId: "c", task: "refactor auth.ts" });
  assert.equal(res.text, "done");
  assert.equal(state.spawnerCalled.length, 1);
  assert.equal(state.created.length, 1);
  const taskEvent = state.emitted.find(([id]) => id === "events.onTask");
  assert.equal(taskEvent[1].action, "steered");
});

test("tasks.cancel marks the task cancelled and emits events.onTask", async () => {
  const { call, state } = build();
  const res = await call("tasks.cancel", { canvasId: "c", taskId: "task one" });
  assert.equal(res.status, "cancelled");
  const updated = state.updated.find(([id, data]) => id === "t1" && data.status === "cancelled");
  assert.ok(updated);
  const taskEvent = state.emitted.find(([id]) => id === "events.onTask");
  assert.equal(taskEvent[1].action, "cancelled");
});

test("tasks.undo emits events.onTask for a known task; ghost task -> not-found", async () => {
  const { call } = build();
  const res = await call("tasks.undo", { canvasId: "c", taskId: "task one" });
  assert.equal(res.undone, true);
  const ghost = await call("tasks.undo", { canvasId: "c", taskId: "ghost" });
  assert.equal(ghost.error.code, "not-found");
});

test("honest-minimal surface: forkChat not-implemented; decompose empty; funding supported:false", async () => {
  const { call } = build();
  assert.equal((await call("tasks.forkChat", { canvasId: "c", sessionId: "s1" })).error.code, "not-implemented");
  const decomposed = await call("tasks.decompose", { canvasId: "c", task: "x" });
  assert.deepEqual(decomposed.steps, []);
  assert.deepEqual(await call("tasks.previewGuiFunding", {}), { supported: false, reason: "no GUI funding integration in autumn" });
  assert.deepEqual(await call("tasks.chatQueue", {}), { queue: [] });
});

test("queue ids are documented no-ops that still succeed", async () => {
  const { call } = build();
  assert.deepEqual(await call("tasks.acknowledgeChatQueue", { queueId: "q1" }), { ok: true, queueId: "q1", acknowledged: true });
  assert.deepEqual(await call("tasks.editChatQueueEntry", { queueId: "q1", entry: "e" }), { ok: true, queueId: "q1" });
  assert.deepEqual(await call("tasks.removeChatQueueEntry", { queueId: "q1" }), { ok: true, queueId: "q1", removed: true });
  assert.deepEqual(await call("tasks.resumeChatQueue", { canvasId: "c" }), { ok: true, resumed: true });
  assert.deepEqual(await call("tasks.closeChatSession", { canvasId: "c" }), { ok: true, closed: true });
  assert.deepEqual(await call("tasks.canvasEdit", { canvasId: "c", edit: "add node" }), { ok: true, applied: false, reason: "no canvas-edit pipeline in autumn" });
});

test("bad-params across handlers for missing canvasId/taskId", async () => {
  const { call } = build();
  assert.equal((await call("tasks.steer", { canvasId: "c" })).error.code, "bad-params");
  assert.equal((await call("tasks.cancel", { canvasId: "c" })).error.code, "bad-params");
  assert.equal((await call("tasks.steer", { task: "x" })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makeTasksHandlers({
    spawner: { runAgent: async () => ({ text: "" }), resolveAgentCommand: async () => null, HARNESS_BIN: {} },
    db: {
      task: { findMany: async () => [], findUnique: async () => null, create: async (x) => ({ id: "t", ...x.data }), update: async (x) => x.data, count: async () => 0 },
      message: { findMany: async () => [], create: async (x) => x.data },
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      node: {}, session: {}, artifact: {}, artifactVersion: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "tasks.chatQueue", params: {} });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { queue: [] });

  const bad = await reg.dispatch({ id: "tasks.steer", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
