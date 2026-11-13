"use strict";
// layer-1 tests for the backends bridge ids (docs/architecture/backend.md W2-7 §2d). The local-first
// mini data platform: registry CRUD, typed schemas + client regen, read-only
// SQL + structured queries, a guarded destructive-op queue, a REAL local data
// service (the local analogue of `supabase start`), and local sync snapshots.
//
// shapes that must hold: create/update take one object; remove(id) and
// schema(id) take a positional id; link/unlink are keyed by app; pending
// answers an ARRAY of changes; query accepts {id, sql}; peek accepts
// {id, table}; sync requires push|pull; the 3 convex ids are boundary.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeBackendsHandlers, _enqueueApproval, _backendsDir, parseSelect, planFromQuestion } = require("./backends.ts");

const DISPATCHABLE = manifest.bridge.namespaces.backends; // 23, read from the oracle
const BOUNDARY = ["backends.convexAuthStatus", "backends.convexLogin", "backends.convexCreate"];

function build(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: {
      spawn: (command, args, opts) => {
        const proc = { killed: false, on: () => proc, kill: () => { proc.killed = true; } };
        state.spawns.push({ command, args, opts, proc });
        return proc;
      },
    },
    ...overrides,
  };
  const handlers = makeBackendsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

/** Create a backend through its own handler; returns the entity row. */
async function create(call, name = "My DB") {
  const row = await call("backends.create", { name });
  assert.ok(row.id && row.slug, `create must return {id,slug}: ${JSON.stringify(row)}`);
  return row;
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./backends.ts")]) delete require.cache[p];
});

test("id surface: 23 backends ids, every one in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 23);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `backends.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("boundary: the 3 Convex ids return not-implemented envelopes (passed through by the registry)", async () => {
  useTempUserData();
  const { dispatch } = build();
  for (const id of BOUNDARY) {
    const env = await dispatch(id, {});
    assert.equal(env.ok, false, `${id} must fail`);
    assert.equal(env.error.code, "not-implemented", `${id} must be the boundary envelope`);
    assert.match(env.error.message, /boundary id|platform-boundary/);
  }
});

test("create → entity row (fields) with all state files scaffolded; duplicate names get unique slugs", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "My DB");
  assert.equal(row.name, "My DB");
  assert.equal(row.title, "My DB", "display field");
  assert.equal(row.slug, "my-db");
  assert.equal(row.kind, "local");
  assert.equal(row.status, "ready");
  assert.equal(row.collections, 0);
  assert.deepEqual(row.linkedApps, []);
  const base = path.join(dir, "backends");
  for (const f of ["index.json", "my-db/backend.json", "my-db/data.json", "my-db/pending.json", "my-db/meta.json", "my-db/client.ts"]) {
    assert.ok(fs.existsSync(path.join(base, f)), `${f} must exist after create`);
  }
  const row2 = await create(call, "My DB");
  assert.equal(row2.slug, "my-db-2");
  assert.notEqual(row2.id, row.id);
});

test("create accepts the title field and refuses cloud kinds (platform boundary)", async () => {
  useTempUserData();
  const { call } = build();
  const titled = await call("backends.create", { title: "Cloudless" });
  assert.equal(titled.name, "Cloudless");
  const convex = await call("backends.create", { name: "C", kind: "convex" });
  assert.equal(convex.ok, false);
  assert.equal(convex.error.code, "not-implemented");
  const supabase = await call("backends.create", { name: "S", kind: "supabase" });
  assert.equal(supabase.ok, false);
  assert.equal(supabase.error.code, "not-implemented");
});

