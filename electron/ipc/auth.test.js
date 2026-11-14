"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { coreMethodAllowed, PRINCIPALS } = require("./auth");

test("known principals are enumerated", () => {
  assert.deepEqual(PRINCIPALS, ["desktop", "cli", "remote", "local-client", "capability"]);
});

test("desktop principal is allowed (app's own renderer)", () => {
  for (const m of ["files.read", "bus.query", "terminal.start"]) {
    assert.equal(coreMethodAllowed("desktop", m).allowed, true, m);
  }
});

test("unknown principal is denied", () => {
  const r = coreMethodAllowed("hacker", "files.read");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /unknown principal/);
});

test("a non-desktop principal is refused the methods outside its table", () => {
  // the cli may drive a terminal…
  assert.equal(coreMethodAllowed("cli", "terminal.create").allowed, true);
  // …but not the repository.
  const r = coreMethodAllowed("cli", "git.mutate");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /not granted/);
  // the capability principal has no table of its own: it needs a grant.
  const cap = coreMethodAllowed("capability", "core.status");
  assert.equal(cap.allowed, false);
  assert.match(cap.reason, /capability token/);
});

test("a capability token carries its own grant", () => {
  const grant = { methods: ["facts.query", "core.status"] };
  assert.equal(coreMethodAllowed("capability", "facts.query", grant).allowed, true);
  assert.equal(coreMethodAllowed("capability", "core.status", grant).allowed, true);
  // the grant does not leak to other methods
  assert.equal(coreMethodAllowed("capability", "git.mutate", grant).allowed, false);
  // and an expired token is refused
  assert.equal(
    coreMethodAllowed("capability", "facts.query", { ...grant, expiresAt: Date.now() - 1 }).allowed,
    false,
  );
});
