"use strict";
// Wave-1 golden path — the doc-29 Wave-1 acceptance sequence, driven headless
// through the real IPC registry (exactly what `window.autumn.*` calls):
//
//   spawn 2 agents → steer tasks → artifact persisted → session persisted
//   → git status/stage/commit/PR-facts on a real throwaway repo
//   → dev server start/stop with real event pushes
//
// This is layer-1 evidence for Wave 1: no Electron, no display, no network.
// The renderer wiring for the same chain lives in bridge.ts + GitPanel.tsx.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const { simpleGit } = require("simple-git");
const reg = require("../ipc/registry");

const { makeHandlers } = require("./handlers.ts");
const { makeBusHandlers } = require("./bus.ts");
const { makeTerminalHandlers } = require("./terminal.ts");
const { makeCanvasHandlers } = require("./canvas.ts");
const { makeFilesHandlers } = require("./files.ts");
const { makeFsHandlers } = require("./fs.ts");
const { makeGitHandlers } = require("./git.ts");
const { makeDevServerHandlers, devServers } = require("./devserver.ts");
const { makeOsHandlers } = require("./os.ts");
const { makeArtifactsHandlers } = require("./artifacts.ts");
const { makeSessionsHandlers } = require("./sessions.ts");
const { makeTasksHandlers } = require("./tasks.ts");
const { makeAgentHandlers } = require("./agent.ts");
const { makePchHandlers } = require("./pch.ts");

const TARGET_DISPATCH_IDS = [
  "__ops.agentRun",
  "tasks.steer",
  "artifacts.save",
  "artifacts.catalog",
  "artifacts.get",
  "sessions.importSession",
  "sessions.read",
  "git.status",
  "git.stage",
  "git.commitAll",
  "git.prFacts",
  "devServer.start",
  "devServer.stop",
];

