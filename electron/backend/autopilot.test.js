"use strict";
// layer-1 tests for the Wave-3 autopilot handlers (docs/architecture/autopilot.md): the team of
// agents under one node.
//
// What is really exercised here:
//   - the plan validation (the rules) and the honest refusals;
//   - the REPOSITORY resolution against a REAL git repository (created in a
//     temp dir) — a non-repo is refused, a repo yields its root + HEAD sha;
//   - the member launch against a REAL process: the "harness" is a shell
//     script that prints the worker report, and the member's status
//     really follows the report;
//   - the persistence (the operations file really survives a reload).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const {
  makeAutopilotHandlers,
  parseTeamProposal,
  validateStart,
  parseWorkerReport,
  memberStatusForReport,
  readGate,
  writeGate,
  workingMembers,
  OPERATION_STATUSES,
  MEMBER_STATUSES,
  OPTIMIZE_VALUES,
  MAX_ACTIVE_SLOTS,
  WORKER_REPORT_STATES,
} = require("./autopilot.ts");

const DISPATCHABLE = manifest.bridge.namespaces.autopilot.filter((m) => !/^on[A-Z]/.test(m)); // 6

// ---------------------------------------------------------------------------
// a REAL git repository
// ---------------------------------------------------------------------------

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-autopilot-"));
  const { execFileSync } = require("node:child_process");
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString();
  git(["init", "-q"]);
  git(["config", "user.email", "test@autumn.local"]);
  git(["config", "user.name", "autumn test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# repo\n", "utf8");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

// ---------------------------------------------------------------------------
// deps
// ---------------------------------------------------------------------------

function build(overrides = {}) {
  const state = {
    emitted: [],
    ptys: new Map(), // nodeId -> {opts, chunks: []}
    killed: [],
    peers: [],
    resolved: [],
  };
  const deps = {
    pty: {
      createPty: (opts) => {
        state.ptys.set(opts.nodeId, { opts, chunks: [] });
        return true;
      },
      subscribePty: (nodeId, cb) => {
        const entry = state.ptys.get(nodeId);
        if (!entry) return () => {};
        entry.cb = cb;
        return () => {
          entry.cb = undefined;
        };
      },
      writePty: () => true,
      resizePty: () => {},
      killPty: (nodeId) => {
        state.killed.push(nodeId);
        state.ptys.delete(nodeId);
      },
      ptyExists: (nodeId) => state.ptys.has(nodeId),
      ptyKind: (nodeId) => (state.ptys.has(nodeId) ? "agent" : undefined),
      ptyCount: () => state.ptys.size,
      onPtyExit: () => () => {},
    },
    spawner: {
      runAgent: async () => ({ text: "" }),
      resolveAgentCommand: async (harness, task, ctx) => {
        state.resolved.push({ harness, task, ctx });
        if (harness === "missing") return null;
        return { command: "/bin/sh", args: ["-c", `echo "${task}"`], env: {} };
      },
      HARNESS_BIN: { codex: "codex", "claude-code": "claude" },
    },
    busStore: {
      ensurePeer: async (canvasId, nodeId, name) => {
        state.peers.push({ canvasId, nodeId, name });
      },
      setPeerStatus: async () => {},
      sendMessage: async () => ({ delivered: true, id: "m", ts: 1 }),
      drainInbox: async () => ({ injection: "", drained: 0 }),
      listPeers: async () => [],
      getPeer: async () => null,
    },
    git: () => {
      throw new Error("git is not available in this test");
    },
    db: {
      canvas: { findUnique: async () => null, findMany: async () => [], create: async (x) => x.data, update: async (x) => x.data, upsert: async () => ({}), delete: async () => ({}) },
      agentLog: { findMany: async () => [], createMany: async () => ({}), deleteMany: async () => ({}) },
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeAutopilotHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

/** A git dep that really shells out to git. */
function realGit() {
  const { execFileSync } = require("node:child_process");
  return (cwd) => ({
    raw: (args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString(),
  });
}

const PROPOSAL = {
  version: 1,
  kind: "team_proposal",
  objective: "ship the finder",
  optimize: "quality",
  agents: [
    { slotId: "s1", role: "builder", harness: "codex", candidateId: "cand-1" },
    { slotId: "s2", role: "reviewer", harness: "claude-code", candidateId: "cand-2" },
  ],
  assignments: [
    { slotId: "s1", task: "write the finder" },
    { slotId: "s2", task: "review the finder", dependsOn: ["s1"] },
  ],
  connections: [{ from: "s1", to: "s2" }],
};

const CANDIDATES = [{ candidateId: "cand-1" }, { candidateId: "cand-2" }];

beforeEach(() => {
  reg.reset();
  useTempUserData();
});

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

test("id surface: 6 autopilot ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 6);
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    DISPATCHABLE.map((m) => `autopilot.${m}`).sort(),
  );
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("the vocabularies are the contract's", () => {
  assert.deepEqual([...OPERATION_STATUSES], [
    "starting", "running", "stopping", "stopped", "completed", "failed", "interrupted",
  ]);
  assert.deepEqual([...MEMBER_STATUSES], [
    "queued", "isolating", "launching", "connecting", "needs-setup", "ready",
    "working", "needs-input", "stuck", "done", "failed", "stopped", "released",
  ]);
  assert.deepEqual([...OPTIMIZE_VALUES], ["speed", "cost", "quality", "balanced"]);
  assert.equal(MAX_ACTIVE_SLOTS, 20);
  assert.deepEqual([...WORKER_REPORT_STATES], ["checkpoint", "needs_input", "stuck", "done"]);
});

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------

test("parseTeamProposal is the team_proposal parser", () => {
  const ok = parseTeamProposal(PROPOSAL);
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.objective, "ship the finder");
  assert.equal(ok.proposal.optimize, "quality");
  assert.equal(ok.proposal.agents.length, 2);
  assert.equal(ok.proposal.assignments[1].dependsOn[0], "s1");
  assert.equal(ok.proposal.connections[0].from, "s1");
});

test("parseTeamProposal refuses a malformed plan", () => {
  assert.equal(parseTeamProposal(null).ok, false);
  assert.equal(parseTeamProposal({ version: 2, kind: "team_proposal" }).ok, false);
  assert.equal(parseTeamProposal({ version: 1, kind: "brief_request" }).ok, false);
  const dup = parseTeamProposal({
    ...PROPOSAL,
    agents: [PROPOSAL.agents[0], PROPOSAL.agents[0]],
  });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /duplicate/i);
  const noSlot = parseTeamProposal({
    ...PROPOSAL,
    assignments: [{ slotId: "nope", task: "x" }],
  });
  assert.equal(noSlot.ok, false);
  assert.match(noSlot.error, /unknown slot/);
});

test("validateStart is the candidate-binding check", () => {
  assert.match(validateStart({ canvasId: "no", candidates: CANDIDATES }), /canvas identity/i);
  assert.match(validateStart({ canvasId: 42, candidates: CANDIDATES }), /canvas identity/i);
  assert.match(validateStart({ canvasId: "canvas-1", candidates: [] }), /candidate binding/i);
  assert.match(
    validateStart({ canvasId: "canvas-1", candidates: [{ candidateId: "a" }, { candidateId: "a" }] }),
    /duplicate/i,
  );
  assert.match(
    validateStart({ canvasId: "canvas-1", candidates: [{ candidateId: "a", accountId: "bad id!" }] }),
    /account pointer/i,
  );
  assert.equal(validateStart({ canvasId: "canvas-1", candidates: CANDIDATES }), null);
});

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

test("start refuses a plan that is not a team proposal", async () => {
  const { call } = build();
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: { version: 1, kind: "ask", ask: "?" },
    candidates: CANDIDATES,
    repoRoot: os.tmpdir(),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /team proposal/i);
});

test("start refuses a directory that is not a Git repository", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-not-a-repo-"));
  const { call } = build({ git: realGit() });
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: dir,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /local Git repository/i);
});

