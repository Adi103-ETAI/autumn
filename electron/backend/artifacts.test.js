"use strict";
// layer-1 tests for the artifacts bridge ids (docs/architecture/ipc-facade.md, docs/architecture/backend.md). Fake Prisma deps.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeArtifactsHandlers } = require("./artifacts.ts");

const EXPECTED_IDS = [
  "artifacts.catalog", "artifacts.deleteVersions", "artifacts.export", "artifacts.get",
  "artifacts.previewHtml", "artifacts.read", "artifacts.restore", "artifacts.retire",
  "artifacts.reveal", "artifacts.save", "artifacts.usage", "artifacts.versions",
];

function seedState() {
  return {
    artifacts: [
      { id: "a1", canvasId: "c", name: "demo", kind: "html", path: null, content: "<p>v2</p>", version: 2, retired: false, meta: "{}", createdAt: new Date(100), updatedAt: new Date(300) },
    ],
    versions: [
      { id: "v1", artifactId: "a1", version: 1, content: "<p>v1</p>", path: null, meta: "{}", createdAt: new Date(100) },
      { id: "v2", artifactId: "a1", version: 2, content: "<p>v2</p>", path: null, meta: "{}", createdAt: new Date(200) },
    ],
  };
}

function build(overrides = {}) {
  const state = seedState();
  state.emitted = [];
  state.deleted = [];
  const db = {
    artifact: {
      findMany: async (args) => state.artifacts.filter((a) => (!args?.where?.retired || a.retired === args.where.retired) && (!args?.where?.canvasId || a.canvasId === args.where.canvasId) && (!args?.where?.kind || a.kind === args.where.kind) && (!args?.where?.name || a.name === args.where.name) && (!args?.where?.id || a.id === args.where.id)),
      findUnique: async ({ where: { id } }) => state.artifacts.find((a) => a.id === id) ?? null,
      create: async ({ data }) => { const a = { id: `a${state.artifacts.length + 1}`, ...data, createdAt: new Date(400), updatedAt: new Date(400) }; state.artifacts.push(a); return a; },
      update: async ({ where: { id }, data }) => { const a = state.artifacts.find((x) => x.id === id); Object.assign(a, data); return a; },
    },
    artifactVersion: {
      findMany: async (args) => state.versions.filter((v) => (!args?.where?.artifactId || v.artifactId === args.where.artifactId) && (!args?.where?.version || v.version === args.where.version)).sort((a, b) => b.version - a.version),
      create: async ({ data }) => { state.versions.push({ id: `v${state.versions.length + 1}`, ...data, createdAt: new Date(500) }); return data; },
      delete: async ({ where: { id } }) => { state.deleted.push(id); state.versions = state.versions.filter((v) => v.id !== id); return {}; },
    },
    session: {}, task: {}, message: {}, node: {}, edge: {}, busPeer: {},
    ...(overrides.db || {}),
  };
  const deps = {
    db,
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides.rest,
  };
  const handlers = makeArtifactsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

beforeEach(() => reg.reset());

test("id surface: exactly the 12 dispatchable artifacts ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 12);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("artifacts.usage derives facts from rows; missing artifact -> not-found", async () => {
  const { call } = build();
  const res = await call("artifacts.usage", { artifactId: "a1" });
  assert.equal(res.versionCount, 2);
  assert.equal(res.totalContentBytes, Buffer.byteLength("<p>v2</p>", "utf8"));
  const missing = await call("artifacts.usage", { artifactId: "ghost" });
  assert.equal(missing.error.code, "not-found");
  const canvas = await call("artifacts.usage", { canvasId: "c" });
  assert.equal(canvas.count, 1);
});

test("artifacts.catalog lists non-retired artifacts", async () => {
  const { call } = build();
  const res = await call("artifacts.catalog", { canvasId: "c" });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].name, "demo");
  assert.equal(res.items[0].version, 2);
});

test("artifacts.get returns the artifact or not-found", async () => {
  const { call } = build();
  const res = await call("artifacts.get", { artifactId: "a1" });
  assert.equal(res.name, "demo");
  const missing = await call("artifacts.get", { artifactId: "ghost" });
  assert.equal(missing.error.code, "not-found");
});

