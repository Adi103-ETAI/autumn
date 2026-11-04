"use strict";
// layer-1 tests for the projectChatHistory bridge ids (doc 29 §T, doc 31 §5). Fake deps only.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makePchHandlers } = require("./pch.ts");

const EXPECTED_IDS = [
  "projectChatHistory.importLegacy",
  "projectChatHistory.read",
  "projectChatHistory.upsert",
];

function build(overrides = {}) {
  const state = {
    emitted: [],
    created: [],
    messageRows: [
      { id: "m1", canvasId: "c", nodeId: "n1", role: "user", text: "hello", authorId: "n1", createdAt: new Date(100) },
      { id: "m2", canvasId: "c", nodeId: "n1", role: "assistant", text: "hi back", authorId: null, createdAt: new Date(200) },
    ],
  };
  const db = {
    agentLog: { findMany: async () => [] },
    canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
    message: {
      findMany: async ({ orderBy }) => {
        const rows = [...state.messageRows];
        return orderBy?.createdAt === "desc" ? rows.sort((a, b) => b.createdAt - a.createdAt) : rows.sort((a, b) => a.createdAt - b.createdAt);
      },
      create: async ({ data }) => { const r = { id: `m${state.messageRows.length + 1}`, ...data, createdAt: new Date(300) }; state.created.push(r); state.messageRows.push(r); return r; },
    },
    busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
    edge: { upsert: async () => ({}) },
    task: {}, session: {}, node: {}, artifact: {}, artifactVersion: {},
    ...(overrides.db || {}),
  };
  const deps = {
    db,
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makePchHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 3 dispatchable projectChatHistory ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 3);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("projectChatHistory.read returns the stored messages in order", async () => {
  const { call } = build();
  const res = await call("projectChatHistory.read", { canvasId: "c", nodeId: "n1" });
  assert.equal(res.messages.length, 2);
  assert.equal(res.messages[0].text, "hello");
  assert.equal(res.messages[1].text, "hi back");
});

test("projectChatHistory.upsert creates a message row", async () => {
  const { call, state } = build();
  const res = await call("projectChatHistory.upsert", { canvasId: "c", nodeId: "n1", role: "user", text: "just added" });
  assert.equal(res.text, "just added");
  assert.equal(state.created.length, 1);
  assert.equal(state.emitted.length, 0); // pch emits nothing (doc 31)
});

test("projectChatHistory.importLegacy is an honest empty import", async () => {
  const { call } = build();
  const res = await call("projectChatHistory.importLegacy", { canvasId: "c", source: "jsonl-file" });
  assert.deepEqual(res, { imported: 0, reason: "no legacy chat importer in autumn" });
});

test("bad-params for missing canvasId/nodeId/text", async () => {
  const { call } = build();
  assert.equal((await call("projectChatHistory.read", {})).error.code, "bad-params");
  assert.equal((await call("projectChatHistory.upsert", { canvasId: "c" })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makePchHandlers({
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      message: { findMany: async () => [], create: async (x) => x.data },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      task: {}, session: {}, node: {}, artifact: {}, artifactVersion: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "projectChatHistory.read", params: { canvasId: "c" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { canvasId: "c", messages: [] });

  const bad = await reg.dispatch({ id: "projectChatHistory.upsert", params: { canvasId: "c" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