test("create validates the name (schema rejects bad params)", async () => {
  useTempUserData();
  const { dispatch } = build();
  const bad = await dispatch("backends.create", { name: "" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});

test("list / update / not-found shapes", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Alpha");
  const rows = await call("backends.list");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].collections, 0);

  const upd = await call("backends.update", { id: row.id, title: "Alpha Renamed", description: "v2" });
  assert.equal(upd.name, "Alpha Renamed");
  assert.equal(upd.title, "Alpha Renamed");
  const missing = await call("backends.update", { id: "nope", name: "x" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
  const badName = await call("backends.update", { id: row.id, name: "!" });
  assert.equal(badName.ok, false);
  assert.equal(badName.error.code, "bad-params");
});

test("schema write validates field types and regenerates client.ts; schema read returns collections + tables", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Shop");
  const bad = await call("backends.schema", {
    id: row.id,
    collections: [{ name: "product", fields: [{ name: "price", type: "money" }] }],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.match(bad.error.message, /invalid field type/);

  const ok = await call("backends.schema", {
    id: row.id,
    collections: [{ name: "product", fields: [{ name: "price", type: "number" }, { name: "title", type: "string" }] }],
  });
  assert.equal(ok.clientWritten, true);
  assert.deepEqual(ok.tables, ["product"]);
  const client = fs.readFileSync(path.join(dir, "backends", "shop", "client.ts"), "utf8");
  assert.match(client, /CollectionName = "product"/);
  assert.match(client, /price\??: number/);
  assert.match(client, /export async function query/);
  assert.match(client, /export async function insert/);

  // shape: the renderer calls schema(backend.id) positionally.
  const readBack = await call("backends.schema", row.id);
  assert.equal(readBack.collections.length, 1);
  assert.equal(readBack.reachable, true);
});

test("query: read-only SQL (shape) — select/where/order/limit over real rows; writes are refused", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "CRM");
  await call("backends.schema", {
    id: row.id,
    collections: [{ name: "lead", fields: [{ name: "name", type: "string" }, { name: "score", type: "number" }] }],
  });
  fs.writeFileSync(
    path.join(dir, "backends", "crm", "data.json"),
    JSON.stringify({
      lead: [
        { name: "Ada", score: 9 },
        { name: "Bob", score: 4 },
        { name: "Cy", score: 7 },
      ],
    }),
    "utf8",
  );

  const all = await call("backends.query", { id: row.id, sql: "SELECT * FROM lead" });
  assert.equal(all.total, 3);
  assert.deepEqual(all.columns, ["name", "score"]);
  assert.equal(all.rows.length, 3);
  assert.ok(all.sql.includes("FROM \"lead\""), "the executed SQL is reported");

  const filtered = await call("backends.query", { id: row.id, sql: "SELECT name FROM lead WHERE score > 5 ORDER BY score DESC" });
  assert.deepEqual(filtered.rows.map((r) => r.name), ["Ada", "Cy"]);

  const limited = await call("backends.query", { id: row.id, sql: "SELECT * FROM lead LIMIT 1" });
  assert.equal(limited.rows.length, 1);

  const unknownTable = await call("backends.query", { id: row.id, sql: "SELECT * FROM ghost" });
  assert.equal(unknownTable.ok, false);
  assert.equal(unknownTable.error.code, "not-found");

  // A write must never run — the SQL surface is read-only.
  const write = await call("backends.query", { id: row.id, sql: "DELETE FROM lead" });
  assert.equal(write.ok, false);
  assert.equal(write.error.code, "bad-params");
  assert.match(write.error.message, /read-only/);
  const twoStatements = await call("backends.query", { id: row.id, sql: "SELECT * FROM lead; DROP TABLE lead" });
  assert.equal(twoStatements.ok, false);
  assert.equal(twoStatements.error.code, "bad-params");
});

test("query: structured form — field-op filters, sort, limit; bad filter → bad-params; unknown collection → not-found", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "CRM2");
  await call("backends.schema", {
    id: row.id,
    collections: [{ name: "lead", fields: [{ name: "name", type: "string" }, { name: "score", type: "number" }] }],
  });
  fs.writeFileSync(
    path.join(dir, "backends", "crm2", "data.json"),
    JSON.stringify({
      lead: [
        { name: "Ada", score: 9 },
        { name: "Bob", score: 4 },
        { name: "Cy", score: 7 },
      ],
    }),
    "utf8",
  );

  const all = await call("backends.query", { id: row.id, collection: "lead" });
  assert.equal(all.total, 3);

  const filtered = await call("backends.query", {
    id: row.id,
    collection: "lead",
    filter: { field: "score", op: "gt", value: 5 },
    sort: { field: "score", dir: "desc" },
  });
  assert.deepEqual(filtered.rows.map((r) => r.name), ["Ada", "Cy"]);

  const limited = await call("backends.query", { id: row.id, collection: "lead", limit: 1 });
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.total, 3, "total counts before limit");

  const badFilter = await call("backends.query", { id: row.id, collection: "lead", filter: { field: "x", op: "nope", value: 1 } });
  assert.equal(badFilter.ok, false);
  assert.equal(badFilter.error.code, "bad-params");

  const noCol = await call("backends.query", { id: row.id, collection: "ghost" });
  assert.equal(noCol.ok, false);
  assert.equal(noCol.error.code, "not-found");
});

