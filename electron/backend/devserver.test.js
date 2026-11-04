"use strict";
// Layer-1 units for the devServer namespace (doc 31 §T): headless — NO real
// processes, no network calls, no Electron. deps.spawn and deps.emit are FAKED
// and driven by hand: the fake child records its listeners so tests can fire
// "exit"/"error" manually and assert the events.onDevServer emissions. Only
// lanHost reads the real os.networkInterfaces() (pure inspection, no sockets).
// Assertions run both directly on the handlers and through the REAL registry
// (dispatch wraps {ok,result} / passes deliberate envelopes through).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
require("../ts-register"); // transpile ./devserver.ts on require
const reg = require("../ipc/registry");
const { makeDevServerHandlers, devServers } = require("./devserver.ts");

/**
 * Controllable fake child process (ChildProcLike): records listeners and kill
 * calls; tests fire "exit"/"error" themselves instead of running a process.
 * `extra` can add e.g. { pid: 4321 } to mimic a real child_process handle.
 */
function fakeProc(extra = {}) {
  const listeners = { exit: [], error: [] };
  const proc = {
    killCalls: [],
    on(event, cb) {
      listeners[event].push(cb);
    },
    kill(signal) {
      proc.killCalls.push(signal === undefined ? "(default)" : signal);
    },
    stdout: { on() {} }, // drained by the handler; must never throw
    stderr: { on() {} },
    fireExit(code) {
      for (const cb of listeners.exit) cb(code);
    },
    fireError(err) {
      for (const cb of listeners.error) cb(err);
    },
    ...extra,
  };
  return proc;
}

/** Build the handler table over FAKE deps; `state` captures interactions. */
function build(procExtra = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    now: () => 1700000000000,
    emit: (id, payload) => state.emitted.push([id, payload]),
    spawn: {
      spawn: (command, args, opts) => {
        const proc = fakeProc(procExtra);
        state.spawns.push({ command, args, opts, proc });
        return proc;
      },
    },
  };
  const handlers = makeDevServerHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

/** Register the whole set on the real registry (for dispatch-level checks). */
function registerAll() {
  const { handlers } = build();
  for (const h of handlers) {
    reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
}

beforeEach(() => {
  reg.reset();
  devServers.clear(); // the module-level map is shared across build()s
});

// ---------------- id surface ----------------

test("id surface: exactly the 4 renderer-used devServer ids, all in the manifest", () => {
  const { handlers } = build();
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    ["devServer.enableExpoWeb", "devServer.lanHost", "devServer.start", "devServer.stop"],
    "exactly 4 handlers, no extra/renamed ids",
  );
  assert.equal(handlers.length, 4);
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(h.description.includes("params:"), `${h.id}: description must document the param shape`);
    assert.ok(reg.inManifest("bridge", h.id), `${h.id}: must exist in manifest bridge namespace devServer`);
  }
});

// ---------------- devServer.start ----------------

test("devServer.start: spawns a child, stores the record, emits 'starting'", async () => {
  const { call, state } = build();
  const res = await call("devServer.start", {
    cwd: "/projects/demo",
    command: "npm",
    args: ["run", "dev"],
    env: { PORT: "5173" },
    port: 5173,
  });
  assert.deepEqual(res, { key: "/projects/demo", pid: null, status: "starting" });

  assert.equal(state.spawns.length, 1);
  const { command, args, opts, proc } = state.spawns[0];
  assert.equal(command, "npm");
  assert.deepEqual(args, ["run", "dev"]);
  assert.equal(opts.cwd, "/projects/demo");
  // env is MERGED over the parent env (PATH must survive for npm to resolve)
  assert.equal(opts.env.PORT, "5173");
  assert.equal(opts.env.PATH, process.env.PATH);

  // module-level record: real introspection data, the exact child we spawned
  const rec = devServers.get("/projects/demo");
  assert.equal(rec.command, "npm");
  assert.equal(rec.cwd, "/projects/demo");
  assert.equal(rec.startedAt, 1700000000000);
  assert.equal(rec.port, 5173);
  assert.equal(rec.proc, proc);

  // REAL spawn transition -> exactly one event, nothing else
  assert.deepEqual(state.emitted, [["events.onDevServer", { key: "/projects/demo", status: "starting" }]]);
});

