"use strict";
// Wave-1 layer-1 tests for the git + worktrees bridge ids (docs/architecture/ipc-facade.md, docs/architecture/backend.md).
// REAL git against throwaway repositories under fs.mkdtemp (allowed by docs/architecture/backend.md);
// git binary must be present (2.53 in this environment). No network, no GitHub.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const { simpleGit } = require("simple-git");
const { makeGitHandlers } = require("./git.ts");

const EXPECTED_IDS = [
  "git.status", "git.changes", "git.taskChanges", "git.stage", "git.discard",
  "git.commitAll", "git.push", "git.initializeEmpty", "git.openPr", "git.prFacts",
  "worktrees.list", "worktrees.prepare", "worktrees.resolve", "worktrees.derive",
  "worktrees.preview", "worktrees.matchFolder", "worktrees.reconcileRemoval",
  "worktrees.drop", "worktrees.autoLand",
];

function mkTmp(t, prefix = "w1-git-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function initRepo(t, dir) {
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n", "utf8");
  const g = simpleGit({ baseDir: dir });
  await g.init();
  // Keep checkouts byte-stable on Windows (LF, not CRLF) so content assertions hold.
  await g.addConfig("core.autocrlf", "false");
  await g.addConfig("user.email", "autumn@example.test");
  await g.addConfig("user.name", "autumn tests");
  await g.add(["."]);
  await g.commit("initial");
  return g;
}

/** Build handlers; `shell`/`emit` are fakes, `git` is the REAL simple-git. */
function build(overrides = {}) {
  const state = { emitted: [], opened: [], calls: [] };
  const deps = {
    git: (cwd) =>
      simpleGit({ baseDir: cwd, binary: "git", maxConcurrentProcesses: 1 }),
    shell: {
      openPath: async () => "",
      showItemInFolder: () => {},
      openExternal: async (url) => {
        state.opened.push(url);
      },
      ...(overrides.shell || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeGitHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

const reg = require("../ipc/registry");

test("id surface: exactly the 19 renderer-used git/worktrees ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 19);
  assert.deepEqual(
    [...handlers.map((h) => h.id)].sort(),
    [...EXPECTED_IDS].sort(),
  );
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
    assert.match(h.description, /params:/, `${h.id} description must document params`);
  }
});

test("handlers reject a relative cwd with bad-params and never touch git", async (t) => {
  const { call } = build();
  for (const id of ["git.status", "git.changes", "git.taskChanges", "git.stage", "git.discard",
    "git.commitAll", "git.push", "git.initializeEmpty", "git.openPr", "git.prFacts",
    "worktrees.list", "worktrees.prepare", "worktrees.resolve", "worktrees.derive",
    "worktrees.preview", "worktrees.matchFolder", "worktrees.reconcileRemoval",
    "worktrees.drop", "worktrees.autoLand"]) {
    const params = { cwd: "relative/path", path: "relative/path", folder: "relative/path" };
    const res = await call(id, params);
    assert.equal(res.ok, false, id);
    assert.equal(res.error.code, "bad-params", id);
  }
});

test("git.status / changes / taskChanges reflect a real working tree", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const { call } = build();

  const clean = await call("git.status", { cwd: repo });
  assert.equal(clean.isClean, true);
  assert.equal(clean.ahead, 0);

  fs.writeFileSync(path.join(repo, "README.md"), "# changed\nline two\n", "utf8");
  const dirty = await call("git.status", { cwd: repo });
  assert.equal(dirty.isClean, false);
  assert.deepEqual([...dirty.modified], ["README.md"]);

  const changes = await call("git.changes", { cwd: repo });
  assert.equal(changes.changed, 1);
  assert.deepEqual(changes.modified ?? changes.unstaged, ["README.md"]);
  assert.equal(typeof changes.insertions, "number");

  const task = await call("git.taskChanges", { cwd: repo, task: "t1" });
  assert.equal(task.task, "t1");
  assert.equal(task.changed, 1);
});

test("git.stage stages specific paths and everything; git.discard restores tracked paths", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n", "utf8");
  const { call } = build();

  const one = await call("git.stage", { cwd: repo, paths: ["a.txt"] });
  assert.deepEqual(one.staged, ["a.txt"]);
  const all = await call("git.stage", { cwd: repo });
  assert.equal(all.staged, "all");

  // discard must restore tracked content even when it was staged
  fs.writeFileSync(path.join(repo, "README.md"), "junk\n", "utf8");
  await call("git.stage", { cwd: repo, paths: ["README.md"] });
  await call("git.discard", { cwd: repo, paths: ["README.md"] });
  assert.equal(
    fs.readFileSync(path.join(repo, "README.md"), "utf8"),
    "# test\n",
  );
});

test("git.commitAll commits real changes and refuses an empty tree", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const { call } = build();

  const empty = await call("git.commitAll", { cwd: repo, message: "nothing" });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "handler-error");

  fs.writeFileSync(path.join(repo, "b.txt"), "b\n", "utf8");
  const res = await call("git.commitAll", { cwd: repo, message: "add b" });
  assert.equal(res.ok, true);
  assert.match(res.commit, /^[0-9a-f]{7,}$/);
});

test("git.push pushes to a real bare remote; missing remote is handler-error", async (t) => {
  const repo = mkTmp(t);
  const remote = mkTmp(t, "w1-git-remote-");
  await initRepo(t, repo);
  fs.writeFileSync(path.join(remote, "placeholder"), "x");
  fs.rmSync(path.join(remote, "placeholder"));
  const bare = simpleGit({ baseDir: remote });
  await bare.init(["--bare"]);
  const g = simpleGit({ baseDir: repo });
  await g.addRemote("origin", remote);

  const { call } = build();
  const res = await call("git.push", { cwd: repo });
  assert.equal(res.ok, true);
  assert.equal(res.remote, "origin");

  const noRemote = mkTmp(t);
  await initRepo(t, noRemote);
  const fail = await call("git.push", { cwd: noRemote });
  assert.equal(fail.ok, false);
  assert.equal(fail.error.code, "handler-error");
});

