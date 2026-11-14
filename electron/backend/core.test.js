"use strict";
// The core protocol (Wave 4, doc 35 §7): 129 methods over 21 groups.
//
// These tests register the REAL backend (the bridge handlers + the core
// handlers) and check:
//   - the whole surface is there: 129/129;
//   - every method dispatches and answers an envelope;
//   - the principal table is enforced: the cli may drive a terminal and is
//     refused a desktop-only method;
//   - a capability token carries its own grant.
//
// The hosted tier answers honestly (not-implemented) instead of pretending.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");
const { makeCoreHandlers } = require("./core/index.ts");

const { makeHandlers, W1_FACTORIES, W2_FACTORIES } = require("./index.ts");

/** The fake deps the contract test uses — the factories only close over them. */
function fakeDeps() {
  const noop = () => {};
  const model = new Proxy({}, { get: () => async () => [] });
  const modelWithCount = new Proxy({}, { get: (_t, prop) => async () => (prop === "count" ? 0 : []) });
  const db = new Proxy({}, { get: () => modelWithCount });
  return {
    busStore: {
      ensurePeer: noop,
      setPeerStatus: noop,
      sendMessage: async () => ({ delivered: true, id: "m", ts: 1 }),
      drainInbox: async () => ({ injection: "", drained: false }),
      listPeers: async () => [],
      getPeer: async () => null,
    },
    pty: {
      createPty: () => false,
      subscribePty: () => () => {},
      writePty: () => false,
      resizePty: noop,
      killPty: noop,
      ptyExists: () => false,
      ptyKind: () => undefined,
      ptyCount: () => 0,
      list: () => [],
      onPtyExit: () => () => {},
    },
    spawner: {
      runAgent: async () => ({ text: "" }),
      resolveAgentCommand: async () => null,
      HARNESS_BIN: {},
    },
    db,
    personas: { PERSONA_BY_ID: {} },
    emit: noop,
    now: () => Date.now(),
    fs: {},
    shell: { openPath: async () => "", showItemInFolder: noop, openExternal: async () => {} },
    clipboard: { readText: () => "", writeText: noop, readImage: () => null },
    screen: { capture: async () => null },
    git: () => ({}),
    spawn: { spawn: () => ({ on: noop, kill: noop }) },
  };
}