test("peek: {id, table} shape returns columns + rows; without a table it summarizes every collection", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Peeky");
  await call("backends.schema", { id: row.id, collections: [{ name: "item", fields: [{ name: "a", type: "number" }] }] });
  fs.writeFileSync(path.join(dir, "backends", "peeky", "data.json"), JSON.stringify({ item: [{ a: 1 }, { a: 2 }] }), "utf8");

  const table = await call("backends.peek", { id: row.id, table: "item" });
  assert.deepEqual(table.columns, ["a"]);
  assert.deepEqual(table.rows, [[1], [2]], "shape: rows as arrays");
  assert.equal(table.collections[0].count, 2);

  const summary = await call("backends.peek", { id: row.id });
  assert.equal(summary.collections[0].count, 2);
  assert.ok(summary.sizeBytes > 0);

  const missing = await call("backends.peek", { id: row.id, table: "ghost" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
});

test("approval queue: pending is an ARRAY of contract-shaped changes; approve executes the drop for real", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Guarded");
  await call("backends.schema", {
    id: row.id,
    collections: [{ name: "junk", fields: [] }, { name: "keep", fields: [] }],
  });
  fs.writeFileSync(path.join(dir, "backends", "guarded", "data.json"), JSON.stringify({ junk: [{ x: 1 }], keep: [{ y: 1 }] }), "utf8");

  _enqueueApproval("guarded", {
    op: "dropCollection",
    backendId: row.id,
    collection: "junk",
    sql: 'DROP TABLE "junk";',
  });

  const pending = await call("backends.pending", row.id);
  assert.ok(Array.isArray(pending), "the renderer spreads this array");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, "pending");
  assert.ok(pending[0].id, "change id");
  assert.equal(pending[0].backendId, row.id);
  assert.equal(pending[0].sql, 'DROP TABLE "junk";');
  assert.ok(pending[0].file, "file field");

  const applied = await call("backends.approve", pending[0].id);
  assert.equal(applied.approved, true);
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.applied, { op: "dropCollection", collection: "junk", backendId: row.id });
  const data = JSON.parse(fs.readFileSync(path.join(dir, "backends", "guarded", "data.json"), "utf8"));
  assert.ok(!("junk" in data), "approved dropCollection must delete the rows");
  const schema = await call("backends.schema", row.id);
  assert.deepEqual(schema.collections.map((c) => c.name), ["keep"], "drop must remove the collection from the schema");

  const again = await call("backends.approve", pending[0].id);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, "bad-params");

  const unknown = await call("backends.approve", "chg-nope");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "not-found");
});

test("approval queue: reject drops the change with a note and executes nothing", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Guarded2");
  await call("backends.schema", { id: row.id, collections: [{ name: "keep", fields: [] }] });
  fs.writeFileSync(path.join(dir, "backends", "guarded2", "data.json"), JSON.stringify({ keep: [{ y: 1 }] }), "utf8");

  _enqueueApproval("guarded2", { op: "wipeRows", backendId: row.id, collection: "keep" });
  const pending = await call("backends.pending", {});
  assert.equal(pending.length, 1);
  const rejected = await call("backends.reject", { approvalId: pending[0].id, note: "not yet" });
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.note, "not yet");
  const data = JSON.parse(fs.readFileSync(path.join(dir, "backends", "guarded2", "data.json"), "utf8"));
  assert.equal(data.keep.length, 1, "rejected op must NOT execute");
  assert.deepEqual(await call("backends.pending", {}), [], "rejected changes leave the queue");
});

