"use strict";
// The core protocol's principal matrix (Wave 4).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { coreMethodAllowed, isKnownCoreMethod, PRINCIPALS } = require("./auth");
const P = require("./core-protocol");

test("the surface is the protocol's: 129 methods, 21 groups", () => {
  assert.equal(P.CORE_METHODS.length, 129);
  const groups = new Set(P.CORE_METHODS.map((m) => m.split(".")[0]));
  assert.equal(groups.size, 21);
  // every method is unique
  assert.equal(new Set(P.CORE_METHODS).size, 129);
});

test("the per-principal tables are the protocol's", () => {
  assert.equal(P.CORE_CLI_METHODS.length, 13);
  assert.equal(P.CORE_LOCAL_CLIENT_METHODS.length, 12);
  assert.equal(P.CORE_REMOTE_METHODS.length, 31);
  assert.equal(P.CORE_MUTATION_METHODS.length, 88);
  assert.equal(P.CORE_BUS_QUERY_OPERATIONS.length, 30);
  assert.equal(P.CORE_FACTS_QUERY_OPERATIONS.length, 6);
});

test("every method in a table is a real method", () => {
  for (const list of [P.CORE_CLI_METHODS, P.CORE_LOCAL_CLIENT_METHODS, P.CORE_REMOTE_METHODS, P.CORE_MUTATION_METHODS]) {
    for (const m of list) assert.ok(isKnownCoreMethod(m), `${m} is not a core method`);
  }
});

test("the desktop principal may call everything", () => {
  for (const m of P.CORE_METHODS) {
    assert.equal(coreMethodAllowed("desktop", m).allowed, true, m);
  }
});

test("the cli principal may drive a terminal and look around — and nothing else", () => {
  assert.equal(coreMethodAllowed("cli", "terminal.create").allowed, true);
  assert.equal(coreMethodAllowed("cli", "core.status").allowed, true);
  assert.equal(coreMethodAllowed("cli", "agent.list").allowed, true);
  // not on the table
  assert.equal(coreMethodAllowed("cli", "terminal.snapshot").allowed, true);
  assert.equal(coreMethodAllowed("cli", "bus.query").allowed, false);
  assert.equal(coreMethodAllowed("cli", "ui.resolve").allowed, false);
  assert.equal(coreMethodAllowed("cli", "git.mutate").allowed, false);
  assert.match(coreMethodAllowed("cli", "git.mutate").reason, /not granted/);
});

test("the local-client principal may read the surfaces", () => {
  assert.equal(coreMethodAllowed("local-client", "bus.query").allowed, true);
  assert.equal(coreMethodAllowed("local-client", "ui.command.request").allowed, true);
  assert.equal(coreMethodAllowed("local-client", "chat.history").allowed, true);
  assert.equal(coreMethodAllowed("local-client", "terminal.create").allowed, false);
});

test("the remote principal may use the relay surface", () => {
  assert.equal(coreMethodAllowed("remote", "terminal.input").allowed, true);
  assert.equal(coreMethodAllowed("remote", "remote.push.register").allowed, true);
  assert.equal(coreMethodAllowed("remote", "terminal.create").allowed, false);
});

test("a capability token carries its own grant and its own expiry", () => {
  const grant = { methods: ["facts.query", "agent.list"] };
  assert.equal(coreMethodAllowed("capability", "facts.query", grant).allowed, true);
  assert.equal(coreMethodAllowed("capability", "git.mutate", grant).allowed, false);
  assert.equal(
    coreMethodAllowed("capability", "facts.query", { ...grant, expiresAt: Date.now() - 1 }).allowed,
    false,
    "an expired token is refused",
  );
  assert.equal(
    coreMethodAllowed("capability", "facts.query", { ...grant, expiresAt: Date.now() + 60_000 }).allowed,
    true,
  );
});

test("an unknown principal is refused", () => {
  const res = coreMethodAllowed("nobody", "core.status");
  assert.equal(res.allowed, false);
  assert.match(res.reason, /unknown principal/);
});

test("the principals are the protocol's", () => {
  assert.deepEqual(PRINCIPALS, ["desktop", "cli", "remote", "local-client", "capability"]);
});
