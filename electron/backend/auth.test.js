"use strict";
// layer-1 tests for the auth bridge ids (docs/architecture/backend.md W2-4). Local-first scrypt auth,
// The shapes (12 dispatchable + auth.onChanged push). No network, no Electron.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");

const { makeAuthHandlers } = require("./auth.ts");

const DISPATCHABLE = [
  "auth.forgetSavedSignIn", "auth.localUser", "auth.networkRestored", "auth.oauthAction",
  "auth.resetPassword", "auth.resendConfirmation", "auth.signIn", "auth.signInWithOAuth",
  "auth.signOut", "auth.status", "auth.signUp", "auth.validate",
];

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    clipboard: { readText: () => state.clipboard ?? "", writeText: (t) => { state.clipboard = t; } },
    shell: { openExternal: async () => {}, openPath: async () => "", showItemInFolder: () => {} },
    ...overrides,
  };
  const handlers = makeAuthHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const register = () => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  };
  return { handlers, byId, call, register, state, deps };
}

beforeEach(() => {
  reg.reset();
  // drop module state (pending OAuth attempt) between tests
  for (const p of [require.resolve("./auth.ts")]) delete require.cache[p];
});

test("id surface: the 12 renderer-used auth ids, all in the manifest; onChanged is push-only", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 12);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...DISPATCHABLE].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
  assert.ok(reg.inManifest("bridge", "auth.onChanged")); // in target surface, but a subscription
});

test("signUp → user + needsConfirmation:false + 8 recovery codes; emits auth.onChanged(user)", async () => {
  const dir = useTempUserData();
  const { call, state } = build();
  const res = await call("auth.signUp", { email: "a@b.co", password: "password123", name: "Ada" });
  assert.equal(res.needsConfirmation, false);
  assert.equal(res.user.email, "a@b.co");
  assert.equal(res.user.name, "Ada");
  assert.ok(!("passHash" in res.user) && !("recoveryHashes" in res.user), "secrets must not leak");
  assert.equal(res.recoveryCodes.length, 8);
  for (const c of res.recoveryCodes) assert.match(c, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  const evt = state.emitted.find(([id]) => id === "auth.onChanged");
  assert.ok(evt, "auth.onChanged must fire on signUp");
  assert.equal(evt[1].email, "a@b.co");
  // persisted
  const users = JSON.parse(fs.readFileSync(path.join(dir, "db", "auth-users.json"), "utf8"));
  assert.equal(users.length, 1);
});

test("signUp duplicate email → {user:null, needsConfirmation:false, alreadyRegistered:true} (shape)", async () => {
  useTempUserData();
  const { call } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });
  const dup = await call("auth.signUp", { email: "A@B.CO", password: "differentpass" });
  assert.deepEqual(dup, { user: null, needsConfirmation: false, alreadyRegistered: true });
});

test("signUp validates password length (throws server-side min length)", async () => {
  useTempUserData();
  const { call } = build();
  await assert.rejects(() => call("auth.signUp", { email: "a@b.co", password: "short" }), /at least 8/);
  await assert.rejects(() => call("auth.signUp", { email: "not-an-email", password: "password123" }), /valid email/);
});

test("signIn: positional args (facade-packed), bad password throws the same error, good password → session", async () => {
  useTempUserData();
  const { call } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });

  // target renderer calls positionally: signIn(email, password)
  await assert.rejects(
    () => call("auth.signIn", { args: ["a@b.co", "wrong-password"] }),
    /Invalid email or password/,
  );

  const user = await call("auth.signIn", { args: ["a@b.co", "password123"] });
  assert.equal(user.email, "a@b.co");
  const status = await call("auth.status", {});
  assert.equal(status.email, "a@b.co");
  const v = await call("auth.validate", {});
  assert.deepEqual(v, { status: "valid", user });
  const lu = await call("auth.localUser", {});
  assert.equal(lu.id, user.id);
});

test("signOut deletes the current session → status null + onChanged(null)", async () => {
  useTempUserData();
  const { call, state } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });
  state.emitted.length = 0;
  await call("auth.signOut", {});
  assert.equal(await call("auth.status", {}), null);
  const evt = state.emitted.filter(([id]) => id === "auth.onChanged").pop();
  assert.ok(evt);
  assert.equal(evt[1], null, "onChanged payload is null on sign-out (renderer contract)");
});

