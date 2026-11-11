"use strict";
// layer-1 tests for the backends bridge ids (doc 32 W2-5 §2d). Local-first mini
// data platform: registry CRUD, typed schemas + client regen, field-op queries,
// approval queue with real execution, local runtime, sync markers. No network,
// no Electron. The 3 Convex ids are permanent boundary ids (doc 32 §2a).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeBackendsHandlers, _enqueueApproval, _backendsDir } = require("./backends.ts");

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

/** Create a backend through its own handler; returns {id, slug}. */
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
    assert.match(env.error.message, /boundary id/);
  }
});

test("create → row with slug + all state files scaffolded; duplicate names get unique slugs", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "My DB");
  assert.equal(row.name, "My DB");
  assert.equal(row.slug, "my-db");
  assert.equal(row.collections, 0);
  assert.equal(row.linked, 0);
  const base = path.join(dir, "backends");
  for (const f of ["index.json", "my-db/backend.json", "my-db/data.json", "my-db/pending.json", "my-db/meta.json", "my-db/client.ts"]) {
    assert.ok(fs.existsSync(path.join(base, f)), `${f} must exist after create`);
  }
  const row2 = await create(call, "My DB");
  assert.equal(row2.slug, "my-db-2");
  assert.notEqual(row2.id, row.id);
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

  const upd = await call("backends.update", { id: row.id, name: "Alpha Renamed", description: "v2" });
  assert.equal(upd.name, "Alpha Renamed");
  const missing = await call("backends.update", { id: "nope", name: "x" });
  assert.deepEqual(missing, { ok: false, error: { code: "not-found", message: "no backend nope" } });
  const badName = await call("backends.update", { id: row.id, name: "!" });
  assert.equal(badName.ok, false);
  assert.equal(badName.error.code, "bad-params");
});

test("schema write validates field types and regenerates client.ts; schema read returns collections", async () => {
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
  assert.equal(ok.collections[0].name, "product");
  const client = fs.readFileSync(path.join(dir, "backends", "shop", "client.ts"), "utf8");
  assert.match(client, /CollectionName = "product"/);
  assert.match(client, /price: number/);

  const readBack = await call("backends.schema", { id: row.id });
  assert.equal(readBack.collections.length, 1);
});

test("query: field-op filters, sort, limit over real data.json rows; bad filter → bad-params; unknown collection → not-found", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "CRM");
  await call("backends.schema", {
    id: row.id,
    collections: [{ name: "lead", fields: [{ name: "name", type: "string" }, { name: "score", type: "number" }] }],
  });
  // seed rows through the file layer (agent mutations land here via approvals — doc 2d)
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

test("peek reports collection counts + sizeBytes", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Peeky");
  await call("backends.schema", { id: row.id, collections: [{ name: "item", fields: [] }] });
  fs.writeFileSync(path.join(dir, "backends", "peeky", "data.json"), JSON.stringify({ item: [{ a: 1 }, { a: 2 }] }), "utf8");
  const peek = await call("backends.peek", { id: row.id });
  assert.equal(peek.collections[0].count, 2);
  assert.ok(peek.sizeBytes > 0);
});

test("approval queue: pending lists, approve executes the drop for real, reject drops with a note", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Guarded");
  await call("backends.schema", { id: row.id, collections: [{ name: "junk", fields: [] }, { name: "keep", fields: [] }] });
  fs.writeFileSync(path.join(dir, "backends", "guarded", "data.json"), JSON.stringify({ junk: [{ x: 1 }], keep: [{ y: 1 }] }), "utf8");

  _enqueueApproval("guarded", {
    approvalId: "ap-1",
    backendId: row.id,
    op: "dropCollection",
    collection: "junk",
    requestedAt: Date.now(),
    status: "pending",
  });
  _enqueueApproval("guarded", {
    approvalId: "ap-2",
    backendId: row.id,
    op: "wipeRows",
    collection: "keep",
    requestedAt: Date.now(),
    status: "pending",
  });

  const pending = await call("backends.pending", {});
  assert.equal(pending.approvals.length, 2);

  const applied = await call("backends.approve", "ap-1");
  assert.equal(applied.approved, true);
  assert.deepEqual(applied.applied, { op: "dropCollection", collection: "junk", backendId: row.id });
  const data = JSON.parse(fs.readFileSync(path.join(dir, "backends", "guarded", "data.json"), "utf8"));
  assert.ok(!("junk" in data), "approved dropCollection must delete the rows");
  const schema = await call("backends.schema", { id: row.id });
  assert.deepEqual(schema.collections.map((c) => c.name), ["keep"], "drop must remove the collection from the schema");

  const again = await call("backends.approve", "ap-1");
  assert.equal(again.ok, false);
  assert.equal(again.error.code, "bad-params");
  assert.match(again.error.message, /already approved/);

  const rejected = await call("backends.reject", { approvalId: "ap-2", note: "not yet" });
  assert.equal(rejected.rejected, true);
  const keepData = JSON.parse(fs.readFileSync(path.join(dir, "backends", "guarded", "data.json"), "utf8"));
  assert.equal(keepData.keep.length, 1, "rejected op must NOT execute");

  const unknown = await call("backends.approve", { approvalId: "ap-99" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "not-found");
});