test("link/unlink: app-keyed bindings; absolute paths only; unknown backend → not-found", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Linked");
  const bad = await call("backends.link", { id: row.id, app: "web", projectPath: "relative/path" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const linked = await call("backends.link", { id: row.id, app: "web", projectPath: "/tmp/some-project", framework: "next" });
  assert.deepEqual(linked.linkedApps, ["web"]);
  assert.deepEqual(linked.linkedProjects, ["/tmp/some-project"]);
  const again = await call("backends.link", { id: row.id, app: "web", projectPath: "/tmp/some-project" });
  assert.equal(again.linkedApps.length, 1, "linking the same app twice must not duplicate");
  const phone = await call("backends.link", { id: row.id, app: "phone", projectPath: "/tmp/phone-project" });
  assert.deepEqual(phone.linkedApps.sort(), ["phone", "web"]);

  const unlinked = await call("backends.unlink", { id: row.id, app: "web" });
  assert.deepEqual(unlinked.linkedApps, ["phone"]);

  const missing = await call("backends.link", { id: "ghost", app: "web", projectPath: "/tmp/x" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
});

test("remove: confirm:true required; deletes dir + registry row; idempotent not-found", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Doomed");
  const noConfirm = await call("backends.remove", { id: row.id });
  assert.equal(noConfirm.ok, false);
  assert.equal(noConfirm.error.code, "bad-params");
  assert.ok(fs.existsSync(path.join(dir, "backends", "doomed")));

  const removed = await call("backends.remove", { id: row.id, confirm: true });
  assert.deepEqual(removed, { removed: true, id: row.id });
  assert.ok(!fs.existsSync(path.join(dir, "backends", "doomed")));
  assert.equal((await call("backends.list")).length, 0);

  const gone = await call("backends.remove", { id: row.id, confirm: true });
  assert.equal(gone.ok, false);
  assert.equal(gone.error.code, "not-found");
});

test("provision applies a starter template (+ optional starter rows); unknown template → bad-params", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Template");
  const todo = await call("backends.provision", { id: row.id, template: "todo", resetData: true });
  assert.equal(todo.template, "todo");
  assert.deepEqual(todo.collections.map((c) => c.name), ["todo"]);

  const seeded = await call("backends.provision", {
    id: row.id,
    template: "todo",
    resetData: true,
    rows: { todo: [{ title: "First" }, { title: "Second", done: true }] },
  });
  assert.equal(seeded.rows, 2);
  const rows = await call("backends.query", { id: row.id, collection: "todo" });
  assert.equal(rows.total, 2);
  assert.ok(rows.rows.every((r) => typeof r.id === "string"), "seeded rows get ids");

  const bad = await call("backends.provision", { id: row.id, template: "shopping-cart" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  void dir;
});

test("localStart/localStop/localStatus: a REAL local data service on 127.0.0.1", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Local");
  await call("backends.schema", { id: row.id, collections: [{ name: "item", fields: [{ name: "n", type: "number" }] }] });

  const before = await call("backends.localStatus", row.id);
  assert.equal(before.running, false);

  const started = await call("backends.localStart", row.id);
  assert.equal(started.running, true);
  assert.ok(started.port > 0, "a real port");
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const again = await call("backends.localStart", row.id);
  assert.equal(again.alreadyRunning, true);

  const status = await call("backends.localStatus", row.id);
  assert.equal(status.running, true);
  assert.equal(status.port, started.port);

  // The service really answers over HTTP.
  const health = await fetch(`${started.url}/health`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.collections, ["item"]);

  // And it really writes rows.
  const inserted = await fetch(`${started.url}/item`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: 42 }),
  });
  assert.equal(inserted.status, 201);
  const insertedBody = await inserted.json();
  assert.equal(insertedBody.rows[0].n, 42);
  const read = await (await fetch(`${started.url}/item`)).json();
  assert.equal(read.rows.length, 1);

  const queried = await call("backends.query", { id: row.id, collection: "item" });
  assert.equal(queried.total, 1, "the IPC query sees what the service wrote");

  const stopped = await call("backends.localStop", row.id);
  assert.equal(stopped.running, false);
  assert.equal((await call("backends.localStatus", row.id)).running, false);

  const missing = await call("backends.localStart", "ghost");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
});