test("devServer.start: no env passed -> child inherits (opts.env undefined)", async () => {
  const { call, state } = build();
  await call("devServer.start", { cwd: "/p", command: "npm" });
  assert.equal(state.spawns[0].opts.env, undefined); // node default: inherit
});

test("devServer.start: pid reported when the child has one, null otherwise", async () => {
  const a = build();
  const noPid = await a.call("devServer.start", { cwd: "/a", command: "x" });
  assert.equal(noPid.pid, null); // ChildProcLike guarantees no pid -> honest null

  const b = build({ pid: 4321 });
  const withPid = await b.call("devServer.start", { cwd: "/b", command: "x" });
  assert.equal(withPid.pid, 4321); // real pid passes through, never invented
});

test("devServer.start: bad params -> bad-params, nothing spawned, nothing emitted", async () => {
  const { call, byId, state } = build();
  const bad = [
    {}, // no cwd
    { cwd: "", command: "npm" }, // empty cwd
    { cwd: "relative/dir", command: "npm" }, // relative cwd
    { cwd: "/abs" }, // no command
    { cwd: "/abs", command: "" }, // empty command
    { cwd: "/abs", command: 42 }, // non-string command
    { cwd: "/abs", command: "npm", args: "dev" }, // args not an array
    { cwd: "/abs", command: "npm", args: [1] }, // non-string arg
    { cwd: "/abs", command: "npm", env: { PORT: 5173 } }, // env values must be strings
    { cwd: "/abs", command: "npm", port: 0 }, // port out of range
    { cwd: "/abs", command: "npm", port: 70000 },
    { cwd: "/abs", command: "npm", port: "5173" }, // non-number port
    { cwd: "/abs", command: "npm", key: "" }, // empty key
  ];
  for (const params of bad) {
    const res = await call("devServer.start", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params", JSON.stringify(params));
    assert.equal(byId["devServer.start"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.equal(state.spawns.length, 0, "no child spawned for invalid input");
  assert.deepEqual(state.emitted, [], "no events for invalid input");
});

test("devServer.start twice for the same key -> handler-error, first child untouched", async () => {
  const { call, byId, state } = build();
  const first = await call("devServer.start", { cwd: "/p", command: "npm" });
  assert.equal(first.status, "starting");

  // DOCUMENTED double-start choice: REJECT with handler-error "already
  // running" — do not replace, do not stop the live child silently.
  const second = await call("devServer.start", { cwd: "/p", command: "npm", args: ["run", "dev"] });
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "handler-error");
  assert.match(second.error.message, /already running/);

  assert.equal(state.spawns.length, 1, "no second spawn");
  assert.deepEqual(state.spawns[0].proc.killCalls, [], "first child NOT killed");
  assert.equal(state.emitted.length, 1, "only the first 'starting' event");
  assert.equal(devServers.get("/p").proc, state.spawns[0].proc, "record still tracks the first child");
  assert.equal(byId["devServer.start"].schema({ cwd: "/p", command: "npm" }).ok, true); // params fine, conflict only
});

test("devServer.start: explicit key param keys the map (cwd is the default key)", async () => {
  const { call, state } = build();
  const keyed = await call("devServer.start", { cwd: "/same", command: "npm", key: "demo-a" });
  assert.equal(keyed.key, "demo-a");
  assert.ok(devServers.has("demo-a"));

  // same key from a DIFFERENT cwd -> still a conflict -> handler-error
  const clash = await call("devServer.start", { cwd: "/other", command: "npm", key: "demo-a" });
  assert.equal(clash.error.code, "handler-error");

  // same cwd without a key is a different key -> allowed
  const byCwd = await call("devServer.start", { cwd: "/same", command: "npm" });
  assert.equal(byCwd.key, "/same");
  assert.equal(state.spawns.length, 2);
});

// ---------------- devServer.stop ----------------

test("devServer.stop: kills the child, drops the record, exit still emits, restart allowed", async () => {
  const { call, state } = build();
  await call("devServer.start", { cwd: "/p", command: "npm" });
  assert.equal(state.emitted.length, 1);

  const res = await call("devServer.stop", { cwd: "/p" });
  assert.deepEqual(res, { ok: true, stopped: true });
  assert.deepEqual(state.spawns[0].proc.killCalls, ["(default)"], "proc.kill() with the default signal");
  assert.equal(devServers.has("/p"), false);
  assert.equal(state.emitted.length, 1, "stop itself emits nothing — only observed transitions do");

  // the child's eventual exit is STILL a real observed transition -> event
  state.spawns[0].proc.fireExit(143);
  assert.deepEqual(state.emitted.at(-1), ["events.onDevServer", { key: "/p", status: "exited", code: 143 }]);
  assert.equal(devServers.has("/p"), false, "stale exit must not disturb a (re)started record");

  // key freed -> start again works
  const again = await call("devServer.start", { cwd: "/p", command: "npm" });
  assert.equal(again.status, "starting");
  assert.equal(state.spawns.length, 2);
});

test("devServer.stop: unknown key -> not-found; missing/bad params -> bad-params", async () => {
  const { call, byId, state } = build();
  const miss = await call("devServer.stop", { cwd: "/never-started" });
  assert.equal(miss.ok, false);
  assert.equal(miss.error.code, "not-found");

  for (const params of [{}, { cwd: "" }, { key: 42 }]) {
    const res = await call("devServer.stop", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params", JSON.stringify(params));
    assert.equal(byId["devServer.stop"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.equal(byId["devServer.stop"].schema({ cwd: "/x" }).ok, true);
  assert.equal(byId["devServer.stop"].schema({ key: "k" }).ok, true);
  assert.deepEqual(state.emitted, [], "failed stops emit nothing");
});

// ---------------- events (transitions only) ----------------

test("child 'exit' -> events.onDevServer {key,status:'exited',code}; key frees up", async () => {
  const { call, state } = build();
  await call("devServer.start", { cwd: "/p", command: "npm" });
  assert.equal(state.emitted.length, 1); // 'starting' only

  state.spawns[0].proc.fireExit(0);
  assert.deepEqual(state.emitted, [
    ["events.onDevServer", { key: "/p", status: "starting" }],
    ["events.onDevServer", { key: "/p", status: "exited", code: 0 }],
  ]);
  assert.equal(devServers.has("/p"), false);

  // exited key -> stop reports not-found (observed exit, not silence)
  const stop = await call("devServer.stop", { cwd: "/p" });
  assert.equal(stop.error.code, "not-found");

  // exit code may be null (killed by signal) — passed through untouched
  await call("devServer.start", { cwd: "/q", command: "npm" });
  state.spawns[1].proc.fireExit(null);
  assert.deepEqual(state.emitted.at(-1), ["events.onDevServer", { key: "/q", status: "exited", code: null }]);
});

test("child 'error' -> events.onDevServer {key,status:'error',message}; key restartable", async () => {
  const { call, state } = build();
  await call("devServer.start", { cwd: "/p", command: "nope" });
  assert.equal(state.emitted.length, 1);

  state.spawns[0].proc.fireError(new Error("spawn nope ENOENT"));
  assert.deepEqual(state.emitted.at(-1), [
    "events.onDevServer",
    { key: "/p", status: "error", message: "spawn nope ENOENT" },
  ]);
  // the errored child is dropped so the key is immediately startable again
  assert.equal(devServers.has("/p"), false);
  const retry = await call("devServer.start", { cwd: "/p", command: "nope" });
  assert.equal(retry.status, "starting");
  assert.equal(state.spawns.length, 2);
});

// ---------------- devServer.lanHost ----------------

test("devServer.lanHost: real os.networkInterfaces() — LAN IPv4 or null, never fabricated", async () => {
  const { call, state } = build();
  const res = await call("devServer.lanHost", {});
  assert.deepEqual(Object.keys(res), ["host"], "shape is exactly { host }");

  // independent recomputation with the same rules (skip internal, IPv4 only)
  let expected = null;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const e of addrs || []) {
      if (String(e.family) === "IPv4" && !e.internal) {
        expected = e.address;
        break;
      }
    }
    if (expected) break;
  }
  assert.equal(res.host, expected, "matches this machine's first non-internal IPv4");
  if (res.host !== null) {
    assert.match(res.host, /^(\d{1,3}\.){3}\d{1,3}$/, "a real dotted-quad");
    assert.notEqual(res.host, "127.0.0.1", "loopback is internal, never returned");
  }

  // read-only query: no spawn, no events
  assert.equal(state.spawns.length, 0);
  assert.deepEqual(state.emitted, []);
});

// ---------------- devServer.enableExpoWeb ----------------

test("devServer.enableExpoWeb: not-implemented (no Expo config pipeline), never a fake success", async () => {
  const { call, byId, state } = build();
  for (const params of [{}, { cwd: "/projects/demo" }]) {
    const res = await call("devServer.enableExpoWeb", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "not-implemented");
    assert.match(res.error.message, /Expo/i);
    assert.ok(byId["devServer.enableExpoWeb"].schema(params).ok, JSON.stringify(params));
  }

  // invalid input is rejected BEFORE the not-implemented answer
  const bad = await call("devServer.enableExpoWeb", { cwd: "" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.equal(byId["devServer.enableExpoWeb"].schema({ cwd: 42 }).ok, false);

  // nothing spawned, nothing written, nothing emitted
  assert.equal(state.spawns.length, 0);
  assert.deepEqual(state.emitted, []);
});

// ---------------- registry dispatch (real envelope wrapping) ----------------

test("registry dispatch: wraps plain payloads, passes deliberate envelopes through", async () => {
  registerAll();

  const start = await reg.dispatch({
    kind: "bridge",
    id: "devServer.start",
    params: { cwd: "/p", command: "npm", args: ["run", "dev"] },
  });
  assert.deepEqual(start, { ok: true, result: { key: "/p", pid: null, status: "starting" } });

  const dup = await reg.dispatch({ kind: "bridge", id: "devServer.start", params: { cwd: "/p", command: "npm" } });
  assert.equal(dup.ok, false);
  assert.equal(dup.error.code, "handler-error");

  const bad = await reg.dispatch({ kind: "bridge", id: "devServer.start", params: { cwd: "rel", command: "npm" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params"); // schema rejects before the handler

  const host = await reg.dispatch({ kind: "bridge", id: "devServer.lanHost", params: {} });
  assert.equal(host.ok, true);
  assert.ok(host.result.host === null || typeof host.result.host === "string");

  const expo = await reg.dispatch({ kind: "bridge", id: "devServer.enableExpoWeb", params: {} });
  assert.equal(expo.ok, false);
  assert.equal(expo.error.code, "not-implemented");

  const miss = await reg.dispatch({ kind: "bridge", id: "devServer.stop", params: { cwd: "/nope" } });
  assert.equal(miss.ok, false);
  assert.equal(miss.error.code, "not-found");

  const stop = await reg.dispatch({ kind: "bridge", id: "devServer.stop", params: { cwd: "/p" } });
  assert.deepEqual(stop, { ok: true, result: { ok: true, stopped: true } });
  assert.equal(devServers.has("/p"), false);
});