test("start really resolves the repo, launches the members and persists the operation", async () => {
  const repo = makeRepo();
  const { call, state } = build({ git: realGit() });
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  assert.equal(res.ok, true);
  const op = res.operation;
  assert.match(op.id, /^operation-/);
  assert.equal(op.status, "running");
  assert.equal(op.repoRoot, fs.realpathSync(repo));
  assert.match(op.baseSha, /^[0-9a-f]{40}$/, "the real HEAD sha is captured");
  assert.equal(op.members.length, 2);
  assert.match(op.members[0].nodeId, /^opterm-/);
  assert.equal(op.members[0].canvasId, op.members[0].nodeId.slice(7));
  assert.equal(op.members[0].status, "working");
  assert.equal(op.members[0].task, "write the finder");

  // Every member really got an agent process.
  assert.equal(state.ptys.size, 2);
  for (const member of op.members) {
    const entry = state.ptys.get(member.nodeId);
    assert.ok(entry, `${member.nodeId} has a PTY`);
    assert.equal(entry.opts.dir, fs.realpathSync(repo), "the agent runs in the repo");
  }
  // The team really joined the canvas bus.
  assert.equal(state.peers.length, 2);

  // The operation really persisted.
  const file = path.join(require("./store.ts").userDataDir(), "autopilot-operations.json");
  assert.ok(fs.existsSync(file));
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.operations.length, 1);
  assert.equal(stored.operations[0].members.length, 2);

  // The change was really pushed.
  const push = state.emitted.find(([id]) => id === "autopilot.onChanged");
  assert.ok(push, "autopilot.onChanged is pushed");
  assert.equal(push[1].id, op.id);
});