test("sync: push writes a real local snapshot; pull restores it; direction must be push|pull", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Synced");
  await call("backends.schema", { id: row.id, collections: [{ name: "note", fields: [{ name: "body", type: "string" }] }] });
  fs.writeFileSync(path.join(dir, "backends", "synced", "data.json"), JSON.stringify({ note: [{ body: "hello" }] }), "utf8");

  const pushed = await call("backends.sync", { id: row.id, direction: "push" });
  assert.equal(pushed.synced, true);
  assert.equal(pushed.direction, "push");
  assert.equal(pushed.docsCount, 1);
  assert.ok(fs.existsSync(pushed.snapshot), "the snapshot file really exists");

  // Change the data, then pull the snapshot back.
  fs.writeFileSync(path.join(dir, "backends", "synced", "data.json"), JSON.stringify({ note: [] }), "utf8");
  const pulled = await call("backends.sync", { id: row.id, direction: "pull" });
  assert.equal(pulled.synced, true);
  assert.equal(pulled.direction, "pull");
  const restored = await call("backends.query", { id: row.id, collection: "note" });
  assert.equal(restored.total, 1, "pull really restored the snapshot");

  const bad = await call("backends.sync", { id: row.id, direction: "sideways" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.match(bad.error.message, /push or pull/);
});

test("ask: a deterministic local planner answers from the real rows", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Asked");
  await call("backends.schema", {
    id: row.id,
    collections: [{ name: "lead", fields: [{ name: "name", type: "string" }, { name: "score", type: "number" }] }],
  });
  fs.writeFileSync(
    path.join(dir, "backends", "asked", "data.json"),
    JSON.stringify({ lead: [{ name: "Ada", score: 9 }, { name: "Bob", score: 4 }] }),
    "utf8",
  );

  const res = await call("backends.ask", { id: row.id, question: "how many leads are there?" });
  assert.equal(res.kind, "read");
  assert.match(res.sql, /FROM "lead"/);
  assert.equal(res.result.total, 2);

  const filtered = await call("backends.ask", { id: row.id, question: "leads with score over 5" });
  assert.equal(filtered.result.total, 1);
  assert.equal(filtered.result.objects[0].name, "Ada");
});

test("ask: a destructive request is QUEUED as a change, never executed", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Guarded3");
  await call("backends.schema", { id: row.id, collections: [{ name: "lead", fields: [{ name: "name", type: "string" }] }] });
  fs.writeFileSync(path.join(dir, "backends", "guarded3", "data.json"), JSON.stringify({ lead: [{ name: "Ada" }] }), "utf8");

  const res = await call("backends.ask", { id: row.id, question: "delete all leads" });
  assert.equal(res.kind, "change");
  assert.ok(res.approvalId);
  assert.match(res.sql, /DELETE FROM "lead"/);

  // Nothing ran yet — the rows are still there.
  const rows = await call("backends.query", { id: row.id, collection: "lead" });
  assert.equal(rows.total, 1);

  const pending = await call("backends.pending", row.id);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].op, "wipeRows");

  const applied = await call("backends.approve", pending[0].id);
  assert.equal(applied.approved, true);
  const after = await call("backends.query", { id: row.id, collection: "lead" });
  assert.equal(after.total, 0, "approval really wiped the rows");
});

test("ask: falls back to the agent runner when the planner cannot answer; no runner → honest error", async () => {
  useTempUserData();
  const row = await create(build().call, "Fallback");
  const withoutRunner = build();
  const err = await withoutRunner.call("backends.ask", { id: row.id, question: "what does the universe look like?" });
  assert.equal(err.kind, "error");
  assert.ok(err.message);

  const seen = [];
  const withRunner = build({
    spawner: {
      runAgent: async (req) => {
        seen.push(req);
        return { text: "the agent answered" };
      },
    },
  });
  const res = await withRunner.call("backends.ask", { id: row.id, question: "what does the universe look like?" });
  assert.equal(res.kind, "answer");
  assert.equal(res.text, "the agent answered");
  assert.equal(seen.length, 1);
  assert.match(seen[0].task, /Schema: /);
  assert.match(seen[0].task, /what does the universe look like\?/);
});

