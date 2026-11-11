"use strict";
// layer-1 tests for the phone bridge ids (doc 32 W2-5 §2g). 12 dispatchable +
// phone.onChanged push. Local pairing registry: ed25519 identity, 6-digit
// one-time codes (sha256 stored, plaintext never persisted), RE error strings
// for decide, idempotent revoke, confirm-gated identity reset. The WebSocket
// RELAY is the W2-10 milestone — status must report honest
// relay:{running:false, reason} until then.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData, dbPath } = require("./store.ts");

const { makePhoneHandlers, _queueIntent, _identityFilesExist } = require("./phone.ts");

const DISPATCHABLE = manifest.bridge.namespaces.phone.filter((m) => !/^on[A-Z]/.test(m)); // 12

function build(overrides = {}) {
  const state = { emitted: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makePhoneHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  const emits = (id) => state.emitted.filter(([e]) => e === id);
  return { handlers, byId, call, dispatch, state, emits, deps };
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./phone.ts")]) delete require.cache[p];
});

test("id surface: 12 dispatchable phone ids; onChanged is in the manifest but push-only", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 12);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `phone.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
  assert.ok(reg.inManifest("bridge", "phone.onChanged"));
  assert.ok(!handlers.some((h) => h.id === "phone.onChanged"), "onChanged must stay a subscription");
});

test("status: honest initial state with the deferred relay report", async () => {
  useTempUserData();
  const { call } = build();
  const s = await call("phone.status", {});
  assert.deepEqual(Object.keys(s).sort(), ["enabled", "paired", "port", "relay"]);
  assert.equal(s.enabled, false);
  assert.equal(s.port, null);
  assert.equal(s.paired, 0);
  assert.equal(s.relay.running, false, "no listener until W2-10 — never claim a port we don't hold");
  assert.match(s.relay.reason, /W2-10/);
});

test("enable: generates a real ed25519 identity once and emits onChanged only on the transition", async () => {
  const dir = useTempUserData();
  const { call, emits } = build();
  const first = await call("phone.enable", {});
  assert.equal(first.enabled, true);
  assert.ok(first.since, "since recorded on enable");
  assert.deepEqual(_identityFilesExist(), { priv: true, pub: true }, "keypair really written");
  assert.ok(fs.existsSync(path.join(dir, "phone", "identity-key.pem")));
  const keyText = fs.readFileSync(path.join(dir, "phone", "identity-key.pem"), "utf8");
  assert.match(keyText, /BEGIN PRIVATE KEY/);
  assert.equal(emits("phone.onChanged").length, 1);

  await call("phone.enable", {});
  assert.equal(emits("phone.onChanged").length, 1, "no second emit without a real transition");
});

test("disable: real transition + emit; idempotent disable does not re-emit", async () => {
  useTempUserData();
  const { call, emits } = build();
  await call("phone.enable", {});
  const off = await call("phone.disable", {});
  assert.equal(off.enabled, false);
  assert.equal(emits("phone.onChanged").length, 2);
  await call("phone.disable", {});
  assert.equal(emits("phone.onChanged").length, 2, "already-disabled → no emit");
});

test("createPairing: auto-enables, returns a 6-digit code with 10-min expiry, persists ONLY the sha256", async () => {
  useTempUserData();
  const { call, emits } = build();
  const before = Date.now();
  const res = await call("phone.createPairing", { label: "Ada's phone" });
  assert.match(res.code, /^\d{6}$/);
  assert.ok(res.expiresAt >= before + 9 * 60 * 1000 && res.expiresAt <= Date.now() + 10 * 60 * 1000 + 1000);
  assert.equal(res.label, "Ada's phone");

  const state = JSON.parse(fs.readFileSync(dbPath("phone.json"), "utf8"));
  assert.equal(state.enabled, true, "createPairing auto-enables (RE)");
  const codeHash = createHash("sha256").update(res.code).digest("hex");
  assert.ok(state.codes.some((c) => c.codeHash === codeHash), "sha256 of the code is stored");
  assert.ok(!JSON.stringify(state.codes).includes(res.code), "plaintext code must never be written");
  assert.ok(emits("phone.onChanged").length >= 1, "auto-enable is a real transition");
});

test("pending: lists unexpired intents, drops expired ones", async () => {
  useTempUserData();
  const { call } = build();
  _queueIntent({ id: "i-live", label: "Live", ttlMs: 60_000 });
  _queueIntent({ id: "i-dead", label: "Dead", ttlMs: -1000 });
  const pending = await call("phone.pending", {});
  assert.deepEqual(pending.map((i) => i.id), ["i-live"]);
});

test("decide: RE validation messages + approve moves the intent into devices (with emit)", async () => {
  useTempUserData();
  const { call, emits } = build();
  await call("phone.enable", {});

  const intent = _queueIntent({ id: "i-1", label: "Pixel" });

  const badDecision = await call("phone.decide", { intentId: "i-1", decision: "maybe" });
  assert.equal(badDecision.ok, false);
  assert.equal(badDecision.error.code, "bad-params");
  assert.match(badDecision.error.message, /Invalid pairing decision\./);

  const gone = await call("phone.decide", { intentId: "i-ghost", decision: "approve" });
  assert.equal(gone.ok, false);
  assert.equal(gone.error.code, "not-found");

  const approved = await call("phone.decide", { intentId: "i-1", decision: "approve" });
  assert.equal(approved.approved, true);
  assert.equal(approved.device.label, "Pixel");
  assert.ok(approved.device.id.startsWith("dev-"));
  assert.equal((await call("phone.devices", {})).length, 1);
  assert.deepEqual(await call("phone.pending", {}), []);
  const afterApprove = emits("phone.onChanged").length;

  const denyIntent = _queueIntent({ id: "i-2", label: "Tablet" });
  const denied = await call("phone.decide", { intentId: denyIntent.id, decision: "deny" });
  assert.equal(denied.denied, true);
  assert.equal((await call("phone.devices", {})).length, 1, "deny must not create a device");
  assert.ok(emits("phone.onChanged").length > afterApprove, "deny is a real registry change");
});

test("decide: positional (intentId, decision) facade shape works", async () => {
  useTempUserData();
  const { call } = build();
  await call("phone.enable", {});
  _queueIntent({ id: "i-pos", label: "Pos" });
  const res = await call("phone.decide", { args: ["i-pos", "approve"] });
  assert.equal(res.approved, true, "positional decision must not be mistaken for intentId");
});

test("decide while pairing is off → RE handler-error 'Phone access is not enabled.'", async () => {
  useTempUserData();
  const { call } = build();
  _queueIntent({ id: "i-x", label: "X" });
  const res = await call("phone.decide", { intentId: "i-x", decision: "approve" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "handler-error");
  assert.match(res.error.message, /Phone access is not enabled\./);
});

test("revoke: idempotent — real removal emits, unknown id answers revoked:false without emitting", async () => {
  useTempUserData();
  const { call, emits } = build();
  await call("phone.enable", {});
  _queueIntent({ id: "i-r", label: "R" });
  await call("phone.decide", { intentId: "i-r", decision: "approve" });
  const device = (await call("phone.devices", {}))[0];
  const count = emits("phone.onChanged").length;

  const miss = await call("phone.revoke", { id: "dev-nope" });
  assert.deepEqual(miss, { revoked: false, paired: 1 });
  assert.equal(emits("phone.onChanged").length, count, "no-op must not emit");

  const hit = await call("phone.revoke", device.id);
  assert.equal(hit.revoked, true);
  assert.equal(hit.paired, 0);
  assert.equal(emits("phone.onChanged").length, count + 1);
});

test("keepAwake: RE boolean validation; headless answers {applied:false, reason}", async () => {
  useTempUserData();
  const { call } = build();
  const bad = await call("phone.keepAwake", "on");
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.match(bad.error.message, /enabled must be boolean/);

  const on = await call("phone.keepAwake", true);
  assert.equal(on.enabled, true);
  assert.equal(on.applied, false, "powerSaveBlocker needs Electron — honest");
  assert.ok(on.reason);
});

test("connectedApps starts empty; disconnectApp is idempotent", async () => {
  useTempUserData();
  const { call, emits } = build();
  assert.deepEqual(await call("phone.connectedApps", {}), []);
  const res = await call("phone.disconnectApp", { id: "app-x" });
  assert.deepEqual(res, { disconnected: false });
  assert.equal(emits("phone.onChanged").length, 0);
});

test("resetIdentity: confirm required; wipes keys/devices/state, disables, emits once", async () => {
  useTempUserData();
  const { call, emits } = build();
  await call("phone.enable", {});
  _queueIntent({ id: "i-z", label: "Z" });
  await call("phone.decide", { intentId: "i-z", decision: "approve" });
  assert.equal(_identityFilesExist().priv, true);

  const noConfirm = await call("phone.resetIdentity", {});
  assert.equal(noConfirm.ok, false);
  assert.equal(noConfirm.error.code, "bad-params");
  assert.equal(_identityFilesExist().priv, true, "refused reset must not touch the keys");

  const count = emits("phone.onChanged").length;
  const reset = await call("phone.resetIdentity", { confirm: true });
  assert.equal(reset.reset, true);
  assert.equal(reset.removedDevices, 1);
  assert.deepEqual(_identityFilesExist(), { priv: false, pub: false });
  assert.equal((await call("phone.status", {})).enabled, false);
  assert.deepEqual(await call("phone.devices", {}), []);
  assert.equal(emits("phone.onChanged").length, count + 1);
});

test("registry-level: every phone id dispatch-resolves", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  const paramsFor = (id) => {
    if (id === "phone.decide") return { intentId: "ghost", decision: "deny" };
    if (id === "phone.resetIdentity") return {}; // schema refuses without confirm — still an envelope
    return {};
  };
  for (const h of handlers) {
    const env = await dispatch(h.id, paramsFor(h.id));
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
  }
});
