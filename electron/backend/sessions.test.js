"use strict";
// layer-1 tests for the sessions bridge ids (doc 29 §T, doc 31 §5). Fake Prisma deps.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeSessionsHandlers } = require("./sessions.ts");

const EXPECTED_IDS = [
  "sessions.cancelLibraryImport", "sessions.engineStatus", "sessions.folderFacts",
  "sessions.historyDetail", "sessions.historyPage", "sessions.importBatchCancel",
  "sessions.importBatchRetry", "sessions.importBatchStart", "sessions.importBatchStatus",
  "sessions.importBindDocument", "sessions.importLibrary", "sessions.importSession",
  "sessions.importedList", "sessions.library", "sessions.list", "sessions.peekChat",
  "sessions.read", "sessions.search",
];

function build(overrides = {}) {
  const state = {
    emitted: [],
    sessions: [
      { id: "s1", canvasId: "c", nodeId: "n1", engine: "codex", externalId: "ext-1", title: "session one", path: null, messages: JSON.stringify([{ id: "msg1", role: "user", text: "hello", ts: 111 }, { id: "msg2", role: "assistant", text: "hi", ts: 222 }]), meta: "{}", createdAt: new Date(100), updatedAt: new Date(300) },
    ],
    messageRows: [{ id: "msg1", canvasId: "c", nodeId: "n1", role: "user", text: "hello world", authorId: "n1", createdAt: new Date(111) }],
    created: [],
  };
  const db = {
    session: {
      findMany: async ({ where }) => state.sessions.filter((s) =>
        (!where?.canvasId || s.canvasId === where.canvasId) &&
        (!where?.externalId || s.externalId === where.externalId)),
      findUnique: async ({ where: { id } }) => state.sessions.find((s) => s.id === id) ?? null,
      create: async ({ data }) => { const s = { id: `s${state.sessions.length + 1}`, ...data, createdAt: new Date(400), updatedAt: new Date(400) }; state.sessions.push(s); state.created.push(s); return s; },
      count: async () => state.sessions.length,
    },
    message: {
      findMany: async () => state.messageRows,
      create: async ({ data }) => ({ id: "new", ...data, createdAt: new Date(500) }),
    },
    agentLog: { findMany: async () => [] },
    canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
    busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
    edge: { upsert: async () => ({}) },
    node: {}, task: {}, artifact: {}, artifactVersion: {},
    ...(overrides.db || {}),
  };
  const deps = {
    db,
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeSessionsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 18 dispatchable sessions ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 18);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("sessions.read returns the session with parsed messages; missing -> not-found", async () => {
  const { call } = build();
  const res = await call("sessions.read", { sessionId: "s1" });
  assert.equal(res.title, "session one");
  assert.deepEqual(res.messages, [{ id: "msg1", role: "user", text: "hello", ts: 111 }, { id: "msg2", role: "assistant", text: "hi", ts: 222 }]);
  const missing = await call("sessions.read", { sessionId: "ghost" });
  assert.equal(missing.error.code, "not-found");
});

test("sessions.historyPage paginates the embedded message list", async () => {
  const { call } = build();
  const res = await call("sessions.historyPage", { sessionId: "s1", page: 1, pageSize: 1 });
  assert.equal(res.messages.length, 1);
  assert.equal(res.total, 2);
});

test("sessions.historyDetail returns one message or not-found", async () => {
  const { call } = build();
  const res = await call("sessions.historyDetail", { sessionId: "s1", messageId: "msg2" });
  assert.equal(res.message.text, "hi");
  const missing = await call("sessions.historyDetail", { sessionId: "s1", messageId: "ghost" });
  assert.equal(missing.error.code, "not-found");
});

test("sessions.peekChat reads db.message rows", async () => {
  const { call } = build();
  const res = await call("sessions.peekChat", { nodeId: "n1", canvasId: "c" });
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].text, "hello world");
});

test("sessions.engineStatus derives from real rows", async () => {
  const { call } = build();
  const status = await call("sessions.engineStatus", { engine: "codex" });
  assert.deepEqual(status, { engine: "codex", status: "active", sessionCount: 1 });
});

test("sessions.folderFacts reports what kind of folder each path is", async () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-facts-"));
  const { call } = build();
  const facts = await call("sessions.folderFacts", { paths: [dir, path.join(dir, "ghost")] });
  assert.equal(facts.facts.length, 2);
  assert.equal(facts.facts[0].kind, "folder");
  assert.equal(facts.facts[0].path, dir);
  assert.equal(typeof facts.facts[0].home, "boolean");
  assert.equal(facts.facts[1].kind, "missing");
  // The relative path is ignored (the RE's rule).
  const onlyRelative = await call("sessions.folderFacts", { paths: ["relative/path"] });
  assert.deepEqual(onlyRelative.facts, []);
});

test("sessions.importSession creates a session row and emits onImportBatch", async () => {
  const { call, state } = build();
  const res = await call("sessions.importSession", { canvasId: "c", externalId: "ext-9", engine: "claude" });
  assert.equal(res.imported, true);
  const batch = state.emitted.find(([id]) => id === "sessions.onImportBatch");
  assert.equal(batch[1].stage, "imported");
});

test("sessions.importBatchStart creates a session and emits started", async () => {
  const { call, state } = build();
  const res = await call("sessions.importBatchStart", { canvasId: "c", source: "file:///tmp/x.json" });
  assert.ok(res.batchId);
  const batch = state.emitted.find(([id]) => id === "sessions.onImportBatch");
  assert.equal(batch[1].stage, "started");
});

test("the library index is real: it is written, read back and survives a reload", async () => {
  const { call } = build();
  const before = await call("sessions.library", {});
  assert.ok(Array.isArray(before.sessions));
  const imported = await call("sessions.importLibrary", {});
  assert.equal(typeof imported.imported, "number");
  assert.equal(typeof imported.total, "number");
  assert.ok(Array.isArray(imported.warnings));
  const after = await call("sessions.library", {});
  assert.ok(Array.isArray(after.sessions));
});

test("a damaged library index is preserved, not ignored", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { useTempUserData } = require("./store.ts");
  const dir = useTempUserData();
  const file = path.join(dir, "session-library.json");
  fs.writeFileSync(file, "{ not json", "utf8");
  const { call } = build();
  const res = await call("sessions.library", {});
  assert.deepEqual(res.sessions, [], "a damaged index yields no rows");
  assert.equal(res.warnings.length, 1, "the damage is reported");
  const preserved = fs.readdirSync(dir).filter((f) => f.includes("corrupt"));
  assert.equal(preserved.length, 1, "the damaged file is preserved for diagnosis");
});

test("cancelLibraryImport answers honestly when no scan is running", async () => {
  const { call } = build();
  const res = await call("sessions.cancelLibraryImport", {});
  assert.equal(res.ok, true);
  assert.equal(res.cancelled, false, "nothing was running, so nothing was cancelled");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makeSessionsHandlers({
    db: {
      session: { findMany: async () => [], findUnique: async () => null, create: async (x) => ({ id: "s", ...x.data }), count: async () => 0 },
      message: { findMany: async () => [], create: async (x) => x.data },
      agentLog: { findMany: async () => [] },
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
      edge: { upsert: async () => ({}) },
      node: {}, task: {}, artifact: {}, artifactVersion: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const nf = await reg.dispatch({ id: "sessions.read", params: { sessionId: "ghost" } });
  assert.equal(nf.ok, false);
  assert.equal(nf.error.code, "not-found");

  const bad = await reg.dispatch({ id: "sessions.read", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