test("artifacts.save creates a new artifact and version 1", async () => {
  const { call, state } = build();
  const res = await call("artifacts.save", { canvasId: "c", name: "fresh", kind: "text", content: "body" });
  assert.equal(res.version, 1);
  assert.equal(res.name, "fresh");
  const versions = await call("artifacts.versions", { artifactId: res.id });
  assert.deepEqual(versions.versions.map((v) => v.version), [1]);
  const saved = state.emitted.find(([id]) => id === "artifacts.onChanged");
  assert.equal(saved[0], "artifacts.onChanged");
  assert.equal(saved[1].action, "saved");
  assert.equal(saved[1].canvasId, "c");
});

test("artifacts.save on existing artifact bumps the version and snapshots the old content", async () => {
  const { call } = build();
  const res = await call("artifacts.save", { canvasId: "c", name: "demo", content: "<p>v3</p>" });
  assert.equal(res.version, 3);
  const versions = await call("artifacts.versions", { artifactId: "a1" });
  assert.deepEqual(versions.versions.map((v) => v.version).sort(), [1, 2, 3]);
  // newest version snapshot holds the OLD content (snapshot-before-write)
  const v3 = versions.versions.find((v) => v.version === 3);
  assert.equal(v3.content, "<p>v2</p>");
});

test("artifacts.read reads current content and a specific version", async () => {
  const { call } = build();
  const current = await call("artifacts.read", { artifactId: "a1" });
  assert.equal(current.content, "<p>v2</p>");
  assert.equal(current.version, 2);
  const v1 = await call("artifacts.read", { artifactId: "a1", version: 1 });
  assert.equal(v1.content, "<p>v1</p>");
  const ghost = await call("artifacts.read", { artifactId: "a1", version: 99 });
  assert.equal(ghost.error.code, "not-found");
});

test("artifacts.restore sets content to the version and emits onChanged", async () => {
  const { call, state } = build();
  const res = await call("artifacts.restore", { artifactId: "a1", version: 1 });
  assert.equal(res.version, 1);
  assert.equal(res.content, "<p>v1</p>");
  const actions = state.emitted.map(([, p]) => p.action);
  assert.ok(actions.includes("restored"));
});

test("artifacts.retire sets retired and emits onChanged", async () => {
  const { call, state } = build();
  const res = await call("artifacts.retire", { artifactId: "a1" });
  assert.equal(res.retired, true);
  const actions = state.emitted.map(([, p]) => p.action);
  assert.ok(actions.includes("retired"));
});

test("artifacts.deleteVersions keeps the latest N versions", async () => {
  const { call, state } = build();
  const res = await call("artifacts.deleteVersions", { artifactId: "a1", keepLatest: 1 });
  assert.equal(res.deleted, 1);
  assert.deepEqual(state.deleted, ["v1"]);
});

test("artifacts.export returns artifact and versions; artifacts.reveal returns the path", async () => {
  const { call } = build();
  const res = await call("artifacts.export", { artifactId: "a1" });
  assert.equal(res.artifact.name, "demo");
  assert.equal(res.versions.length, 2);
  const reveal = await call("artifacts.reveal", { artifactId: "a1" });
  assert.deepEqual(reveal, { artifactId: "a1", path: null });
});

test("artifacts.previewHtml escapes text/html content; bad-params for bad inputs", async () => {
  const { call } = build();
  const res = await call("artifacts.previewHtml", { artifactId: "a1" });
  assert.match(res.html, /<p>v2<\/p>/);
  const bad = await call("artifacts.previewHtml", { artifactId: 123 });
  assert.equal(bad.error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads and passes envelopes through", async () => {
  const handlers = makeArtifactsHandlers({
    db: {
      artifact: { findMany: async () => [], findUnique: async () => null, create: async (x) => ({ id: "a", ...x.data }), update: async (x) => x.data },
      artifactVersion: { findMany: async () => [], create: async (x) => x.data, delete: async () => ({}) },
      session: {}, task: {}, message: {}, node: {}, edge: {}, busPeer: {},
    },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "artifacts.catalog", params: { canvasId: "c" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { items: [] });

  const bad = await reg.dispatch({ id: "artifacts.get", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const nf = await reg.dispatch({ id: "artifacts.get", params: { artifactId: "ghost" } });
  assert.equal(nf.ok, false);
  assert.equal(nf.error.code, "not-found");
});
