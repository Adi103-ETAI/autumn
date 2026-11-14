"use strict";
// The Wave-4 local namespaces (doc 35 §8): the projects, the app's own
// surface and the hosted tier.
//
// The projects are tested against a REAL tree on disk (the routes are really
// read out of the sources), the app's state really persists, and the hosted
// tier really answers not-implemented.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeProjectsHandlers, scanRoutes, detectProjectKind, discoverApps } = require("./projects.ts");
const { makeLocalSurfaceHandlers } = require("./app-surface.ts");
const { makeLocalExtrasHandlers } = require("./extras.ts");
const { makeHostedHandlers } = require("./hosted.ts");

function build(overrides = {}) {
  const state = { emitted: [] };
  const noop = () => {};
  const model = new Proxy({}, { get: (_t, prop) => async () => (prop === "count" ? 0 : []) });
  const db = new Proxy({}, { get: () => model });
  const deps = {
    busStore: {
      ensurePeer: noop,
      setPeerStatus: noop,
      sendMessage: async () => ({ delivered: true, id: "m", ts: 1 }),
      drainInbox: async () => ({ injection: "", drained: false }),
      listPeers: async () => [{ nodeId: "n1", name: "Atlas", status: "live" }],
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
      list: () => [{ nodeId: "n1", kind: "agent" }],
      onPtyExit: () => () => {},
    },
    spawner: {
      runAgent: async () => ({ text: "", simulated: true }),
      resolveAgentCommand: async () => null,
      HARNESS_BIN: {},
    },
    db,
    personas: { PERSONA_BY_ID: {} },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    fs: {},
    shell: { openPath: async () => "", showItemInFolder: noop, openExternal: async () => {} },
    clipboard: { readText: () => "", writeText: noop, readImage: () => null, hasImage: () => false },
    screen: { capture: async () => null },
    git: () => ({ raw: async () => "" }),
    spawn: { spawn: () => ({ on: noop, kill: noop }) },
    ...overrides,
  };
  const handlers = [
    ...makeProjectsHandlers(deps),
    ...makeLocalSurfaceHandlers(deps),
    ...makeLocalExtrasHandlers(deps),
    ...makeHostedHandlers(),
  ];
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

beforeEach(() => {
  reg.reset();
  useTempUserData();
});

// ---------------------------------------------------------------------------
// the projects
// ---------------------------------------------------------------------------

test("the projects' ids are all in the contract", () => {
  const { handlers } = build();
  const ids = handlers.filter((h) => h.id.startsWith("projects.")).map((h) => h.id);
  const wanted = manifest.bridge.namespaces.projects.map((m) => `projects.${m}`);
  assert.deepEqual(ids.sort(), wanted.sort());
});

test("the Next.js routes are really read out of the pages", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-next-"));
  fs.mkdirSync(path.join(dir, "app", "settings", "profile"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "page.tsx"), "export default () => null;");
  fs.writeFileSync(path.join(dir, "app", "settings", "page.tsx"), "export default () => null;");
  fs.writeFileSync(path.join(dir, "app", "settings", "profile", "page.tsx"), "export default () => null;");
  const routes = scanRoutes(dir, "next");
  const paths = routes.map((r) => r.routePath).sort();
  assert.deepEqual(paths, ["/", "/settings", "/settings/profile"]);
});

test("the Flutter routes are really read out of the Dart sources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-flutter-"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "lib", "routes.dart"),
    "static const home = '/home';\nstatic const settings = '/settings';\n",
    "utf8",
  );
  const routes = scanRoutes(dir, "flutter");
  assert.deepEqual(
    routes.map((r) => r.routePath).sort(),
    ["/home", "/settings"],
  );
});

test("the project's kind and apps are really detected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-apps-"));
  fs.mkdirSync(path.join(dir, "mobile"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  fs.writeFileSync(path.join(dir, "mobile", "pubspec.yaml"), "name: mobile\n");
  assert.equal(detectProjectKind(dir), "node");
  assert.equal(detectProjectKind(path.join(dir, "mobile")), "flutter");
  const apps = discoverApps(dir);
  assert.ok(apps.some((a) => a.name === "mobile" && a.kind === "flutter"));
});

