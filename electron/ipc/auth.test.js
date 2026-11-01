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

test("non-desktop principal is denied by default (fail-closed Wave-0 skeleton)", () => {
  for (const p of ["cli", "remote", "local-client", "capability"]) {
    const r = coreMethodAllowed(p, "core.status");
    assert.equal(r.allowed, false, p);
    assert.match(r.reason, /not granted|Wave 4/);
  }
});

test("explicit rules grant a non-desktop principal a specific method", () => {
  const rules = { "remote.status": ["remote"], "cli.status": ["cli", "remote"] };
  assert.equal(coreMethodAllowed("remote", "remote.status", rules).allowed, true);
  assert.equal(coreMethodAllowed("cli", "cli.status", rules).allowed, true);
  // set form
  const setRules = { "localClient.pending": new Set(["local-client"]) };
  assert.equal(coreMethodAllowed("local-client", "localClient.pending", setRules).allowed, true);
  // grant does not leak to other methods or principals
  assert.equal(coreMethodAllowed("cli", "remote.status", rules).allowed, false);
  assert.equal(coreMethodAllowed("capability", "remote.status", rules).allowed, false);
});
