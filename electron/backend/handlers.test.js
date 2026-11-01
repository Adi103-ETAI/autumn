"use strict";
// Layer-1 handler units (doc 29 §T): every ported route handler runs headless
// against FAKE dependencies — no Electron, no Prisma, no PTY processes.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register"); // transpile src/lib/*.ts on require (commander-prompt)
const { makeHandlers } = require("./handlers.ts");

/** Build the handler table over fake deps; `state` captures interactions. */
function build(overrides = {}) {
  const state = { emitted: [], ptyWrites: [], ptyResizes: [], ptyKilled: [], subs: [], dbCalls: [] };
  const deps = {
    busStore: {
      ensurePeer: async (canvasId, nodeId, name, status) => ({ id: nodeId, name, status }),
      setPeerStatus: async () => {},
      sendMessage: async (c, from, to) => ({ delivered: true, id: "m1", ts: 111, from, to }),
      drainInbox: async () => ({ injection: "INJ", drained: 3 }),
      listPeers: async () => [{ id: "p1" }, { id: "p2" }],
      getPeer: async (c, node) => (node === "ghost" ? null : { id: node, status: "live" }),
      ...overrides.busStore,
    },
    pty: {
      createPty: () => true,
      subscribePty: (nodeId, cb) => {
        state.subs.push({ nodeId, cb });
        return () => state.subs.splice(state.subs.findIndex((s) => s.nodeId === nodeId), 1);
      },
      writePty: (nodeId, data) => {
        state.ptyWrites.push([nodeId, data]);
        return true;
      },
      resizePty: (nodeId, cols, rows) => state.ptyResizes.push([nodeId, cols, rows]),
      killPty: (nodeId) => state.ptyKilled.push(nodeId),
      ptyCount: () => 0,
      ...overrides.pty,
    },
    spawner: {
      runAgent: async () => ({ text: "AGENT TEXT", simulated: true }),
      resolveAgentCommand: async (harness) =>
        harness === "opencode" ? null : { command: "/bin/x", args: ["--a"], env: {} },
      HARNESS_BIN: { claude: "claude", codex: "codex", opencode: "opencode" },
      ...overrides.spawner,
    },
    db: {
      agentLog: {
        findMany: async (args) => {
          state.dbCalls.push(["agentLog.findMany", args]);
          return [
            { id: "l1", createdAt: new Date(1000), kind: "task_add", text: "hi", nodeId: "n1", payload: '{"a":1}' },
            { id: "l2", createdAt: new Date(2000), kind: "search", text: "", nodeId: null, payload: "not-json" },
          ];
        },
        createMany: async (args) => state.dbCalls.push(["agentLog.createMany", args]),
        deleteMany: async (args) => state.dbCalls.push(["agentLog.deleteMany", args]),
      },
      canvas: {
        findUnique: async (args) => {
          state.dbCalls.push(["canvas.findUnique", args]);
          return args.where.id === "missing" ? null : { id: args.where.id, name: "N", state: "{}", updatedAt: new Date(5) };
        },
        findMany: async () => [{ id: "c1", name: "One", updatedAt: new Date(1), createdAt: new Date(0) }],
        create: async ({ data }) => ({ id: data.id, name: data.name, updatedAt: new Date(6) }),
        update: async ({ where, data }) => ({ id: where.id, name: data.name, updatedAt: new Date(7) }),
        upsert: async (args) => state.dbCalls.push(["canvas.upsert", args]),
        delete: async ({ where }) => {
          if (where.id === "missing") throw new Error("nope");
          return { ok: true };
        },
        ...overrides.canvas,
      },
      ...overrides.db,
    },
    personas: {
      PERSONA_BY_ID: { explorer: { name: "Explorer" } },
      ...overrides.personas,
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    ...overrides._deps,
  };

  const handlers = makeHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => {});

// ---------------- terminal ----------------

test("terminal.start: valid node creates pty and subscribes -> onData events", async () => {
  const { call, state } = build();
  const res = await call("terminal.start", { node: "node-abc123", dir: "/tmp" });
  assert.equal(res.node, "node-abc123");
  assert.equal(res.harnessWarning, null);
  assert.equal(state.subs.length, 1);
  // stream chunk -> emitted event
  state.subs[0].cb("hello $ ");
  assert.deepEqual(state.emitted, [["terminal.onData", { node: "node-abc123", data: "hello $ " }]]);
});

test("terminal.start: invalid node id -> bad-params envelope", async () => {
  const { call } = build();
  const res = await call("terminal.start", { node: "bad id!" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-params");
});

test("terminal.start: unknown harness name -> bad-params (no silent fallback)", async () => {
  const { call } = build();
  const res = await call("terminal.start", { node: "node-abc123", harness: "warp" });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /unknown harness: warp/);
});

test("terminal.start: known-but-missing harness -> plain shell + warning path", async () => {
  const { call, state } = build();
  const res = await call("terminal.start", { node: "node-abc123", harness: "opencode" });
  assert.match(String(res.harnessWarning), /harness not installed: opencode/);
  assert.equal(state.subs.length, 1);
});

test("terminal.start: pty spawn failure -> handler-error envelope", async () => {
  const { call } = build({ pty: { createPty: () => false } });
  const res = await call("terminal.start", { node: "node-abc123" });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /failed to spawn pty/);
});

test("terminal.start twice for same node replaces the subscription", async () => {
  const { call, state } = build();
  await call("terminal.start", { node: "node-abc123" });
  await call("terminal.start", { node: "node-abc123" });
  assert.equal(state.subs.length, 1);
});

test("terminal.input/resize/kill: route behavior (clamping, cleanup)", async () => {
  const { call, state } = build();
  await call("terminal.start", { node: "node-abc123" });

  assert.deepEqual(await call("terminal.input", { node: "node-abc123", data: "ls\r" }), { ok: true });
  assert.deepEqual(state.ptyWrites, [["node-abc123", "ls\r"]]);

  await call("terminal.resize", { node: "node-abc123", cols: 9999, rows: 1 });
  assert.deepEqual(state.ptyResizes, [["node-abc123", 300, 10]]); // clamped like the route

  await call("terminal.kill", { node: "node-abc123" });
  assert.deepEqual(state.ptyKilled, ["node-abc123"]);
  assert.equal(state.subs.length, 0);
});

// ---------------- canvas ----------------

test("canvas.load: with id -> single canvas; missing -> not-found envelope", async () => {
  const { call } = build();
  const one = await call("canvas.load", { id: "c1" });
  assert.equal(one.id, "c1");
  assert.equal(one.state, "{}");
  const miss = await call("canvas.load", { id: "missing" });
  assert.equal(miss.ok, false);
  assert.equal(miss.error.code, "not-found");
});

test("canvas.load: no id -> list", async () => {
  const { call } = build();
  const list = await call("canvas.load", {});
  assert.deepEqual(list.canvases.map((c) => c.id), ["c1"]);
});

test("canvas.save: upsert semantics (create when absent, update when present)", async () => {
  const { call } = build();
  const saved = await call("canvas.save", { id: "new-one", name: "X", state: "{\"a\":1}" });
  assert.equal(saved.id, "new-one");
  assert.equal(saved.name, "X");
  const updated = await call("canvas.save", { id: "c1", name: "Y" });
  assert.equal(updated.name, "Y");
});

test("__ops.canvasDelete: id required; missing row -> not-found", async () => {
  const { call } = build();
  assert.equal((await call("__ops.canvasDelete", {})).error.code, "bad-params");
  assert.equal((await call("__ops.canvasDelete", { id: "missing" })).error.code, "not-found");
  assert.deepEqual(await call("__ops.canvasDelete", { id: "c1" }), { ok: true });
});

// ---------------- bus (core query/mutate) ----------------

test("bus.query: pre-prompt default drains inbox", async () => {
  const { call } = build();
  assert.deepEqual(await call("bus.query", { canvas: "c", node: "n" }), { injection: "INJ", drained: 3 });
});

test("bus.query: list_peers and get_node_status", async () => {
  const { call } = build();
  const peers = await call("bus.query", { op: "list_peers", canvas: "c" });
  assert.equal(peers.peers.length, 2);
  const status = await call("bus.query", { op: "get_node_status", canvas: "c", node: "n1" });
  assert.equal(status.status, "live");
  const ghost = await call("bus.query", { op: "get_node_status", canvas: "c", node: "ghost" });
  assert.deepEqual(ghost, { status: "unknown" });
});

test("bus.query: unknown op -> bad-params (schema + handler agree)", async () => {
  const { call, byId } = build();
  assert.equal(byId["bus.query"].schema({ op: "nope" }).ok, false);
  const res = await call("bus.query", { op: "nope" });
  assert.equal(res.error.code, "bad-params");
});

test("bus.mutate: message_peer returns delivery shape from the route", async () => {
  const { call } = build();
  const res = await call("bus.mutate", {
    canvasId: "c", fromNodeId: "A", toNodeId: "B", message: "hi",
  });
  assert.deepEqual(res, { delivered: true, from: "A", to: "B", id: "m1", ts: 111 });
});

test("bus.mutate: session/stop/notify/task ops", async () => {
  const { call } = build();
  const session = await call("bus.mutate", { op: "session", canvasId: "c", fromNodeId: "A" });
  assert.equal(session.node.name, "A");
  assert.equal(session.node.status, "live");
  assert.deepEqual(await call("bus.mutate", { op: "stop", canvasId: "c", fromNodeId: "A" }), { ok: true });
  assert.deepEqual(await call("bus.mutate", { op: "notify" }), { ok: true });
  assert.deepEqual((await call("bus.mutate", { op: "task", x: 1 })).echo.x, 1);
  assert.equal((await call("bus.mutate", { op: "bogus" })).error.code, "bad-params");
});

// ---------------- activity logs ----------------

test("activity.snapshot: maps rows to entries, parses meta defensively", async () => {
  const { call, state } = build();
  const res = await call("activity.snapshot", { canvas: "c7", limit: 9999 });
  assert.equal(res.entries.length, 2);
  assert.deepEqual(res.entries[0], {
    id: "l1", ts: 1000, kind: "task_add", text: "hi", nodeId: "n1", meta: { a: 1 },
  });
  assert.equal(res.entries[1].meta, undefined); // unparseable payload -> undefined
  const args = state.dbCalls.find(([name]) => name === "agentLog.findMany")[1];
  assert.equal(args.take, 500); // clamp
  assert.deepEqual(args.where, { canvasId: "c7" });
});

test("activity.snapshot: node/kind/limit filters reach the query", async () => {
  const { call, state } = build();
  await call("activity.snapshot", { canvas: "c", node: "n1", kind: "task_add", limit: 5 });
  const args = state.dbCalls.find(([name]) => name === "agentLog.findMany")[1];
  assert.deepEqual(args.where, { canvasId: "c", nodeId: "n1", kind: "task_add" });
  assert.equal(args.take, 5);
});

test("activity.record: filters unknown kinds, normalizes, upserts canvas FK, createMany", async () => {
  const { call, state } = build();
  const res = await call("activity.record", {
    canvasId: "c9",
    entries: [
      { kind: "task_add", text: "ok", nodeId: "n", meta: { k: 1 } },
      { kind: "evil_kind", text: "no" },
      null,
      { kind: "search", text: "x".repeat(2000), nodeId: "y".repeat(500) },
    ],
  });
  assert.equal(res.written, 2);
  const upsert = state.dbCalls.find(([n]) => n === "canvas.upsert")[1];
  assert.equal(upsert.where.id, "c9");
  const create = state.dbCalls.find(([n]) => n === "agentLog.createMany")[1];
  assert.equal(create.data.length, 2);
  assert.equal(create.data[1].text.length, 1000); // sliced
  assert.equal(create.data[1].nodeId.length, 200); // sliced
});

test("activity.record: all-invalid -> written 0 (no DB writes)", async () => {
  const { call, state } = build();
  const res = await call("activity.record", { entries: [{ kind: "bogus" }] });
  assert.deepEqual(res, { written: 0 });
  assert.equal(state.dbCalls.length, 0);
});

test("__ops.logsClear: canvas required", async () => {
  const { call } = build();
  assert.equal((await call("__ops.logsClear", {})).error.code, "bad-params");
  assert.deepEqual(await call("__ops.logsClear", { canvas: "c1" }), { ok: true });
});

// ---------------- commander ----------------

test("__ops.commander: connect pattern -> connect_nodes step", async () => {
  const { call } = build();
  const res = await call("__ops.commander", {
    command: "connect alpha to beta",
    canvas: { nodes: [], connections: [] },
  });
  assert.equal(res.kind, "steps");
  assert.deepEqual(res.steps[0], { action: "connect_nodes", args: { from: "alpha", to: "beta" } });
  assert.equal(res._fallback, true);
});

test("__ops.commander: spawn-count and build patterns; ask fallback", async () => {
  const { call } = build();
  const canvas = { nodes: [], connections: [] };
  const spawn = await call("__ops.commander", { command: "spawn 3 agents", canvas });
  assert.deepEqual(spawn.steps[0], { action: "add_agents", args: { count: 3 } });

  const buildCmd = await call("__ops.commander", { command: "build the landing page", canvas });
  assert.equal(buildCmd.steps.length, 4);
  assert.equal(buildCmd.steps[0].action, "add_chat");

  const ask = await call("__ops.commander", { command: "hm?", canvas });
  assert.equal(ask.kind, "ask");
  assert.ok(ask.options.length > 0);
});

test("__ops.commander: command and canvas required", async () => {
  const { call } = build();
  assert.equal((await call("__ops.commander", {})).error.code, "bad-params");
});

// ---------------- agent run ----------------

test("__ops.agentRun: unknown persona -> bad-params; happy path shapes history", async () => {
  const { call, handlers } = build();
  const bad = await call("__ops.agentRun", { personaId: "nobody", harness: "claude", task: "t" });
  assert.equal(bad.error.code, "bad-params");

  let captured = null;
  const { handlers: h2 } = build({
    spawner: {
      runAgent: async (opts) => {
        captured = opts;
        return { text: "done", simulated: false, fellBack: false };
      },
    },
  });
  const run = h2.find((h) => h.id === "__ops.agentRun");
  const res = await run.handler({
    personaId: "explorer",
    harness: "claude",
    task: "do it",
    history: [
      { role: "system", text: "drop me" },
      { role: "user", text: "u1" },
      { role: "assistant", text: "a1" },
      { role: "user", text: "u2" },
      { role: "assistant", text: "a2" },
      { role: "user", text: "u3" },
      { role: "assistant", text: "a3" },
      { role: "user", text: "u4" },
      { role: "user", text: "u5" },
    ],
  });
  assert.deepEqual(res, { text: "done", simulated: false, fellBack: false, error: undefined });
  assert.equal(captured.personaName, "Explorer");
  assert.equal(captured.nodeId, "explorer");
  assert.equal(captured.history.length, 6); // slice(-6), system filtered (8 -> last 6)
  assert.equal(captured.history[0].text, "u2");
  assert.equal(handlers.find((h) => h.id === "__ops.agentRun").schema({}).ok, false);
});

// ---------------- registry conformance of the set ----------------

test("every handler id is either target-surface or an allow-listed __ops id", () => {
  const registry = require("../ipc/registry");
  const PRIVATE_OPS = require("../ipc/private-ops");
  const { handlers } = build();
  const allowed = new Set(PRIVATE_OPS);
  for (const h of handlers) {
    const ok = registry.inManifest(h.kind, h.id) || allowed.has(h.id);
    assert.ok(ok, `${h.kind}:${h.id} is neither target-surface nor a private op`);
  }
  // all four private ops are actually implemented
  for (const id of PRIVATE_OPS) {
    assert.ok(handlers.some((h) => h.id === id), `private op ${id} not implemented`);
  }
  assert.equal(handlers.length, 14); // 4 terminal + 3 canvas + 2 bus + 3 activity + 2 private
});
