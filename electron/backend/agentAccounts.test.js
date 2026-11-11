"use strict";
// layer-1 tests for the agentAccounts bridge ids (doc 32 W2-4). RE-faithful
// (agent-accounts:* IPC family): PATH probe, profile-env spawn, attempt lifecycle,
// avatar int range, system-login cache. Fake spawn — no real CLIs, no Electron.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");

const { makeAgentAccountsHandlers, _resetAgentAccountsState } = require("./agentAccounts.ts");

const ALL_IDS = [
  "agentAccounts.abandonLogin", "agentAccounts.beginAdd", "agentAccounts.cancelPending",
  "agentAccounts.finalize", "agentAccounts.list", "agentAccounts.probe", "agentAccounts.reLogin",
  "agentAccounts.remove", "agentAccounts.rename", "agentAccounts.setAvatar", "agentAccounts.systemLogin",
];
// renderer-used subset (evidence/inventories/renderer-usage.md)
const RENDERER_USED = ["finalize", "list", "probe", "remove", "rename", "setAvatar"];

// ---------------------------------------------------------------------------
// fixtures: fake PATH with a `claude` binary, fake spawn with canned responses
// ---------------------------------------------------------------------------

let savedPath;

function makeFakeBin(t, name = "claude") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w2-aa-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  try {
    fs.chmodSync(bin, 0o755);
  } catch {
    /* windows: F_OK is enough */
  }
  savedPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + savedPath;
  // isolate profile-env assertions from the host environment
  const savedProfileEnv = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
  };
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CODEX_HOME;
  t.after(() => {
    process.env.PATH = savedPath;
    for (const [k, v] of Object.entries(savedProfileEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeEmptyPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w2-aa-empty-"));
  savedPath = process.env.PATH;
  process.env.PATH = dir;
  t.after(() => {
    process.env.PATH = savedPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Fake spawn: respond per-call from `script(call) -> {code,out,err}`; records calls. */
function makeSpawn(script) {
  const calls = [];
  const spawn = (cmd, args, opts = {}) => {
    const call = { cmd, args, opts };
    calls.push(call);
    const exitCbs = [];
    const errCbs = [];
    const outCbs = [];
    const errDataCbs = [];
    let emitted = false;
    const res = script(call) ?? { code: 0, out: "", err: "" };
    const emit = (code) => {
      if (emitted) return;
      emitted = true;
      setImmediate(() => {
        if (res.out) outCbs.forEach((cb) => cb(Buffer.from(res.out)));
        if (res.err) errDataCbs.forEach((cb) => cb(Buffer.from(res.err)));
        exitCbs.forEach((cb) => cb(code));
      });
    };
    setImmediate(() => emit(res.code));
    return {
      on: (ev, cb) => {
        if (ev === "exit") exitCbs.push(cb);
        if (ev === "error") errCbs.push(cb);
      },
      stdout: { on: (ev, cb) => ev === "data" && outCbs.push(cb) },
      stderr: { on: (ev, cb) => ev === "data" && errDataCbs.push(cb) },
      kill: () => emit(-1),
    };
  };
  spawn.calls = calls;
  return spawn;
}

const CLAUDE_LOGGED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "ada@example.com",
  orgName: "Example",
});
const CLAUDE_GATEWAY = JSON.stringify({ loggedIn: true, authMethod: "api-key", apiProvider: "bedrock" });

function build(spawn) {
  const deps = {
    emit: () => {},
    now: () => Date.now(),
    spawn: { spawn: spawn ?? makeSpawn(() => ({ code: 0, out: "", err: "" })) },
  };
  const handlers = makeAgentAccountsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const register = () => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  };
  return { handlers, byId, call, register };
}

beforeEach(() => {
  reg.reset();
  _resetAgentAccountsState();
});

// ---------------------------------------------------------------------------
// id surface
// ---------------------------------------------------------------------------

test("id surface: 11 agentAccounts ids (6 renderer-used + 5 dormant), all in the manifest", (t) => {
  useTempUserData(t);
  const { handlers } = build();
  assert.equal(handlers.length, 11);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...ALL_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
  for (const m of RENDERER_USED) assert.ok(reg.inManifest("bridge", `agentAccounts.${m}`));
});

// ---------------------------------------------------------------------------
// list / beginAdd
// ---------------------------------------------------------------------------

test("list is empty on a fresh profile", async (t) => {
  useTempUserData(t);
  const { call } = build();
  assert.deepEqual(await call("agentAccounts.list", {}), []);
});

test("beginAdd → cli-missing when the CLI is not on PATH (honest, no fake account)", async (t) => {
  useTempUserData(t);
  makeEmptyPath(t);
  const { call } = build();
  const res = await call("agentAccounts.beginAdd", { provider: "claude" });
  assert.deepEqual(res, { ok: false, reason: "cli-missing", provider: "claude" });
  assert.deepEqual(await call("agentAccounts.list", {}), []);
});

test("beginAdd unknown provider → unknown-provider", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const { call } = build();
  const res = await call("agentAccounts.beginAdd", { provider: "gemini" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unknown-provider");
});

test("beginAdd creates a pending account + attempt (RE: {ok,id,attemptId,terminalId})", async (t) => {
  const dir = useTempUserData(t);
  makeFakeBin(t);
  const { call } = build();
  const res = await call("agentAccounts.beginAdd", { args: ["claude"] }); // positional (RE)
  assert.equal(res.ok, true);
  assert.match(res.id, /^[a-f0-9-]{36}$/);
  assert.match(res.attemptId, /^[a-f0-9-]{36}$/);
  assert.equal(res.terminalId, `acct-setup-${res.attemptId}`); // RE setupTerminalId
  const rows = await call("agentAccounts.list", {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "pending");
  assert.equal(rows[0].provider, "claude");
  // codex profiles get a seeded config.toml (RE seedProfile) — claude does not
  assert.ok(!fs.existsSync(path.join(dir, "agent-accounts", "claude", res.id, "config.toml")));
});

test("second beginAdd while a login is in flight → login-in-progress (RE gate)", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const { call } = build();
  await call("agentAccounts.beginAdd", { provider: "claude" });
  const res = await call("agentAccounts.beginAdd", { provider: "claude" });
  assert.deepEqual(res, { ok: false, reason: "login-in-progress", provider: "claude" });
});

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

test("probe spawns the real CLI shape with profile env (CLAUDE_CONFIG_DIR + credential scrub)", async (t) => {
  const dir = useTempUserData(t);
  makeFakeBin(t);
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-secret-should-be-scrubbed";
  t.after(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });
  const spawn = makeSpawn(({ args }) =>
    args.includes("status") && args.includes("--json") ? { code: 0, out: CLAUDE_LOGGED_IN, err: "" } : { code: 1, out: "", err: "" },
  );
  const { call } = build(spawn);
  const begun = await call("agentAccounts.beginAdd", { provider: "claude" });

  const identity = await call("agentAccounts.probe", { id: begun.id });
  assert.equal(identity.loggedIn, true);
  assert.equal(identity.firstParty, true, "firstParty = authMethod claude.ai + apiProvider firstParty (RE)");
  assert.equal(identity.email, "ada@example.com");

  const call0 = spawn.calls[0];
  assert.deepEqual(call0.args, ["auth", "status", "--json"]); // RE probe args
  assert.equal(call0.opts.env.CLAUDE_CONFIG_DIR, path.join(dir, "agent-accounts", "claude", begun.id));
  assert.ok(!("ANTHROPIC_API_KEY" in call0.opts.env), "credential scrub must strip ANTHROPIC_API_KEY");

  // identity write-through into meta (RE cacheIdentity)
  const rows = await call("agentAccounts.list", {});
  assert.equal(rows[0].identity.email, "ada@example.com");
  assert.equal(typeof rows[0].identityProbedAt, "number");
});

test("probe: gateway login is NOT firstParty (RE anti-bedrock guard)", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_GATEWAY, err: "" }));
  const { call } = build(spawn);
  const begun = await call("agentAccounts.beginAdd", { provider: "claude" });
  const identity = await call("agentAccounts.probe", { id: begun.id });
  assert.equal(identity.loggedIn, true);
  assert.equal(identity.firstParty, false);
});