test("a project is really created, opened and remembered", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-projects-"));
  const { call } = build();
  const created = await call("projects.create", { name: "demo", parent });
  assert.equal(created.path, path.join(parent, "demo"));
  assert.ok(fs.existsSync(path.join(parent, "demo", "package.json")));
  const opened = await call("projects.open", { path: created.path });
  assert.equal(opened.project.name, "demo");
  const recents = await call("projects.recents", {});
  assert.equal(recents.recents.length, 1);
  assert.equal(recents.recents[0].missing, false);
  const forgotten = await call("projects.forgetRecent", { path: created.path });
  assert.equal(forgotten.ok, true);
  const after = await call("projects.recents", {});
  assert.equal(after.recents.length, 0);
});

test("a recent project is really relocated", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-projects-"));
  const oldPath = path.join(parent, "old");
  const newPath = path.join(parent, "new");
  fs.mkdirSync(oldPath);
  fs.mkdirSync(newPath);
  const { call } = build();
  await call("projects.open", { path: oldPath });
  const moved = await call("projects.relocateRecent", { oldPath, newPath });
  assert.equal(moved.ok, true);
  assert.equal(moved.info.path, newPath);
  const recents = await call("projects.recents", {});
  assert.equal(recents.recents[0].path, newPath);
});

test("the routes of a project are real", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-routes-"));
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "page.tsx"), "export default () => null;");
  const { call } = build();
  const res = await call("projects.scanRoutes", { path: dir });
  assert.deepEqual(res.routes.map((r) => r.routePath), ["/"]);
});

// ---------------------------------------------------------------------------
// the app's own surface
// ---------------------------------------------------------------------------

test("the app's state really persists", async () => {
  const { call } = build();
  await call("app.rendererMounted", {});
  const health = await call("app.coreHealth", {});
  assert.equal(health.rendererMounted, true);
  await call("app.reportOpenCanvas", { canvasId: "c1" });
  const health2 = await call("app.coreHealth", {});
  assert.equal(health2.rendererMounted, true);
});

test("the scratch workspaces are really saved, listed and deleted", async () => {
  const { call } = build();
  const created = await call("workspace.scratchCreate", { name: "My work", state: { zoom: 2 } });
  assert.ok(created.scratch.id);
  const list = await call("workspace.scratchList", {});
  assert.equal(list.scratch.length, 1);
  const loaded = await call("workspace.scratchLoad", { id: created.scratch.id });
  assert.equal(loaded.scratch.name, "My work");
  const saved = await call("workspace.scratchSave", { id: created.scratch.id, state: { zoom: 3 } });
  assert.deepEqual(saved.scratch.state, { zoom: 3 });
  const deleted = await call("workspace.scratchDelete", { id: created.scratch.id });
  assert.equal(deleted.deleted, true);
  const after = await call("workspace.scratchList", {});
  assert.equal(after.scratch.length, 0);
});

test("the facts are really read out of the data that is here", async () => {
  const { call } = build();
  const usages = await call("facts.latestRunUsages", {});
  assert.ok(Array.isArray(usages.usages));
  const notifications = await call("facts.notifications", {});
  assert.ok(Array.isArray(notifications.notifications));
  const marked = await call("facts.markNodeDone", { canvasId: "c1", nodeId: "n1" });
  assert.equal(marked.ok, true);
});

test("the local extras are real: the worktree, the find and the provider usage", async () => {
  const { call } = build();
  const usage = await call("providerUsage.snapshot", {});
  assert.ok(Array.isArray(usage.providers));
  const found = await call("find.query", { query: "nothing" });
  assert.ok(Array.isArray(found.results));
  const repaired = await call("worktrees.repair", { cwd: os.tmpdir() });
  assert.equal(repaired.repaired, true);
});

// ---------------------------------------------------------------------------
// the hosted tier
// ---------------------------------------------------------------------------

test("the hosted tier exists and answers honestly", async () => {
  const { handlers, dispatch } = build();
  const hosted = handlers.filter((h) =>
    ["cloud.", "cloudAgents.", "compute.", "plan.", "codeSync.", "servers.", "analytics.", "share.", "hostedMessaging.", "agentConnections.", "liveblocks.", "multiplayer.", "simulator."].some((p) =>
      h.id.startsWith(p),
    ),
  );
  assert.ok(hosted.length > 60, `the hosted tier is ${hosted.length} methods`);
  for (const h of hosted) {
    const env = await dispatch(h.id, {});
    assert.equal(env.ok, false, `${h.id} must not pretend to work`);
    assert.equal(env.error.code, "not-implemented");
    assert.match(env.error.message, /hosted tier|local-first|analytics|simulator/);
  }
});