test("a harness that is not installed leaves the member in needs-setup — honestly", async () => {
  const repo = makeRepo();
  const { call } = build({ git: realGit() });
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: { ...PROPOSAL, agents: [{ slotId: "s1", role: "builder", harness: "missing", candidateId: "cand-1" }], assignments: [{ slotId: "s1", task: "x" }] },
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  assert.equal(res.ok, true);
  assert.equal(res.operation.members[0].status, "needs-setup");
  assert.match(res.operation.members[0].error, /not installed/i);
});

test("only one team may run on a canvas", async () => {
  const repo = makeRepo();
  const { call } = build({ git: realGit() });
  const first = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  assert.equal(first.ok, true);
  const second = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  assert.equal(second.ok, false);
  assert.match(second.error, /Stop the current team/);
});

test("the gate is local and can be turned off", async () => {
  const repo = makeRepo();
  const { call } = build({ git: realGit() });
  writeGate({ enabled: false, operatorDisabled: true, message: "Team staffing is disabled." });
  assert.equal(readGate().enabled, false);
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /disabled/i);
  // And it is back on by default.
  fs.rmSync(path.join(require("./store.ts").userDataDir(), "db", "autopilot-gate.json"), { force: true });
  assert.equal(readGate().enabled, true);
});

// ---------------------------------------------------------------------------
// the worker report
// ---------------------------------------------------------------------------

test("the worker report is parsed with the vocabulary", () => {
  assert.deepEqual(parseWorkerReport("[worker status: done] all done"), {
    state: "done",
    text: "all done",
  });
  assert.deepEqual(parseWorkerReport("noise [worker status: needs input] which db?"), {
    state: "needs_input",
    text: "which db?",
  });
  assert.deepEqual(parseWorkerReport("[worker status: stuck] on a lock"), {
    state: "stuck",
    text: "on a lock",
  });
  assert.equal(parseWorkerReport("nothing here"), null);
  assert.equal(parseWorkerReport("[worker status: nonsense] x"), null, "an unknown state is not a report");
});

test("the member status follows the worker's own report", async () => {
  const repo = makeRepo();
  const { call, state } = build({ git: realGit() });
  const res = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: { ...PROPOSAL, agents: [{ slotId: "s1", role: "builder", harness: "codex", candidateId: "cand-1" }], assignments: [{ slotId: "s1", task: "x" }] },
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const member = res.operation.members[0];
  const entry = state.ptys.get(member.nodeId);
  assert.ok(entry.cb, "the member's output is observed");
  entry.cb("[worker status: checkpoint] half way\n");
  const snap = await call("autopilot.snapshot", { operationId: res.operation.id });
  assert.equal(snap.members[0].status, "working");
  assert.equal(snap.members[0].summary, "half way");
  entry.cb("[worker status: done] shipped\n");
  const snap2 = await call("autopilot.snapshot", { operationId: res.operation.id });
  assert.equal(snap2.members[0].status, "done");
  assert.equal(snap2.operation, undefined);
  assert.equal(snap2.status, "completed", "the team is complete when every member is done");
});

test("memberStatusForReport maps the report states", () => {
  assert.equal(memberStatusForReport("checkpoint"), "working");
  assert.equal(memberStatusForReport("needs_input"), "needs-input");
  assert.equal(memberStatusForReport("stuck"), "stuck");
  assert.equal(memberStatusForReport("done"), "done");
});

// ---------------------------------------------------------------------------
// stop / retry / release
// ---------------------------------------------------------------------------

test("stop really stops every member's process", async () => {
  const repo = makeRepo();
  const { call, state } = build({ git: realGit() });
  const started = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const res = await call("autopilot.stop", { operationId: started.operation.id });
  assert.equal(res.ok, true);
  assert.equal(res.operation.status, "stopped");
  assert.equal(state.killed.length, 2, "both agent processes are really stopped");
  for (const member of res.operation.members) assert.equal(member.status, "stopped");
});

