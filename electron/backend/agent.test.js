"use strict";
// layer-1 tests for the agent bridge ids (doc 29 §T, doc 31 §5). Fake deps only.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeAgentHandlers } = require("./agent.ts");

const EXPECTED_IDS = ["agent.answerQuestion", "agent.pendingQuestions"];

function build(overrides = {}) {
  const state = {
    emitted: [],
    runAgentCalled: [],
    messageRows: [{ id: "q1", role: "commander", text: "what should I do next?", createdAt: new Date(100) }],
  };
  const deps = {
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      message: { findMany: async () => state.messageRows, create: async ({ data }) => ({ id: "q2", ...data, createdAt: new Date(400) }) },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      task: {}, session: {}, node: {}, artifact: {}, artifactVersion: {},
      ...(overrides.db || {}),
    },
    spawner: {
      runAgent: async (opts) => { state.runAgentCalled.push(opts); return { text: "answer", simulated: true }; },
      resolveAgentCommand: async () => null,
      HARNESS_BIN: { claude: "claude" },
      ...(overrides.spawner || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeAgentHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 2 dispatchable agent ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("agent.answerQuestion runs the agent and emits events.onAgentQuestionResolved", async () => {
  const { call, state } = build();
  const res = await call("agent.answerQuestion", { canvasId: "c", question: "how?" });
  assert.equal(res.text, "answer");
  assert.equal(state.runAgentCalled.length, 1);
  const resolved = state.emitted.find(([id]) => id === "events.onAgentQuestionResolved");
  assert.equal(resolved[1].answer, "answer");
  assert.equal(resolved[1].ok, true);
});

test("agent.pendingQuestions reads commander questions", async () => {
  const { call } = build();
  const res = await call("agent.pendingQuestions", { canvasId: "c" });
  assert.equal(res.questions.length, 1);
  assert.equal(res.questions[0].text, "what should I do next?");
});

test("bad-params for missing canvasId/question", async () => {
  const { call } = build();
  assert.equal((await call("agent.answerQuestion", { canvasId: "c" })).error.code, "bad-params");
  assert.equal((await call("agent.answerQuestion", { question: "?" })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makeAgentHandlers({
    db: {
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      message: { findMany: async () => [], create: async (x) => x.data },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      task: {}, session: {}, node: {}, artifact: {}, artifactVersion: {},
    },
    spawner: { runAgent: async () => ({ text: "x" }), resolveAgentCommand: async () => null, HARNESS_BIN: {} },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "agent.pendingQuestions", params: {} });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { questions: [] });

  const bad = await reg.dispatch({ id: "agent.answerQuestion", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
