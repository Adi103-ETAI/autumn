"use strict";
// Layer-1 units for the canvas command queue (doc 31 §4): headless — no
// Electron, no Prisma, no network. Deps are FAKED (only the members w1-canvas
// calls: db.canvas.findUnique/update/upsert, emit, now) — the fake canvas row
// really parse/stringifies its `state` JSON, so the queue round-trips through
// the same code path production uses. Assertions run both directly on the
// handlers and through the REAL registry (dispatch wraps {ok,result}).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register"); // transpile ./canvas.ts on require
const reg = require("../ipc/registry");
const { makeCanvasHandlers } = require("./canvas.ts");

const NOW = 1700000000000;

/**
 * Build the handler table over a FAKE deps object. `rows` is the in-memory
 * canvas store (id -> row, `state` kept as the JSON string the row stores);
 * `state` captures emit/db interactions for assertions.
 * @param {Array<{id:string,name?:string,state?:string}>} [seedRows]
 */
function build(seedRows = []) {
  const state = { emitted: [], updates: [], creates: [], upserts: [] };
  const rows = new Map();
  rows.set("default", {
    id: "default",
    name: "Default Canvas",
    state: JSON.stringify({ nodes: [], connections: [] }),
    updatedAt: new Date(1000),
  });
  for (const r of seedRows) {
    rows.set(r.id, { name: "Seeded", state: "{}", updatedAt: new Date(1000), ...r });
  }

  const deps = {
    now: () => NOW,
    emit: (id, payload) => state.emitted.push([id, payload]),
    db: {
      canvas: {
        findUnique: async ({ where }) => rows.get(where.id) ?? null,
        findMany: async () => [...rows.values()],
        update: async ({ where, data }) => {
          state.updates.push({ where, data });
          const row = rows.get(where.id);
          if (!row) throw new Error(`update: no canvas ${where.id}`);
          const next = { ...row, ...data, updatedAt: new Date(NOW + 1) };
          rows.set(where.id, next);
          return next;
        },
        create: async ({ data }) => {
          state.creates.push({ data });
          const row = { id: data.id, name: data.name, state: data.state, updatedAt: new Date(NOW + 2) };
          rows.set(row.id, row);
          return row;
        },
        upsert: async ({ where, update, create }) => {
          state.upserts.push({ where, update, create });
          const existing = rows.get(where.id);
          if (existing) {
            const next = { ...existing, ...update, updatedAt: new Date(NOW + 3) };
            rows.set(where.id, next);
            return next;
          }
          const row = { ...create, updatedAt: new Date(NOW + 3) };
          rows.set(where.id, row);
          return row;
        },
        delete: async ({ where }) => {
          if (!rows.delete(where.id)) throw new Error("nope");
          return { ok: true };
        },
      },
    },
  };

  const handlers = makeCanvasHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  /** Read the queue back OUT of the stored row state (real JSON round-trip). */
  const readQueue = (canvasId = "default") => {
    const parsed = JSON.parse(rows.get(canvasId).state);
    return parsed.pendingCommands ?? [];
  };
  return { handlers, byId, call, state, rows, readQueue };
}

/** Register the whole set on the real registry (for dispatch-level checks). */
function registerAll() {
  const { handlers } = build();
  for (const h of handlers) {
    reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
}

beforeEach(() => reg.reset());

// ---------------- id surface ----------------

test("id surface: exactly the 6 renderer-used canvas ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 6, "canvas registers exactly 6 handlers (load/save are Wave-0)");
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    [
      "canvas.commandProgress",
      "canvas.commandResult",
      "canvas.exportCanvas",
      "canvas.importCanvas",
      "canvas.pendingCommands",
      "canvas.stageCommand",
    ],
    "no extra/renamed/missing ids",
  );
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(h.description.includes("params:"), `${h.id}: description must document the param shape`);
    assert.ok(reg.inManifest("bridge", h.id), `${h.id}: must exist in manifest bridge namespace canvas`);
  }
});

// ---------------- command queue lifecycle ----------------