test("stopping an unknown team is an honest error", async () => {
  const { call } = build();
  const res = await call("autopilot.stop", { operationId: "operation-nope" });
  assert.equal(res.ok, false);
  assert.match(res.error, /not found/i);
});

test("stopMember stops one member and leaves the rest working", async () => {
  const repo = makeRepo();
  const { call, state } = build({ git: realGit() });
  const started = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const target = started.operation.members[0].nodeId;
  const res = await call("autopilot.stopMember", { operationId: started.operation.id, nodeId: target });
  assert.equal(res.ok, true);
  assert.equal(res.operation.members[0].status, "stopped");
  assert.equal(res.operation.members[1].status, "working");
  assert.deepEqual(state.killed, [target], "only that member's process is stopped");
});

test("retryMember only retries a member that needs it", async () => {
  const repo = makeRepo();
  const { call } = build({ git: realGit() });
  const started = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: { ...PROPOSAL, agents: [{ slotId: "s1", role: "builder", harness: "missing", candidateId: "cand-1" }], assignments: [{ slotId: "s1", task: "x" }] },
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const nodeId = started.operation.members[0].nodeId;
  const res = await call("autopilot.retryMember", { operationId: started.operation.id, nodeId });
  assert.equal(res.ok, true);
  assert.equal(res.operation.members[0].status, "needs-setup", "the harness is still missing");
  // A healthy member does not need a retry.
  const busy = await call("autopilot.retryMember", { operationId: started.operation.id, nodeId: "ghost" });
  assert.equal(busy.ok, false);
});

test("releaseTerminal needs a stopped team and really frees the terminal", async () => {
  const repo = makeRepo();
  const { call, state } = build({ git: realGit() });
  const started = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const nodeId = started.operation.members[0].nodeId;
  const tooEarly = await call("autopilot.releaseTerminal", { operationId: started.operation.id, nodeId });
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.error, /Stop the team/);
  await call("autopilot.stop", { operationId: started.operation.id });
  const res = await call("autopilot.releaseTerminal", { operationId: started.operation.id, nodeId });
  assert.equal(res.ok, true);
  assert.equal(res.operation.members[0].status, "released");
  assert.ok(state.killed.includes(nodeId), "the released terminal's process is stopped");
  // Releasing twice is a no-op, not an error.
  const again = await call("autopilot.releaseTerminal", { operationId: started.operation.id, nodeId });
  assert.equal(again.ok, true);
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

test("snapshot returns null when there is no team", async () => {
  const { call } = build();
  assert.equal(await call("autopilot.snapshot", {}), null);
  assert.equal(await call("autopilot.snapshot", { operationId: "nope" }), null);
});

test("snapshot finds the newest team of a canvas", async () => {
  const repo = makeRepo();
  const { call } = build({ git: realGit() });
  const started = await call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const snap = await call("autopilot.snapshot", { canvasId: "canvas-1" });
  assert.equal(snap.id, started.operation.id);
  assert.equal(snap.objective, "ship the finder");
});

test("the operations really survive a reload of the backend", async () => {
  const repo = makeRepo();
  const first = build({ git: realGit() });
  const started = await first.call("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  // A fresh factory (as after an app restart) reads the file back.
  const second = build({ git: realGit() });
  const snap = await second.call("autopilot.snapshot", { operationId: started.operation.id });
  assert.ok(snap, "the operation is still there");
  assert.equal(snap.members.length, 2);
  assert.equal(snap.repoRoot, fs.realpathSync(repo));
});

test("workingMembers is the can-work filter", () => {
  const op = {
    members: [
      { status: "working" },
      { status: "done" },
      { status: "released" },
      { status: "failed" },
      { status: "needs-input" },
    ],
  };
  assert.equal(workingMembers(op).length, 2);
});

// ---------------------------------------------------------------------------
// registry level
// ---------------------------------------------------------------------------

test("registry-level: every autopilot id dispatch-resolves to an envelope", async () => {
  const repo = makeRepo();
  const { handlers, dispatch } = build({ git: realGit() });
  const started = await dispatch("autopilot.start", {
    canvasId: "canvas-1",
    proposal: PROPOSAL,
    candidates: CANDIDATES,
    repoRoot: repo,
  });
  const operationId = started.result.operation.id;
  for (const h of handlers) {
    const env = await dispatch(h.id, { operationId, nodeId: "opterm-x", canvasId: "canvas-1" });
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    assert.ok(!/^no handler for /.test(env.error?.message ?? ""), `${h.id}: ${env.error?.message}`);
  }
});
