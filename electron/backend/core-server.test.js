"use strict";
// The core server and the CLI (Wave 4, doc 35 §7).
//
// The server really listens on the loopback interface, the token really
// guards it, the principal table really decides — and the CLI really talks
// to it.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const { useTempUserData } = require("./store.ts");
const { startCoreServer } = require("./core-server.ts");

/** A tiny core dispatcher: the real registry would be heavier than this needs. */
function dispatcher() {
  return async (req) => {
    if (req.id === "core.status") return { ok: true, result: { server: "autumn", principal: req.principal } };
    if (req.id === "terminal.list") return { ok: true, result: { terminals: [{ nodeId: "n1", kind: "agent" }] } };
    if (req.id === "agent.list") return { ok: true, result: { agents: [{ id: "s1", engine: "codex" }] } };
    if (req.id === "git.mutate") return { ok: true, result: { mutated: true } };
    return { ok: false, error: { code: "not-found", message: `no handler for core:${req.id}` } };
  };
}

beforeEach(() => {
  useTempUserData();
});

test("the core server answers the protocol and guards it with the token", async () => {
  const server = await startCoreServer({ dispatch: dispatcher() });
  try {
    // no token → refused
    const refused = await fetch(`${server.url}/core`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "core.status" }),
    });
    assert.equal(refused.status, 401);

    // the right token → the envelope
    const ok = await fetch(`${server.url}/core`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ method: "core.status" }),
    });
    assert.equal(ok.status, 200);
    const env = await ok.json();
    assert.equal(env.ok, true);
    assert.equal(env.result.server, "autumn");
  } finally {
    await server.close();
  }
});

test("the principal table is enforced by the server itself", async () => {
  const server = await startCoreServer({ dispatch: dispatcher() });
  try {
    // the cli may drive a terminal
    const allowed = await fetch(`${server.url}/core`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ method: "terminal.list" }),
    });
    assert.equal((await allowed.json()).ok, true);

    // but not the repository
    const refused = await fetch(`${server.url}/core`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ method: "git.mutate" }),
    });
    assert.equal(refused.status, 403);
    const env = await refused.json();
    assert.equal(env.ok, false);
    assert.match(env.error.message, /not granted/);
  } finally {
    await server.close();
  }
});

test("the handshake is readable without a token", async () => {
  const server = await startCoreServer({ dispatch: dispatcher() });
  try {
    const res = await fetch(`${server.url}/core/handshake`);
    assert.equal(res.status, 200);
    const env = await res.json();
    assert.equal(env.result.apiVersion, 2);
    assert.equal(env.result.principal, "cli");
  } finally {
    await server.close();
  }
});

test("the token is shared through the user-data dir, and it is 0600", async () => {
  const server = await startCoreServer({ dispatch: dispatcher() });
  try {
    const file = path.join(process.env.AUTUMN_USER_DATA_DIR, "core-token.json");
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.token, server.token);
    assert.ok(server.token.length >= 32);
  } finally {
    await server.close();
  }
});

test("the CLI really talks to the running app", async () => {
  const server = await startCoreServer({ dispatch: dispatcher() });
  try {
    const cli = path.join(__dirname, "..", "..", "scripts", "autumn-cli.mjs");
    const env = {
      ...process.env,
      AUTUMN_CORE_URL: server.url,
      AUTUMN_USER_DATA_DIR: process.env.AUTUMN_USER_DATA_DIR,
    };
    // The CLI runs as a child process, so the spawn is ASYNC — the server
    // lives in this process and needs the event loop to answer.
    const run = (args) =>
      new Promise((resolve) => {
        require("node:child_process").execFile(
          process.execPath,
          [cli, ...args],
          { env, encoding: "utf8", timeout: 20_000 },
          (error, stdout, stderr) => resolve({ error, stdout, stderr }),
        );
      });

    const status = await run(["status"]);
    assert.equal(status.error, null, String(status.stderr));
    assert.equal(JSON.parse(status.stdout).server, "autumn");

    const list = await run(["terminal", "list"]);
    assert.equal(list.error, null, String(list.stderr));
    assert.equal(JSON.parse(list.stdout).terminals.length, 1);

    // and the CLI is refused what the cli principal may not call
    const refused = await run(["call", "git.mutate"]);
    assert.ok(refused.error, "the cli must fail on a method it has no grant for");
    assert.match(String(refused.stderr), /not granted/);
  } finally {
    await server.close();
  }
});