test("probe: unknown id or missing binary → {loggedIn:false,firstParty:false} (RE NO_IDENTITY)", async (t) => {
  useTempUserData(t);
  makeEmptyPath(t);
  const { call } = build();
  const ghost = "00000000-0000-4000-8000-000000000000";
  assert.deepEqual(await call("agentAccounts.probe", { id: ghost }), { loggedIn: false, firstParty: false });
  assert.deepEqual(await call("agentAccounts.probe", { args: [ghost] }), { loggedIn: false, firstParty: false });
});

// ---------------------------------------------------------------------------
// finalize / attempts
// ---------------------------------------------------------------------------

test("finalize happy path: attempt ownership + firstParty → state ready + unique label", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const begun = await call("agentAccounts.beginAdd", { provider: "claude" });

  const res = await call("agentAccounts.finalize", { args: [begun.id, begun.attemptId, "Ada"] }); // positional RE
  assert.equal(res.ok, true);
  assert.equal(res.account.state, "ready");
  assert.equal(res.account.label, "Ada");
  const rows = await call("agentAccounts.list", {});
  assert.equal(rows[0].state, "ready");
});

test("finalize without owning the attempt → login-attempt-ended", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const begun = await call("agentAccounts.beginAdd", { provider: "claude" });
  const res = await call("agentAccounts.finalize", { id: begun.id, attemptId: "00000000-0000-4000-8000-000000000000", label: "x" });
  assert.deepEqual(res, { ok: false, reason: "login-attempt-ended" });
});