test("stage -> pending -> progress -> result lifecycle persists into canvas state", async () => {
  const { call, readQueue } = build();

  // empty queue on a fresh canvas
  assert.deepEqual((await call("canvas.pendingCommands", {})).commands, []);

  const st = await call("canvas.stageCommand", { command: "spawn-agent", args: { n: 2 } });
  assert.equal(st.status, "pending");
  assert.ok(typeof st.id === "string" && st.id.length > 0);

  // persisted entry, actually parsed back out of the row's state JSON
  let q = readQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].id, st.id);
  assert.equal(q[0].command, "spawn-agent");
  assert.deepEqual(q[0].args, { n: 2 });
  assert.equal(q[0].status, "pending");
  assert.equal(q[0].ts, NOW);

  assert.equal((await call("canvas.pendingCommands", {})).commands.length, 1);

  const prog = await call("canvas.commandProgress", { id: st.id, progress: 40 });
  assert.equal(prog.ok, true);
  assert.equal(prog.id, st.id);
  assert.equal(prog.status, "running"); // progress without explicit status implies running
  assert.equal(prog.progress, 40);
  q = readQueue();
  assert.equal(q[0].progress, 40);
  assert.equal(q[0].status, "running");
  assert.equal(q.length, 1); // still pending

  const res = await call("canvas.commandResult", { id: st.id, ok: true, result: { text: "done" } });
  assert.equal(res.ok, true);
  assert.equal(res.id, st.id);
  assert.equal(res.status, "done");
  assert.equal(readQueue().length, 0); // dropped from pending
  assert.deepEqual((await call("canvas.pendingCommands", {})).commands, []);
});

test("queue is per-canvas; commandResult ok:false resolves as failed", async () => {
  const { call, readQueue } = build([{ id: "c2", name: "Second" }]);
  const a = await call("canvas.stageCommand", { canvas: "c2", command: "a" });
  await call("canvas.stageCommand", { canvas: "c2", command: "b" });
  assert.equal(readQueue("c2").length, 2);
  assert.equal(readQueue("default").length, 0); // untouched canvas

  const res = await call("canvas.commandResult", { canvas: "c2", id: a.id, ok: false, result: "boom" });
  assert.equal(res.status, "failed");
  const q = readQueue("c2");
  assert.equal(q.length, 1);
  assert.equal(q[0].command, "b"); // the resolved one is gone, the other stays
});

// ---------------- events (doc 31 §3) ----------------

test("events: stage emits onCanvasCommand; result emits onCanvasCommandResolved — nothing else", async () => {
  const { call, state } = build();

  // c2 does not exist -> no stage, no event
  const st = await call("canvas.stageCommand", { command: "run", canvas: "c2" });
  assert.equal(st.ok, false);
  assert.equal(st.error.code, "not-found");
  assert.deepEqual(state.emitted, []);

  const st2 = await call("canvas.stageCommand", { command: "run" });
  assert.deepEqual(state.emitted, [
    ["events.onCanvasCommand", { canvas: "default", id: st2.id, command: "run" }],
  ]);

  // progress is not a resolution -> no second event
  await call("canvas.commandProgress", { id: st2.id, progress: 10 });
  assert.equal(state.emitted.length, 1);

  await call("canvas.commandResult", { id: st2.id, ok: true, result: { text: "ok" } });
  assert.equal(state.emitted.length, 2);
  assert.deepEqual(state.emitted[1], [
    "events.onCanvasCommandResolved",
    { canvas: "default", id: st2.id, ok: true, result: { text: "ok" } },
  ]);
});

// ---------------- validation ----------------