test("link/unlink: absolute paths only; unknown backend → not-found", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Linked");
  const bad = await call("backends.link", { id: row.id, projectPath: "relative/path" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");

  const linked = await call("backends.link", { id: row.id, projectPath: "/tmp/some-project" });
  assert.deepEqual(linked.linkedProjects, ["/tmp/some-project"]);
  const again = await call("backends.link", { id: row.id, projectPath: "/tmp/some-project" });
  assert.equal(again.linkedProjects.length, 1, "linking twice must not duplicate");
  const unlinked = await call("backends.unlink", { id: row.id, projectPath: "/tmp/some-project" });
  assert.deepEqual(unlinked.linkedProjects, []);

  const missing = await call("backends.link", { id: "ghost", projectPath: "/tmp/x" });
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

test("localStart/localStop/localStatus: real persisted transitions + not-found", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Local");
  const start = await call("backends.localStart", row.id);
  assert.equal(start.running, true);
  assert.equal(start.pid, process.pid);
  const again = await call("backends.localStart", row.id);
  assert.equal(again.alreadyRunning, true);
  const status = await call("backends.localStatus", { id: row.id });
  assert.equal(status.running, true);
  const stop = await call("backends.localStop", row.id);
  assert.equal(stop.running, false);
  assert.equal((await call("backends.localStatus", row.id)).running, false);

  const missing = await call("backends.localStart", "ghost");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not-found");
});

test("sync writes local markers with a monotonically increasing schemaVersion", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Synced");
  const first = await call("backends.sync", { id: row.id, direction: "up" });
  assert.equal(first.synced, true);
  assert.equal(first.schemaVersion, 1);
  const second = await call("backends.sync", { id: row.id });
  assert.equal(second.schemaVersion, 2);
});

test("provision applies a starter template; unknown template → bad-params", async () => {
  useTempUserData();
  const { call } = build();
  const row = await create(call, "Template");
  const todo = await call("backends.provision", { id: row.id, template: "todo", resetData: true });
  assert.equal(todo.template, "todo");
  assert.deepEqual(todo.collections.map((c) => c.name), ["todo"]);
  const bad = await call("backends.provision", { id: row.id, template: "shopping-cart" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});

test("listOrgs is the single local org (documented deviation from the sbp_ token flow)", async () => {
  useTempUserData();
  const { call } = build();
  const orgs = await call("backends.listOrgs", "some-token");
  assert.equal(orgs.items.length, 1);
  assert.equal(orgs.items[0].id, "local");
});

test("scaffoldClient writes backendClient.ts into the backend dir or an absolute targetDir", async () => {
  const dir = useTempUserData();
  const { call } = build();
  const row = await create(call, "Client");
  const here = await call("backends.scaffoldClient", { id: row.id });
  assert.ok(fs.existsSync(here.path));
  assert.ok(here.bytes > 0);

  const target = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "autumn-client-"));
  const there = await call("backends.scaffoldClient", { id: row.id, targetDir: target });
  assert.equal(there.path, path.join(target, "backendClient.ts"));
  assert.ok(fs.existsSync(there.path));

  const rel = await call("backends.scaffoldClient", { id: row.id, targetDir: "relative" });
  assert.equal(rel.ok, false);
  assert.equal(rel.error.code, "bad-params");
  void dir;
});

test("ask: passes the schema as context to the spawner; no runner → handler-error", async () => {
  useTempUserData();
  const row = await create(build().call, "Asked");
  const withoutRunner = build();
  const err = await withoutRunner.call("backends.ask", { id: row.id, question: "how many?" });
  assert.equal(err.ok, false);
  assert.equal(err.error.code, "handler-error");

  const seen = [];
  const withRunner = build({
    spawner: {
      runAgent: async (req) => {
        seen.push(req);
        return { text: "three leads" };
      },
    },
  });
  const res = await withRunner.call("backends.ask", { id: row.id, question: "how many leads?" });
  assert.equal(res.text, "three leads");
  assert.equal(res.simulated, false);
  assert.equal(seen.length, 1);
  assert.match(seen[0].task, /Schema: /);
  assert.match(seen[0].task, /how many leads\?/);
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
      return { id: "ghost-backend", projectPath: "/tmp/x" };
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