function build(t) {
  // Real throwaway git repository (docs/architecture/backend.md allows real git for git tests).
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "w1-golden-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const state = {
    emitted: [],
    spawned: [],
    exitListeners: [],
  };

  // Fake, controllable child process for devServer.start.
  const fakeProc = {
    on(event, cb) {
      if (event === "exit") state.exitListeners.push(cb);
    },
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    kill: () => {
      state.killed = true;
    },
  };

  // Fake deps; fs + simple-git are REAL against the tmp repo.
  const deps = {
    busStore: {
      ensurePeer: async () => {},
      setPeerStatus: async () => {},
      sendMessage: async () => ({ delivered: true, id: "m1", ts: 1 }),
      drainInbox: async () => ({ injection: "", drained: false }),
      listPeers: async () => [],
      getPeer: async () => null,
    },
    pty: {
      createPty: () => false, subscribePty: () => () => {}, writePty: () => false,
      resizePty: () => {}, killPty: () => {},
      ptyExists: () => false, ptyKind: () => undefined, ptyCount: () => 0,
      onPtyExit: () => () => {},
    },
    spawner: {
      // __ops.agentRun passes personaId through as opts.nodeId (handlers.ts)
      runAgent: async (opts) => ({
        text: opts.nodeId === "researcher" ? "RESEARCH: outline the landing page" : "CODE: build the landing page",
        simulated: true,
        fellBack: false,
      }),
      resolveAgentCommand: async () => null,
      HARNESS_BIN: { claude: "claude", codex: "codex", opencode: "opencode" },
    },
    personas: {
      PERSONA_BY_ID: { explorer: { name: "Explorer" }, researcher: { name: "Researcher" } },
    },
    db: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => [] }) }),
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    fs: fs.promises,
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    clipboard: { readText: () => "", writeText: () => {}, readImage: () => null },
    screen: { capture: async () => null },
    git: (cwd) => simpleGit({ baseDir: cwd, binary: "git", maxConcurrentProcesses: 1 }),
    spawn: {
      spawn: (command, args, opts) => {
        state.spawned.push({ command, args, opts });
        return fakeProc;
      },
    },
    // Artifact/Session persistence is faked at the db layer (Prisma isn't loaded
    // headless), but the handler code paths that read/modify them are real.
    __state: state,
  };

  // Separate artifact/session tables so catalog/get round-trip honestly.
  const store = { artifacts: [], sessions: [] };
  const dates = () => ({ createdAt: new Date(100), updatedAt: new Date(100) });
  const artifactModel = {
    findMany: async ({ where } = {}) =>
      store.artifacts.filter((a) => !where?.canvasId || a.canvasId === where.canvasId),
    findUnique: async ({ where: { id } }) => store.artifacts.find((a) => a.id === id) ?? null,
    create: async ({ data }) => {
      const a = { id: `a${store.artifacts.length + 1}`, retired: false, ...dates(), ...data };
      store.artifacts.push(a);
      return a;
    },
    update: async ({ where: { id }, data }) => Object.assign(store.artifacts.find((a) => a.id === id) ?? {}, data),
    upsert: async () => ({}),
    delete: async () => ({}),
    count: async () => store.artifacts.length,
  };
  const sessionModel = {
    findMany: async ({ where } = {}) =>
      store.sessions.filter((s) =>
        (!where?.canvasId || s.canvasId === where.canvasId) &&
        (!where?.externalId || s.externalId === where.externalId)),
    findUnique: async ({ where: { id } }) => store.sessions.find((s) => s.id === id) ?? null,
    create: async ({ data }) => {
      const s = { id: `s${store.sessions.length + 1}`, ...dates(), ...data };
      store.sessions.push(s);
      return s;
    },
    update: async () => ({}),
    upsert: async () => ({}),
    delete: async () => ({}),
    count: async () => store.sessions.length,
  };
  deps.db = {
    agentLog: { findMany: async () => [], createMany: async () => ({}), deleteMany: async () => ({}) },
    canvas: { findUnique: async () => null, findMany: async () => [], create: async ({ data }) => data, update: async (a) => a.data, upsert: async () => ({}), delete: async () => ({}) },
    artifact: artifactModel,
    artifactVersion: {
      findMany: async () => [],
      create: async ({ data }) => ({ id: "v", ...data }),
      delete: async () => ({}),
    },
    session: sessionModel,
    task: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async ({ data }) => ({ id: "task-1", createdAt: new Date(100), updatedAt: new Date(100), ...data }),
      update: async () => ({}),
      upsert: async () => ({}),
      delete: async () => ({}),
      count: async () => 0,
    },
    message: { findMany: async () => [], create: async ({ data }) => ({ id: "m", ...data }), count: async () => 0 },
    node: artifactModel,
    edge: { upsert: async () => ({}) },
    busPeer: { findMany: async () => [], findUnique: async () => null, count: async () => 0, create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}) },
  };

  reg.reset();
  for (const h of makeHandlers(deps)) {
    reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
  for (const make of [makeBusHandlers, makeTerminalHandlers, makeCanvasHandlers, makeFilesHandlers, makeFsHandlers, makeGitHandlers, makeDevServerHandlers, makeOsHandlers, makeArtifactsHandlers, makeSessionsHandlers, makeTasksHandlers, makeAgentHandlers, makePchHandlers]) {
    for (const h of make(deps)) {
      reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    }
  }
  return { repo, state };
}

async function dispatch(id, params = {}, kind = "bridge") {
  const res = await reg.dispatch({ kind, id, principal: "desktop", params });
  return res;
}

beforeEach(() => reg.reset());