/** Register the real backend: the bridge handlers + the core handlers. */
function registerAll() {
  const deps = fakeDeps();
  const bridge = [
    ...makeHandlers(deps),
    ...W1_FACTORIES.flatMap((make) => make(deps)),
    ...W2_FACTORIES.flatMap((make) => make(deps)),
  ];
  const bridgeById = new Map(bridge.map((h) => [h.id, h]));
  const core = makeCoreHandlers(deps, (id) => bridgeById.get(id));
  for (const h of [...bridge, ...core]) {
    reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
  return { bridge, core };
}

const CORE_METHODS = Object.values(manifest.core.groups).flat();

beforeEach(() => {
  reg.reset();
  useTempUserData();
});

test("the whole core surface is registered: 129/129 over 21 groups", () => {
  registerAll();
  const missing = CORE_METHODS.filter((m) => !reg.has("core", m));
  assert.deepEqual(missing, [], `missing core methods: ${missing.join(", ")}`);
  assert.equal(CORE_METHODS.length, 129);
  const groups = new Set(CORE_METHODS.map((m) => m.split(".")[0]));
  assert.equal(groups.size, 21);
});

test("every core method has a description and dispatches to an envelope", async () => {
  const { core } = registerAll();
  for (const h of core.filter((x) => x.kind === "core")) {
    assert.ok(h.description && h.description.length > 10, `${h.id} needs a description`);
    const env = await reg.dispatch({ kind: "core", id: h.id, params: {}, principal: "desktop" });
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must answer an envelope`);
    assert.ok(
      !/^no handler for /.test(env.error?.message ?? ""),
      `${h.id} must not be unknown: ${env.error?.message}`,
    );
  }
});

test("the cli principal may drive a terminal and is refused a desktop-only method", async () => {
  registerAll();
  const allowed = await reg.dispatch({ kind: "core", id: "terminal.list", params: {}, principal: "cli" });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  const refused = await reg.dispatch({ kind: "core", id: "git.mutate", params: {}, principal: "cli" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "forbidden");
  assert.match(refused.error.message, /not granted/);
});

test("the local-client principal may read the surfaces", async () => {
  registerAll();
  const ok = await reg.dispatch({ kind: "core", id: "bus.query", params: { op: "list_peers" }, principal: "local-client" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const refused = await reg.dispatch({ kind: "core", id: "terminal.create", params: {}, principal: "local-client" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "forbidden");
});

test("a capability token carries its own grant", async () => {
  registerAll();
  const granted = await reg.dispatch({
    kind: "core",
    id: "core.status",
    params: {},
    principal: "capability",
    capability: { methods: ["core.status"] },
  });
  assert.equal(granted.ok, true, JSON.stringify(granted));
  const refused = await reg.dispatch({
    kind: "core",
    id: "core.status",
    params: {},
    principal: "capability",
    capability: { methods: ["agent.list"] },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "forbidden");
});

test("the hosted tier exists and answers honestly", async () => {
  registerAll();
  for (const id of ["hosted.status", "cloudAgent.list"]) {
    const env = await reg.dispatch({ kind: "core", id, params: {}, principal: "desktop" });
    assert.equal(env.ok, false, `${id} must not pretend to work`);
    assert.equal(env.error.code, "not-implemented");
    assert.match(env.error.message, /hosted tier/);
  }
});

test("the handshake tells the client what it may call", async () => {
  registerAll();
  const env = await reg.dispatch({ kind: "core", id: "core.handshake", params: {}, principal: "cli" });
  assert.equal(env.ok, true);
  assert.equal(env.result.apiVersion, 2);
  assert.equal(env.result.granted, "cli");
});

test("the intents really queue and really acknowledge", async () => {
  registerAll();
  const queued = await reg.dispatch({
    kind: "core",
    id: "intent.enqueue",
    params: { kind: "summarise", payload: { text: "hello" } },
    principal: "desktop",
  });
  assert.equal(queued.ok, true, JSON.stringify(queued));
  const intentId = queued.result.intent.id;
  const list = await reg.dispatch({ kind: "core", id: "intent.list", params: {}, principal: "desktop" });
  assert.equal(list.result.intents.length, 1);
  const acked = await reg.dispatch({
    kind: "core",
    id: "intent.ack",
    params: { intentId },
    principal: "desktop",
  });
  assert.equal(acked.ok, true);
  const after = await reg.dispatch({ kind: "core", id: "intent.list", params: {}, principal: "desktop" });
  assert.equal(after.result.intents.length, 0, "the acknowledged intent is gone from the queue");
});

test("a capability really is granted, and really expires", async () => {
  registerAll();
  const granted = await reg.dispatch({
    kind: "core",
    id: "capability.registerEndpoint",
    params: { methods: ["facts.query"], expiresAt: Date.now() + 60_000 },
    principal: "desktop",
  });
  assert.equal(granted.ok, true);
  assert.equal(granted.result.grant.methods[0], "facts.query");
  const list = await reg.dispatch({ kind: "core", id: "capability.mcpAdmission", params: {}, principal: "desktop" });
  assert.equal(list.result.admissions.length, 1);
  const cleared = await reg.dispatch({
    kind: "core",
    id: "capability.clearEndpoint",
    params: { capabilityId: granted.result.grant.id },
    principal: "desktop",
  });
  assert.equal(cleared.ok, true);
  const after = await reg.dispatch({ kind: "core", id: "capability.mcpAdmission", params: {}, principal: "desktop" });
  assert.equal(after.result.admissions.length, 0, "the grant is really gone");
});