test("git.initializeEmpty creates a repo and is idempotent", async (t) => {
  const dir = mkTmp(t);
  const { call } = build();
  const created = await call("git.initializeEmpty", { cwd: dir });
  assert.deepEqual(created, { ok: true, initialized: true, already: false });
  const again = await call("git.initializeEmpty", { cwd: dir });
  assert.deepEqual(again, { ok: true, initialized: false, already: true });
});

test("git.openPr opens a GitHub compare URL for origin=github.com; not-found without one", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const g = simpleGit({ baseDir: repo });
  await g.addRemote("origin", "https://github.com/acme/widget.git");

  const { call, state } = build();
  const res = await call("git.openPr", { cwd: repo, base: "main" });
  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/github\.com\/acme\/widget\/compare\/main\.\.\./);
  assert.deepEqual(state.opened, [res.url]);

  const bare = mkTmp(t);
  await initRepo(t, bare);
  const noRemote = await call("git.openPr", { cwd: bare, base: "main" });
  assert.equal(noRemote.ok, false);
  assert.equal(noRemote.error.code, "not-found");
});

test("git.prFacts returns parsed remote facts; no remote -> supported:false", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const g = simpleGit({ baseDir: repo });
  await g.addRemote("origin", "git@github.com:acme/widget.git");
  const { call } = build();

  const res = await call("git.prFacts", { cwd: repo, base: "main" });
  assert.equal(res.supported, true);
  assert.equal(res.owner, "acme");
  assert.equal(res.repo, "widget");
  assert.equal(res.github, true);
  assert.match(res.compareUrl, /compare\/main\.\.\./);

  const none = mkTmp(t);
  await initRepo(t, none);
  const empty = await call("git.prFacts", { cwd: none });
  assert.equal(empty.supported, false);
});

test("not-a-repo for an existing absolute cwd -> not-found", async (t) => {
  const plain = mkTmp(t);
  const { call } = build();
  const res = await call("git.status", { cwd: plain });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "not-found");
});

// Git for Windows may print forward-slash paths, and the FS is case-insensitive;
// compare normalized, lower-cased paths.
const samePath = (a, b) =>
  path.normalize(String(a)).toLowerCase() === path.normalize(String(b)).toLowerCase();

test("worktrees.prepare/list/resolve/matchFolder/drop round-trip", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const wt = path.join(path.dirname(repo), path.basename(repo) + "-wt");
  const { call } = build();

  const prepare = await call("worktrees.prepare", { cwd: repo, path: wt });
  assert.equal(prepare.ok, true);
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));

  const list = await call("worktrees.list", { cwd: repo });
  assert.ok(list.items.some((i) => samePath(i.path, wt)), "worktree listed");

  const resolve = await call("worktrees.resolve", { cwd: wt });
  assert.equal(resolve.inWorktree, true);
  assert.ok(samePath(resolve.path, wt));

  const matched = await call("worktrees.matchFolder", { cwd: repo, folder: path.join(wt, ".") });
  assert.equal(matched.match, true);
  assert.ok(samePath(matched.path, wt));

  const noMatch = await call("worktrees.matchFolder", { cwd: repo, folder: repo + "-nowhere" });
  assert.equal(noMatch.match, false);

  const drop = await call("worktrees.drop", { cwd: repo, path: wt });
  assert.equal(drop.ok, true);
  const after = await call("worktrees.list", { cwd: repo });
  assert.ok(!after.items.some((i) => samePath(i.path, wt)), "worktree dropped");
});

test("worktrees.derive is a pure derivation (nothing is created)", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const { call } = build();
  const res = await call("worktrees.derive", { cwd: repo, name: "fork-1" });
  assert.equal(res.path, path.join(path.dirname(repo), path.basename(repo) + "-fork-1"));
  assert.equal(fs.existsSync(res.path), false);
  const bad = await call("worktrees.derive", { cwd: repo, name: "a/b" });
  assert.equal(bad.error.code, "bad-params");
});

test("worktrees.preview reports dirty state from the real status", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const { call } = build();
  const clean = await call("worktrees.preview", { cwd: repo });
  assert.equal(clean.dirty, false);
  fs.writeFileSync(path.join(repo, "README.md"), "dirty\n", "utf8");
  const dirty = await call("worktrees.preview", { cwd: repo });
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.changed, 1);
});

test("worktrees.reconcileRemoval removes and prunes a real worktree", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const wt = path.join(path.dirname(repo), path.basename(repo) + "-reconcile");
  const { call } = build();
  await call("worktrees.prepare", { cwd: repo, path: wt });
  const res = await call("worktrees.reconcileRemoval", { cwd: repo, path: wt, force: true });
  assert.deepEqual(res, { ok: true, removed: true });
});

test("worktrees.autoLand is honestly not-implemented (no fake merge)", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  const { call } = build();
  const res = await call("worktrees.autoLand", { cwd: repo });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "not-implemented");
});

test("registry dispatch round-trip wraps plain payloads and passes envelopes through", async (t) => {
  const repo = mkTmp(t);
  await initRepo(t, repo);
  reg.reset();
  const handlers = makeGitHandlers({
    git: (cwd) => simpleGit({ baseDir: cwd }),
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "git.status", params: { cwd: repo } });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.isClean, true);
  const bad = await reg.dispatch({ id: "git.status", params: { cwd: "relative" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  reg.reset();
});