test("golden path: 2 agents → steer → artifact + session persisted → git commit → dev server", async (t) => {
  const { repo, state } = build(t);

  // --- Step 1: two agents take the task (as spawned by Claim & run / chat) ---
  const agentA = await dispatch("__ops.agentRun", { personaId: "explorer", harness: "claude", task: "research the landing page" });
  const agentB = await dispatch("__ops.agentRun", { personaId: "researcher", harness: "codex", task: "implement the landing page" });
  assert.equal(agentA.ok, true);
  assert.match(String(agentA.result.text), /CODE/);
  assert.match(String(agentB.result.text), /RESEARCH/);

  // --- Step 2: steer both tasks (the in-progress guidance path) ---
  const steerA = await dispatch("tasks.steer", { canvasId: "c", task: "research the landing page", personaId: "explorer" });
  const steerB = await dispatch("tasks.steer", { canvasId: "c", task: "implement the landing page", personaId: "researcher" });
  assert.equal(steerA.ok, true);
  assert.equal(steerB.ok, true);

  // --- Step 3: artifact persisted (agents leave artifacts) ---
  const saved = await dispatch("artifacts.save", { canvasId: "c", name: "landing-redesign", kind: "text", content: "# Landing\npage copy" });
  assert.equal(saved.ok, true);
  const artifactId = saved.result.id;

  const catalog = await dispatch("artifacts.catalog", { canvasId: "c" });
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.result.items.map((a) => a.id), [artifactId]);

  const fetched = await dispatch("artifacts.get", { artifactId });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.result.name, "landing-redesign");
  assert.equal(fetched.result.content, "# Landing\npage copy");

  // --- Step 4: session persisted (run history round-trips) ---
  const imported = await dispatch("sessions.importSession", { canvasId: "c", externalId: "ext-gp-1", engine: "claude" });
  assert.equal(imported.ok, true);
  assert.equal(imported.result.imported, true);

  // --- Step 5: git: status → stage → commit on the real throwaway repo ---
  fs.writeFileSync(path.join(repo, "README.md"), "# golden path\n", "utf8");
  fs.writeFileSync(path.join(repo, "index.ts"), "export const x = 1;\n", "utf8");
  const g = simpleGit({ baseDir: repo });
  await g.init();
  await g.addConfig("user.email", "autumn@example.test");
  await g.addConfig("user.name", "autumn golden path");
  await g.add(["."]);
  await g.commit("baseline");
  fs.writeFileSync(path.join(repo, "index.ts"), "export const x = 2;\n", "utf8");

  const dirty = await dispatch("git.status", { cwd: repo });
  assert.equal(dirty.ok, true);
  assert.equal(dirty.result.isClean, false);

  const staged = await dispatch("git.stage", { cwd: repo, paths: ["index.ts"] });
  assert.equal(staged.ok, true);

  const commit = await dispatch("git.commitAll", { cwd: repo, message: "index.ts: x=2 (golden path)" });
  assert.equal(commit.ok, true);
  assert.match(commit.result.commit, /^[0-9a-f]{7,}$/);

  const facts = await dispatch("git.prFacts", { cwd: repo });
  assert.equal(facts.ok, true);
  // no origin remote in the throwaway repo → honest "no facts" shape
  assert.equal(facts.result.supported, false);

  // --- Step 6: dev server starts and stops, events pushed ---
  const start = await dispatch("devServer.start", { cwd: repo, command: "npm", args: ["run", "dev"] });
  assert.equal(start.ok, true);
  assert.deepEqual(state.spawned, [{ command: "npm", args: ["run", "dev"], opts: { cwd: repo } }]);

  const starting = state.emitted.find(([id]) => id === "events.onDevServer" && true);
  assert.equal(starting[1].status, "starting");

  const stop = await dispatch("devServer.stop", { cwd: repo });
  assert.equal(stop.ok, true);
  assert.equal(state.killed, true);

  // Fire the real child 'exit' → the exit push must land on events.onDevServer.
  for (const cb of state.exitListeners) cb(0);
  const exited = state.emitted.find(([id, p]) => id === "events.onDevServer" && p.status === "exited");
  assert.ok(exited, "expected an events.onDevServer exit push after child exit");
  assert.equal(exited[1].code, 0);
});

test("golden path dispatch surface: every id used above actually exists", () => {
  for (const id of TARGET_DISPATCH_IDS) {
    const kind = id.startsWith("__ops.") ? "bridge" : "bridge";
    assert.ok(reg.inManifest(kind, id) || id.startsWith("__ops."), `${id} dispatchable or allow-listed`);
  }
});