test("finalize when not logged in → not-logged-in; gateway → not-a-subscription-login", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  {
    const spawn = makeSpawn(() => ({ code: 1, out: "", err: "no session" }));
    const { call } = build(spawn);
    const begun = await call("agentAccounts.beginAdd", { provider: "claude" });
    const res = await call("agentAccounts.finalize", { id: begun.id, attemptId: begun.attemptId, label: "x" });
    assert.deepEqual(res, { ok: false, reason: "not-logged-in" });
  }
  _resetAgentAccountsState();
  {
    const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_GATEWAY, err: "" }));
    const { call } = build(spawn);
    const begun = await call("agentAccounts.beginAdd", { provider: "claude" });
    const res = await call("agentAccounts.finalize", { id: begun.id, attemptId: begun.attemptId, label: "x" });
    assert.deepEqual(res, { ok: false, reason: "not-a-subscription-login" });
  }
});

test("finalize twice → second loses the attempt (released)", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const begun = await call("agentAccounts.beginAdd", { provider: "claude" });
  const first = await call("agentAccounts.finalize", { id: begun.id, attemptId: begun.attemptId, label: "Ada" });
  assert.equal(first.ok, true);
  const second = await call("agentAccounts.finalize", { id: begun.id, attemptId: begun.attemptId, label: "Ada" });
  assert.deepEqual(second, { ok: false, reason: "login-attempt-ended" });
});

// ---------------------------------------------------------------------------
// rename / avatar / remove / cancel / abandon / reLogin / systemLogin
// ---------------------------------------------------------------------------

test("rename: unique label per provider (RE uniqueLabel), unknown id → reason", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });
  // free the per-provider login gate so a second claude account can begin
  await call("agentAccounts.abandonLogin", { id: a.id, attemptId: a.attemptId });
  const b = await call("agentAccounts.beginAdd", { provider: "claude" });
  assert.equal(b.ok, true);
  const r1 = await call("agentAccounts.rename", { args: [a.id, "Work"] });
  assert.equal(r1.ok, true);
  assert.equal(r1.account.label, "Work");
  const r2 = await call("agentAccounts.rename", { id: b.id, label: "Work" });
  assert.equal(r2.account.label, "Work (2)", "duplicate labels get a numeric suffix");
  const ghost = await call("agentAccounts.rename", { id: "00000000-0000-4000-8000-000000000000", label: "x" });
  assert.deepEqual(ghost, { ok: false, reason: "unknown-account" });
});

test("setAvatar: integer 20..44 only (RE ACCOUNT_AVATAR_MIN/MAX), stored in meta", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const { call } = build();
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });
  const ok = await call("agentAccounts.setAvatar", { args: [a.id, 32] });
  assert.equal(ok.ok, true);
  assert.equal(ok.account.avatar, 32);
  for (const bad of [19, 45, 3.5, "20"]) {
    const res = await call("agentAccounts.setAvatar", { id: a.id, avatar: bad });
    assert.deepEqual(res, { ok: false, reason: "invalid-avatar" }, `avatar ${JSON.stringify(bad)} must be rejected`);
  }
  const ghost = await call("agentAccounts.setAvatar", { id: "00000000-0000-4000-8000-000000000000", avatar: 20 });
  assert.deepEqual(ghost, { ok: false, reason: "unknown-account" });
  const rows = await call("agentAccounts.list", {});
  assert.equal(rows[0].avatar, 32);
});