test("validate without a session → {status:'invalid', user:null}", async () => {
  useTempUserData();
  const { call } = build();
  assert.deepEqual(await call("auth.validate", {}), { status: "invalid", user: null });
});

test("resetPassword two phases: issue code (local delivery) → complete with code", async () => {
  useTempUserData();
  const { call } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });

  // phase 1 — edge is resetPassword(email); autumn returns the code (no SMTP)
  const issued = await call("auth.resetPassword", "a@b.co"); // single positional string
  assert.equal(issued.delivered, "local");
  assert.match(issued.code, /^[0-9A-F]{4}-[0-9A-F]{4}$/);

  // phase 2 — wrong code rejected
  await assert.rejects(
    () => call("auth.resetPassword", { email: "a@b.co", code: "0000-0000", password: "brandnewpass1" }),
    /Invalid or expired/,
  );

  // phase 2 — correct code rotates the password and starts a session
  const done = await call("auth.resetPassword", { email: "a@b.co", code: issued.code, password: "brandnewpass1" });
  assert.equal(done.user.email, "a@b.co");
  await assert.rejects(() => call("auth.signIn", { email: "a@b.co", password: "password123" }), /Invalid email/);
  const back = await call("auth.signIn", { email: "a@b.co", password: "brandnewpass1" });
  assert.equal(back.email, "a@b.co");

  // codes are one-shot
  await assert.rejects(
    () => call("auth.resetPassword", { email: "a@b.co", code: issued.code, password: "anotherpass1" }),
    /Invalid or expired/,
  );
});

test("resetPassword phase 1 for unknown email throws (no account enumeration via fake send)", async () => {
  useTempUserData();
  const { call } = build();
  await assert.rejects(() => call("auth.resetPassword", "ghost@b.co"), /No account/);
});

test("resendConfirmation is honest local-first (no SMTP)", async () => {
  useTempUserData();
  const { call } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });
  const res = await call("auth.resendConfirmation", { args: ["a@b.co"] });
  assert.equal(res.delivered, "local");
  assert.match(res.note, /local-first|confirmed at sign-up/);
});

test("forgetSavedSignIn clears sessions → status null + onChanged(null)", async () => {
  useTempUserData();
  const { call, state } = build();
  await call("auth.signUp", { email: "a@b.co", password: "password123" });
  state.emitted.length = 0;
  await call("auth.forgetSavedSignIn", {});
  assert.equal(await call("auth.status", {}), null);
  assert.ok(state.emitted.some(([id, payload]) => id === "auth.onChanged" && payload === null));
});

test("signInWithOAuth without env → honest {supported:false} (never faked)", async () => {
  useTempUserData();
  const saved = { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET };
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  try {
    const { call } = build();
    const gh = await call("auth.signInWithOAuth", { provider: "github" });
    assert.equal(gh.supported, false);
    assert.match(gh.reason, /not configured/);
    const other = await call("auth.signInWithOAuth", { args: ["google"] });
    assert.equal(other.supported, false);
  } finally {
    if (saved.id !== undefined) process.env.GITHUB_CLIENT_ID = saved.id;
    if (saved.secret !== undefined) process.env.GITHUB_CLIENT_SECRET = saved.secret;
  }
});

test("oauthAction validates attempt + action (error strings)", async () => {
  useTempUserData();
  const { call } = build();
  await assert.rejects(() => call("auth.oauthAction", { attemptId: "x", action: "delete" }), /Invalid sign-in action/);
  await assert.rejects(() => call("auth.oauthAction", { args: ["no-such-attempt", "copy-link"] }), /no longer waiting/);
});

test("networkRestored returns {online:boolean} (real probe, side-effect superset)", async () => {
  useTempUserData();
  const { call } = build();
  const res = await call("auth.networkRestored", {});
  assert.equal(typeof res.online, "boolean");
});

test("registry dispatch round-trip wraps payloads", async () => {
  useTempUserData();
  const { register } = build();
  register();
  const no = await reg.dispatch({ id: "auth.status", params: {} });
  assert.equal(no.ok, true);
  assert.equal(no.result, null);
  const up = await reg.dispatch({ id: "auth.signUp", params: { email: "x@y.co", password: "password123" } });
  assert.equal(up.ok, true);
  assert.equal(up.result.user.email, "x@y.co");
  // schema gate: missing email → bad-params (never reaches the handler)
  const bad = await reg.dispatch({ id: "auth.signIn", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