test("listOrgs is the single local org (documented deviation from the sbp_ token flow)", async () => {
  useTempUserData();
  const { call } = build();
  const orgs = await call("backends.listOrgs", "some-token");
  assert.equal(orgs.items.length, 1);
  assert.equal(orgs.items[0].id, "local");
});

test("scaffoldClient writes a REAL typed client into the backend dir or an absolute targetDir", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Client");
  await call("backends.schema", { id: row.id, collections: [{ name: "item", fields: [{ name: "n", type: "number" }] }] });
  const here = await call("backends.scaffoldClient", { id: row.id });
  assert.ok(fs.existsSync(here.path));
  assert.ok(here.bytes > 0);
  assert.equal(here.written.length, 1);
  const body = fs.readFileSync(here.path, "utf8");
  assert.match(body, /backendId = /);
  assert.match(body, /export async function insert/);

  const target = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-client-"));
  const there = await call("backends.scaffoldClient", { id: row.id, targetDir: target });
  assert.equal(there.path, path.join(target, "backendClient.ts"));
  assert.ok(fs.existsSync(there.path));

  const rel = await call("backends.scaffoldClient", { id: row.id, targetDir: "relative" });
  assert.equal(rel.ok, false);
  assert.equal(rel.error.code, "bad-params");
});

test("pure helpers: parseSelect refuses writes; planFromQuestion maps a question to a plan", () => {
  const write = parseSelect("UPDATE lead SET score = 0");
  assert.equal(write.ok, false);
  assert.match(write.message, /read-only/);

  const select = parseSelect("SELECT name, score FROM lead WHERE score >= 5 AND name = 'Ada' ORDER BY score DESC LIMIT 10");
  assert.equal(select.ok, true);
  assert.equal(select.plan.table, "lead");
  assert.deepEqual(select.plan.select, ["name", "score"]);
  assert.equal(select.plan.where.length, 2);
  assert.equal(select.plan.order.dir, "desc");
  assert.equal(select.plan.limit, 10);

  const collections = [{ name: "lead", fields: [{ name: "name", type: "string" }, { name: "score", type: "number" }] }];
  const plan = planFromQuestion("leads with score over 5", collections);
  assert.equal(plan.kind, "read");
  assert.equal(plan.plan.table, "lead");
  assert.equal(plan.plan.where[0].field, "score");
  assert.equal(plan.plan.where[0].op, "gt");
  assert.equal(plan.plan.where[0].value, 5);

  const destructive = planFromQuestion("delete every lead", collections);
  assert.equal(destructive.kind, "change");
  assert.equal(destructive.op, "wipeRows");
  assert.equal(destructive.collection, "lead");

  const unknown = planFromQuestion("what is the meaning of life?", collections);
  assert.equal(unknown.kind, "unknown");
});

test("registry-level: every backends id dispatch-resolves (envelope in, envelope out)", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  for (const h of handlers) {
    const env = await dispatch(h.id, h.id.startsWith("backends.convex") ? {} : validParamsFor(h.id));
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    if (!env.ok && !h.id.startsWith("backends.convex")) {
      // A handler's own not-found (unknown resource) is fine; a missing
      // registry entry says exactly that.
      assert.ok(!/^no handler for /.test(env.error.message), `${h.id} resolved as ${env.error.message}`);
    }
  }
});

/** Minimal params that pass each handler's schema (so only real logic can fail). */
function validParamsFor(id) {
  switch (id) {
    case "backends.create":
      return { name: "Dispatch Probe" };
    case "backends.update":
    case "backends.remove":
    case "backends.schema":
    case "backends.peek":
    case "backends.scaffoldClient":
    case "backends.provision":
    case "backends.sync":
      return { id: "ghost-backend" };
    case "backends.link":
    case "backends.unlink":
      return { id: "ghost-backend", app: "web", projectPath: "/tmp/x" };
    case "backends.query":
      return { id: "ghost-backend", collection: "c" };
    case "backends.ask":
      return { id: "ghost-backend", question: "q" };
    case "backends.approve":
    case "backends.reject":
      return { approvalId: "ghost" };
    default:
      return {};
  }
}
