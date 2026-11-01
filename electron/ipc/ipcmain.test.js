"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { attachIpcMain } = require("./ipcmain");
const registry = require("./registry");
const { CALL, INSPECT, EVENT } = require("./facade");
const { ERR } = require("./envelope");

/** Minimal fake ipcMain: records handlers so tests can invoke them like Electron would. */
function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      if (handlers.has(channel)) throw new Error(`duplicate channel ${channel}`);
      handlers.set(channel, fn);
    },
    async invoke(channel, event, req) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return fn(event, req);
    },
  };
}


/** Event shape Electron sends: only our own app origin derives to `desktop`. */
const APP_EVENT = { senderFrame: { url: "http://127.0.0.1:3000/" } };

beforeEach(() => registry.reset());

test("attach registers the generic CALL and INSPECT channels", () => {
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, {});
  assert.ok(ipc.handlers.has(CALL));
  assert.ok(ipc.handlers.has(INSPECT));
  assert.equal(ipc.handlers.size, 2); // only generic channels — no per-method handles
});

test("renderer call roundtrip: facade request -> dispatch -> envelope", async () => {
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, {});
  registry.register("bridge", "settings.get", (p) => ({ theme: p.key }));

  const env = await ipc.invoke(CALL, APP_EVENT, {
    kind: "bridge",
    id: "settings.get",
    params: { key: "dark" },
  });
  assert.deepEqual(env, { ok: true, result: { theme: "dark" } });
});

test("missing id -> bad-params envelope; unknown method -> not-found", async () => {
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, {});
  const noId = await ipc.invoke(CALL, APP_EVENT, {});
  assert.equal(noId.ok, false);
  assert.equal(noId.error.code, ERR.BAD_PARAMS);

  const unknown = await ipc.invoke(CALL, APP_EVENT, { id: "nope.missing", params: {} });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, ERR.NOT_FOUND);
});

test("principal comes from getPrincipal(event) and enforces auth", async () => {
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, { getPrincipal: (event) => event.principal || "desktop" });
  registry.register("core", "remote.enable", () => ({ on: true }));

  const denied = await ipc.invoke(CALL, { principal: "remote" }, {
    kind: "core",
    id: "remote.enable",
    params: {},
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, ERR.FORBIDDEN);
});

test("recent log records successes and failures with timing", async () => {
  const ipc = fakeIpcMain();
  const lines = [];
  const api = attachIpcMain(ipc, { isDev: true, log: (l) => lines.push(l), getPrincipal: () => "desktop" });
  registry.register("bridge", "settings.get", () => ({ theme: "dark" }));

  await ipc.invoke(CALL, APP_EVENT, { id: "settings.get", params: {} });
  await ipc.invoke(CALL, APP_EVENT, { id: "missing.method", params: {} });

  assert.equal(api.recent.length, 2);
  assert.equal(api.recent[0].id, "missing.method");
  assert.equal(api.recent[0].ok, false);
  assert.equal(api.recent[0].code, ERR.NOT_FOUND);
  assert.equal(api.recent[1].id, "settings.get");
  assert.equal(api.recent[1].ok, true);
  assert.equal(typeof api.recent[1].ms, "number");
  assert.equal(lines.length, 2);
  // lines are chronological; recent[] is newest-first
  assert.match(lines[0], /\[ipc\] bridge:settings\.get \| desktop \| ok \d+ms/);
  assert.match(lines[1], /\[ipc\] bridge:missing\.method \| desktop \| not-found/);
});

test("recent log rolls over at maxRecent", async () => {
  const ipc = fakeIpcMain();
  const api = attachIpcMain(ipc, { maxRecent: 3 });
  for (let i = 0; i < 5; i++) await ipc.invoke(CALL, APP_EVENT, { id: `n${i}.x`, params: {} });
  assert.equal(api.recent.length, 3);
  assert.equal(api.recent[0].id, "n4.x");
});

test("principal derives from sender origin (fail-closed), payload cannot spoof it", async () => {
  const { derivePrincipal } = require("./ipcmain");
  const origins = ["http://127.0.0.1:3000"];
  // our own page -> desktop
  assert.equal(derivePrincipal({ senderFrame: { url: "http://127.0.0.1:3000/" } }, origins), "desktop");
  // foreign / missing origin -> untrusted (unknown principal => denied everywhere)
  assert.equal(derivePrincipal({ senderFrame: { url: "https://evil.example/" } }, origins), "untrusted");
  assert.equal(derivePrincipal({}, origins), "untrusted");
  assert.equal(derivePrincipal(null, origins), "untrusted");

  // end-to-end: foreign page is denied even with a registered handler
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, { allowedOrigins: origins });
  registry.register("bridge", "settings.get", () => ({ theme: "dark" }));
  const foreign = await ipc.invoke(
    CALL,
    { senderFrame: { url: "https://evil.example/" } },
    { id: "settings.get", params: {} },
  );
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, ERR.FORBIDDEN);
  // and a `principal` claim inside the payload is ignored (not used for auth)
  const spoof = await ipc.invoke(
    CALL,
    { senderFrame: { url: "http://127.0.0.1:3000/" } },
    { id: "settings.get", params: {}, principal: "remote" },
  );
  assert.equal(spoof.ok, true);
});

test("INSPECT returns manifest surface + implemented + recent (Bridge Inspector)", async () => {
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, {});
  registry.register("bridge", "projects.pickFolder", () => ({ path: "/tmp" }), {
    description: "native folder picker (Wave 0 end-to-end proof)",
  });

  const data = await ipc.invoke(INSPECT, {});
  assert.equal(data.project, "autumn");
  assert.deepEqual(data.protocol, { API_VERSION: 2, SCHEMA: 8 });
  assert.equal(data.namespaces.length, 68);
  const pf = data.namespaces.find((n) => n.ns === "projects");
  assert.ok(pf.methods.includes("projects.pickFolder"));
  assert.equal(data.implemented.length, 1);
  assert.deepEqual(data.implemented[0], {
    kind: "bridge",
    id: "projects.pickFolder",
    description: "native folder picker (Wave 0 end-to-end proof)",
  });
  assert.ok(Array.isArray(data.recent));
});

test("emit pushes to webContents.send on the EVENT channel", () => {
  const ipc = fakeIpcMain();
  const sent = [];
  const win = { webContents: { isDestroyed: () => false, send: (ch, p) => sent.push([ch, p]) } };
  const api = attachIpcMain(ipc, {});
  api.emit(win, "artifacts.onChanged", { id: 1 });
  assert.deepEqual(sent, [[EVENT("artifacts.onChanged"), { id: 1 }]]);

  // destroyed sender must not throw
  api.emit({ webContents: { isDestroyed: () => true, send: () => { throw new Error("no"); } } }, "bus.onMutate", {});
});

test("facade->registrar end-to-end: buildFacade over ipc handlers", async () => {
  const { buildFacade } = require("./facade");
  const ipc = fakeIpcMain();
  attachIpcMain(ipc, {});
  registry.register("bridge", "git.status", async () => ({ files: 0 }));

  const facade = buildFacade({
    manifest: registry.manifest,
    invoke: (req) => ipc.invoke(CALL, APP_EVENT, req),
    subscribe: () => () => {},
  });
  const env = await facade.git.status({ repo: "/x" });
  assert.deepEqual(env, { ok: true, result: { files: 0 } });

  const missing = await facade.git.stage();
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, ERR.NOT_FOUND);
});