test("cancelPending: logout + delete profile + release attempt", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: "", err: "" }));
  const { call } = build(spawn);
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });
  await call("agentAccounts.cancelPending", { id: a.id, attemptId: a.attemptId });
  assert.deepEqual(await call("agentAccounts.list", {}), [], "cancelled pending account is gone");
  assert.ok(spawn.calls.some((c) => c.args.join(" ") === "auth logout"), "logout runs before deletion");
  // double-cancel is a no-op
  assert.equal(await call("agentAccounts.cancelPending", { id: a.id, attemptId: a.attemptId }), null);
});

test("abandonLogin releases the attempt → finalize later fails with login-attempt-ended", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });
  assert.equal(await call("agentAccounts.abandonLogin", { args: [a.id, a.attemptId] }), null);
  const res = await call("agentAccounts.finalize", { id: a.id, attemptId: a.attemptId, label: "x" });
  assert.deepEqual(res, { ok: false, reason: "login-attempt-ended" });
});

test("reLogin opens a fresh attempt for a ready account; unknown → unknown-account", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });
  await call("agentAccounts.finalize", { id: a.id, attemptId: a.attemptId, label: "Ada" });
  const re = await call("agentAccounts.reLogin", { id: a.id });
  assert.equal(re.ok, true);
  assert.equal(re.terminalId, `acct-setup-${re.attemptId}`);
  assert.notEqual(re.attemptId, a.attemptId, "a NEW attempt id is issued");
  const ghost = await call("agentAccounts.reLogin", { id: "00000000-0000-4000-8000-000000000000" });
  assert.deepEqual(ghost, { ok: false, reason: "unknown-account" });
});

test("remove: in-use guard, logout, delete; unknown id is idempotent {ok:true}", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: "", err: "" }));
  const { call } = build(spawn);
  const a = await call("agentAccounts.beginAdd", { provider: "claude" });

  const busy = await call("agentAccounts.remove", { id: a.id, usedBy: ["node-1"] });
  assert.deepEqual(busy, { ok: false, reason: "in-use", terminalIds: ["node-1"] });

  const done = await call("agentAccounts.remove", { args: [a.id] }); // positional (RE)
  assert.deepEqual(done, { ok: true });
  assert.deepEqual(await call("agentAccounts.list", {}), []);
  assert.ok(spawn.calls.some((c) => c.args.join(" ") === "auth logout"));

  const again = await call("agentAccounts.remove", { id: a.id });
  assert.deepEqual(again, { ok: true }, "removing an unknown id is idempotent (RE)");
});

test("systemLogin: claude|codex only, 5min cache (no re-spawn without refresh)", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const spawn = makeSpawn(() => ({ code: 0, out: CLAUDE_LOGGED_IN, err: "" }));
  const { call } = build(spawn);

  assert.equal(await call("agentAccounts.systemLogin", { provider: "gemini" }), null, "RE returns null for non claude/codex");

  const first = await call("agentAccounts.systemLogin", { args: ["claude"] });
  assert.equal(first.loggedIn, true);
  const sysCall = spawn.calls[0];
  assert.ok(!("CLAUDE_CONFIG_DIR" in sysCall.opts.env), "system probe uses the plain env, not a profile");
  assert.equal(spawn.calls.length, 1);

  const cached = await call("agentAccounts.systemLogin", { provider: "claude" });
  assert.deepEqual(cached, first);
  assert.equal(spawn.calls.length, 1, "cached within SYSTEM_LOGIN_TTL_MS");

  await call("agentAccounts.systemLogin", { provider: "claude", refresh: true });
  assert.equal(spawn.calls.length, 2, "refresh bypasses the cache");
});

test("registry dispatch round-trip wraps payloads", async (t) => {
  useTempUserData(t);
  makeFakeBin(t);
  const { register } = build();
  register();
  const list = await reg.dispatch({ id: "agentAccounts.list", params: {} });
  assert.equal(list.ok, true);
  assert.deepEqual(list.result, []);
  const missing = await reg.dispatch({ id: "agentAccounts.probe", params: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "bad-params");
});