test("bad-params: missing/empty/non-string command; missing id; broken import JSON", async () => {
  const { call, byId, state } = build();

  for (const params of [{}, { command: "" }, { command: "   " }, { command: 42 }, { command: null }]) {
    const res = await call("canvas.stageCommand", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params", JSON.stringify(params));
    assert.equal(byId["canvas.stageCommand"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.equal((await call("canvas.commandResult", {})).error.code, "bad-params");
  assert.equal((await call("canvas.commandResult", { id: "x", ok: "yes" })).error.code, "bad-params");
  assert.equal((await call("canvas.commandProgress", { id: "x", progress: "half" })).error.code, "bad-params");
  assert.equal((await call("canvas.commandProgress", { progress: 1 })).error.code, "bad-params");
  assert.equal((await call("canvas.importCanvas", { document: "{not json" })).error.code, "bad-params");
  assert.equal((await call("canvas.importCanvas", { state: "also not json" })).error.code, "bad-params");
  assert.equal((await call("canvas.importCanvas", {})).error.code, "bad-params");

  // rejected input never touches storage or emits
  assert.equal(state.updates.length, 0);
  assert.equal(state.emitted.length, 0);
});

test("not-found: unknown command id / unknown canvas rows", async () => {
  const { call } = build();

  // pending id that does not exist
  assert.equal((await call("canvas.commandResult", { id: "ghost-cmd" })).error.code, "not-found");
  assert.equal((await call("canvas.commandProgress", { id: "ghost-cmd" })).error.code, "not-found");
  // unknown canvas rows
  assert.equal((await call("canvas.pendingCommands", { canvas: "ghost-canvas" })).error.code, "not-found");
  assert.equal(
    (await call("canvas.stageCommand", { canvas: "ghost-canvas", command: "x" })).error.code,
    "not-found",
  );
  assert.equal((await call("canvas.exportCanvas", { id: "ghost-canvas" })).error.code, "not-found");
  assert.equal(
    (await call("canvas.commandResult", { canvas: "ghost-canvas", id: "x" })).error.code,
    "not-found",
  );
});

// ---------------- export / import ----------------

test("exportCanvas returns the serialised document; importCanvas round-trips it", async () => {
  const { call, rows, state } = build();

  const doc = await call("canvas.exportCanvas", { id: "default" });
  assert.equal(doc.id, "default");
  assert.equal(doc.name, "Default Canvas");
  assert.equal(typeof doc.state, "string");
  assert.doesNotThrow(() => JSON.parse(doc.state)); // state is valid JSON
  assert.ok(!Number.isNaN(Date.parse(doc.exportedAt)), "exportedAt is an ISO timestamp");

  // no id -> defaults to the "default" row
  assert.equal((await call("canvas.exportCanvas", {})).id, "default");

  // document as a JSON STRING with its own id -> row created
  const created = await call("canvas.importCanvas", {
    document: JSON.stringify({ ...doc, id: "imp-1", name: "Imported" }),
  });
  assert.equal(created.id, "imp-1");
  assert.equal(created.name, "Imported");
  assert.ok(created.updatedAt, "created canvas reports updatedAt");
  assert.equal(rows.get("imp-1").state, doc.state); // state round-tripped byte-for-byte
  const upsert = state.upserts[0];
  assert.equal(upsert.where.id, "imp-1");
  assert.equal(upsert.create.id, "imp-1");

  // explicit id + object state -> upserts over an existing row
  const updated = await call("canvas.importCanvas", { id: "default", name: "Renamed", state: { nodes: [1] } });
  assert.equal(updated.id, "default");
  assert.equal(updated.name, "Renamed");
  assert.equal(rows.get("default").state, '{"nodes":[1]}');
  assert.equal(state.upserts.length, 2);

  // valid payload but no id anywhere -> not-found
  const noId = await call("canvas.importCanvas", { document: JSON.stringify({ name: "x", state: "{}" }) });
  assert.equal(noId.ok, false);
  assert.equal(noId.error.code, "not-found");
});

// ---------------- registry dispatch (real envelope wrapping) ----------------

test("registry dispatch: success wraps {ok:true,result}; error envelopes pass through", async () => {
  registerAll();

  const staged = await reg.dispatch({ kind: "bridge", id: "canvas.stageCommand", params: { command: "build" } });
  assert.equal(staged.ok, true);
  assert.equal(staged.result.status, "pending");

  const pending = await reg.dispatch({ kind: "bridge", id: "canvas.pendingCommands", params: {} });
  assert.equal(pending.ok, true);
  assert.equal(pending.result.commands.length, 1);

  const exported = await reg.dispatch({ kind: "bridge", id: "canvas.exportCanvas", params: {} });
  assert.equal(exported.ok, true);
  assert.equal(exported.result.id, "default");

  const badStage = await reg.dispatch({ kind: "bridge", id: "canvas.stageCommand", params: {} });
  assert.equal(badStage.ok, false);
  assert.equal(badStage.error.code, "bad-params");

  const ghost = await reg.dispatch({ kind: "bridge", id: "canvas.commandResult", params: { id: "nope" } });
  assert.equal(ghost.ok, false);
  assert.equal(ghost.error.code, "not-found");

  const imported = await reg.dispatch({
    kind: "bridge",
    id: "canvas.importCanvas",
    params: { document: JSON.stringify({ id: "via-reg", name: "R", state: "{}" }) },
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.result.id, "via-reg");
});
