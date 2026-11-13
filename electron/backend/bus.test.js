"use strict";
// layer-1 tests for the bus bridge ids (docs/architecture/ipc-facade.md, docs/architecture/backend.md). Fake deps only —
// no Electron, no Prisma, no PTY.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeBusHandlers } = require("./bus.ts");

const EXPECTED_IDS = [
  "bus.activityView", "bus.automationPreferences", "bus.cancelCloudTask",
  "bus.claimProjectChatInbox", "bus.consentAllowances", "bus.consentRequests",
  "bus.decideConsent", "bus.deliverInbox", "bus.enabled", "bus.executionStates",
  "bus.harnessReadiness", "bus.installRepo", "bus.learnCollaboratorDevice",
  "bus.nodeRemoved", "bus.cloudSend", "bus.pendingCounts", "bus.previewUninstall",
  "bus.receiveCollaboratorMessage", "bus.recentActivity", "bus.registerNode",
  "bus.resolveDeliveryUncertainty", "bus.revokeConsent", "bus.saveAutomationPreferences",
  "bus.setDeliveryPolicy", "bus.setEdges", "bus.setResourceContexts", "bus.startChatTurn",
  "bus.stopCloudSync", "bus.terminalExposure", "bus.uninstall",
];

function build(overrides = {}) {
  const state = {
    emitted: [], ensurePeer: [], setPeerStatus: [], sendMessage: [], drainInbox: [],
    edges: [], agentLog: [{ id: "l1", kind: "task_add", text: "hi", nodeId: "n1", createdAt: new Date(1000) }],
    peers: [{ canvasId: "c", nodeId: "n1", name: "n1", status: "live", lastSeen: new Date(1) }],
    messageCreate: [],
  };
  const deps = {
    busStore: {
      ensurePeer: async (canvasId, nodeId, name, status) => { state.ensurePeer.push([canvasId, nodeId, name, status]); },
      setPeerStatus: async (canvasId, nodeId, status) => { state.setPeerStatus.push([canvasId, nodeId, status]); },
      sendMessage: async (c, from, to, message) => {
        state.sendMessage.push([c, from, to, message]);
        return { delivered: true, id: "m1", ts: 111 };
      },
      drainInbox: async () => { state.drainInbox.push(true); return { injection: "INJ", drained: true }; },
      listPeers: async () => [{ id: "n1", name: "n1", status: "live" }],
      getPeer: async () => ({ id: "n1", name: "n1", status: "live", lastSeen: 1 }),
      ...(overrides.busStore || {}),
    },
    spawner: {
      runAgent: async () => ({ text: "", simulated: true }),
      resolveAgentCommand: async () => ({ command: "/bin/x", args: [], env: {} }),
      HARNESS_BIN: { claude: "claude", codex: "codex", opencode: "opencode" },
      ...(overrides.spawner || {}),
    },
    db: {
      agentLog: { findMany: async () => state.agentLog, count: async () => state.agentLog.length },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async ({ data }) => data, update: async (a) => a.data, upsert: async () => ({}), delete: async () => ({}) },
      busPeer: {
        findMany: async () => state.peers,
        findUnique: async () => state.peers[0],
        count: async () => state.peers.length,
        create: async ({ data }) => data, update: async (a) => a.data, upsert: async () => ({}),
      },
      message: { count: async () => 3, create: async ({ data }) => { state.messageCreate.push(data); return { id: "m1", ...data, createdAt: new Date(1) }; } },
      edge: { upsert: async (a) => { state.edges.push(a); return {}; } },
      artifact: {}, artifactVersion: {}, session: {}, task: {}, node: {},
      ...(overrides.db || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeBusHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 30 renderer-used bus ids, all in the manifest", () => {
  const { handlers, byId } = build();
  assert.equal(handlers.length, 30);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("bus.cloudSend sends a real message and emits bus.onActivity", async () => {
  const { call, state } = build();
  const res = await call("bus.cloudSend", { canvasId: "c", fromNodeId: "n1", toNodeId: "n2", message: "hello" });
  assert.deepEqual(res, { delivered: true, from: "n1", to: "n2", id: "m1", ts: 111 });
  assert.deepEqual(state.sendMessage, [["c", "n1", "n2", "hello"]]);
  const activity = state.emitted.find(([id]) => id === "bus.onActivity");
  assert.equal(activity[0], "bus.onActivity");
  assert.equal(activity[1].canvasId, "c");
  assert.equal(activity[1].kind, "message_peer");
  assert.equal(activity[1].messageId, "m1");
  assert.equal(activity[1].from, "n1");
  assert.equal(activity[1].to, "n2");
});

test("bus.cloudSend bad-params when message missing", async () => {
  const { call } = build();
  assert.equal((await call("bus.cloudSend", { canvasId: "c", fromNodeId: "n1", toNodeId: "n2" })).error.code, "bad-params");
});

test("bus.registerNode / nodeRemoved / startChatTurn / deliverInbox operate on the real store", async () => {
  const { call, state } = build();
  await call("bus.registerNode", { canvasId: "c", nodeId: "n1", name: "Explorer" });
  assert.deepEqual(state.ensurePeer, [["c", "n1", "Explorer", "live"]]);
  await call("bus.nodeRemoved", { canvasId: "c", nodeId: "n1" });
  assert.deepEqual(state.setPeerStatus, [["c", "n1", "offline"]]);
  await call("bus.startChatTurn", { canvasId: "c", nodeId: "n2" });
  assert.deepEqual(state.ensurePeer[state.ensurePeer.length - 1], ["c", "n2", "n2", "live"]);
  const drained = await call("bus.deliverInbox", { canvasId: "c", nodeId: "n1" });
  assert.equal(drained.drained, true);
  assert.equal(state.drainInbox.length, 1);
});

test("bus.setEdges upserts one row per edge; bad edge -> bad-params", async () => {
  const { call, state } = build();
  const res = await call("bus.setEdges", { canvasId: "c", edges: [{ sourceId: "a", targetId: "b" }, { sourceId: "b", targetId: "c", kind: "bus" }] });
  assert.deepEqual(res, { ok: true, edges: 2 });
  assert.equal(state.edges.length, 2);
  const bad = await call("bus.setEdges", { canvasId: "c", edges: [{ sourceId: "a" }] });
  assert.equal(bad.error.code, "bad-params");
});

test("bus.activityView / recentActivity / pendingCounts / executionStates read real db rows", async () => {
  const { call, state } = build();
  const view = await call("bus.activityView", { canvasId: "c" });
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].kind, "task_add");

  const recent = await call("bus.recentActivity", { canvasId: "c", limit: 5 });
  assert.equal(recent.items.length, 1);

  const counts = await call("bus.pendingCounts", { canvasId: "c" });
  assert.deepEqual(counts, { counts: { peers: 1, messages: 3 } });

  const exec = await call("bus.executionStates", { canvasId: "c" });
  assert.deepEqual(exec, { states: [{ nodeId: "n1", status: "live" }] });
});

test("bus.harnessReadiness reports the real HARNESS_BIN entries", async () => {
  const { call } = build();
  const res = await call("bus.harnessReadiness", {});
  assert.deepEqual(res.ready, [
    { harness: "claude", installed: true, binary: "claude" },
    { harness: "codex", installed: true, binary: "codex" },
    { harness: "opencode", installed: true, binary: "opencode" },
  ]);
});

test("honest-minimal surface: supported:false / empty shapes / not-implemented", async () => {
  const { call } = build();
  assert.deepEqual(await call("bus.automationPreferences", {}), { supported: false, preferences: {}, reason: "no automation-preferences store in autumn" });
  assert.deepEqual(await call("bus.consentAllowances", {}), { supported: false, allowances: [], reason: "no consent store in autumn" });
  assert.deepEqual(await call("bus.consentRequests", {}), { supported: false, requests: [], reason: "no consent store in autumn" });
  assert.deepEqual(await call("bus.learnCollaboratorDevice", {}), { supported: false, devices: [], reason: "no collaborator-device store in autumn" });
  assert.deepEqual(await call("bus.receiveCollaboratorMessage", {}), { supported: false, messages: [], reason: "no collaborator channel in autumn" });
  assert.deepEqual(await call("bus.setResourceContexts", { contexts: [] }), { supported: false, applied: false, reason: "no resource-context store in autumn" });
  assert.equal((await call("bus.installRepo", {})).error.code, "not-implemented");
  assert.equal((await call("bus.previewUninstall", {})).error.code, "not-implemented");
  assert.equal((await call("bus.uninstall", {})).error.code, "not-implemented");
  assert.equal((await call("bus.stopCloudSync", {})).error.code, "not-implemented");
  assert.equal((await call("bus.decideConsent", { requestId: "r", decision: "allow" })).error.code, "not-implemented");
  assert.equal((await call("bus.revokeConsent", { requestId: "r" })).error.code, "not-implemented");
  assert.equal((await call("bus.cancelCloudTask", { taskId: "t" })).error.code, "not-implemented");
  assert.equal((await call("bus.resolveDeliveryUncertainty", { messageId: "m" })).error.code, "not-implemented");
  assert.deepEqual(await call("bus.enabled", {}), { enabled: true });
  assert.deepEqual(await call("bus.terminalExposure", {}), { exposed: false });
});

test("registry dispatch round-trip wraps plain payloads and passes envelopes through", async () => {
  const handlers = makeBusHandlers({
    busStore: {
      ensurePeer: async () => {},
      setPeerStatus: async () => {},
      sendMessage: async () => ({ delivered: true, id: "m1", ts: 1 }),
      drainInbox: async () => ({ injection: "", drained: false }),
      listPeers: async () => [],
      getPeer: async () => null,
    },
    spawner: { runAgent: async () => ({ text: "" }), resolveAgentCommand: async () => null, HARNESS_BIN: {} },
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async ({ data }) => data, update: async (a) => a.data, upsert: async () => ({}), delete: async () => ({}) },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async ({ data }) => data, update: async (a) => a.data, upsert: async () => ({}) },
      message: { count: async () => 0, create: async ({ data }) => data },
      edge: { upsert: async () => ({}) },
      artifact: {}, artifactVersion: {}, session: {}, task: {}, node: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "bus.cloudSend", params: { canvasId: "c", fromNodeId: "n1", toNodeId: "n2", message: "hi" } });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.id, "m1");

  const bad = await reg.dispatch({ id: "bus.cloudSend", params: { canvasId: "c" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const ni = await reg.dispatch({ id: "bus.installRepo", params: {} });
  assert.equal(ni.ok, false);
  assert.equal(ni.error.code, "not-implemented");
});
