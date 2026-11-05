"use strict";
// Layer-1 units for the fs namespace (doc 31 §T): headless — no Electron, no
// native dialogs, no network. Deps are FAKED (only the members w1-fs calls:
// shell.showItemInFolder). Assertions run both directly on the handlers and
// through the REAL registry (dispatch wraps {ok,result} / passes envelopes).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
require("../ts-register"); // transpile ./fs.ts on require
const reg = require("../ipc/registry");
const { makeFsHandlers } = require("./fs.ts");

/** Build the handler table over a FAKE deps object (only members we call). */
function build() {
  const state = { revealed: [] };
  const deps = {
    shell: {
      showItemInFolder: (p) => state.revealed.push(p),
      openPath: async () => "",
      openExternal: async () => {},
    },
  };
  const handlers = makeFsHandlers(deps);
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

beforeEach(() => reg.reset());

// ---------------- id surface ----------------

test("id surface: exactly the 5 renderer-used fs ids, all in the manifest", () => {
  const { handlers } = build();
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    ["fs.browse", "fs.open", "fs.pathForFile", "fs.places", "fs.reveal"],
    "exactly 5 handlers, no extra/renamed ids",
  );
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(h.description.includes("params:"), `${h.id}: description must document the param shape`);
    assert.ok(reg.inManifest("bridge", h.id), `${h.id}: must exist in manifest bridge namespace fs`);
  }
});

// ---------------- fs.places ----------------

test("fs.places: lists common user dirs derived from node:os", async () => {
  const { call } = build();
  const res = await call("fs.places", {});
  assert.ok(Array.isArray(res.places));
  const byName = Object.fromEntries(res.places.map((p) => [p.name, p]));
  for (const name of ["home", "desktop", "documents", "downloads", "music", "pictures", "videos", "temp"]) {
    assert.ok(byName[name], `place "${name}" listed`);
    assert.ok(path.isAbsolute(byName[name].path), `${name} path absolute`);
    assert.equal(typeof byName[name].exists, "boolean", `${name} exposes exists`);
  }
  assert.equal(byName.home.path, os.homedir());
  assert.equal(byName.home.exists, true); // the user's home always exists
  assert.equal(byName.temp.path, os.tmpdir());
});

// ---------------- fs.open ----------------

test("fs.open: echoes the recorded path; bad input -> bad-params", async () => {
  const { call, byId } = build();
  assert.deepEqual(await call("fs.open", { path: "/tmp/last-opened.txt" }), { path: "/tmp/last-opened.txt" });

  const missing = await call("fs.open", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "bad-params");
  const wrongType = await call("fs.open", { path: 42 });
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.error.code, "bad-params");
  const empty = await call("fs.open", { path: "" });
  assert.equal(empty.error.code, "bad-params");

  // schema and handler agree (registry rejects before dispatch)
  assert.equal(byId["fs.open"].schema({ path: "/a" }).ok, true);
  assert.equal(byId["fs.open"].schema({}).ok, false);
});

// ---------------- fs.reveal ----------------

test("fs.reveal: delegates to shell.showItemInFolder and echoes the path", async () => {
  const { call, state } = build();
  const want = path.normalize("/tmp/some-file.txt");
  const res = await call("fs.reveal", { path: want });
  assert.deepEqual(res, { path: want });
  assert.deepEqual(state.revealed, [want]); // fake shell was called once
});

test("fs.reveal: missing/relative/NUL/non-string path -> bad-params, shell untouched", async () => {
  const { call, byId, state } = build();
  for (const params of [{}, { path: "" }, { path: "relative.txt" }, { path: "/a\0b" }, { path: null }]) {
    const res = await call("fs.reveal", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["fs.reveal"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.deepEqual(state.revealed, []);
});

// ---------------- fs.pathForFile ----------------

test("fs.pathForFile: sanitizes to a normalized absolute path", async () => {
  const { call } = build();
  assert.deepEqual(await call("fs.pathForFile", { path: "/tmp/a//b/../c.txt" }), { path: path.normalize("/tmp/a/c.txt") });
  assert.deepEqual(await call("fs.pathForFile", { path: "/tmp/./x.txt" }), { path: path.normalize("/tmp/x.txt") });
  // an already-clean path passes through unchanged
  assert.deepEqual(await call("fs.pathForFile", { path: path.normalize("/tmp/x.txt") }), { path: path.normalize("/tmp/x.txt") });
});

test("fs.pathForFile: relative/empty/NUL/non-string -> bad-params (schema agrees)", async () => {
  const { call, byId } = build();
  for (const params of [{}, { path: "" }, { path: "rel.txt" }, { path: "/x\0y" }, { path: undefined }]) {
    const res = await call("fs.pathForFile", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["fs.pathForFile"].schema(params).ok, false, JSON.stringify(params));
  }
});

// ---------------- fs.browse ----------------

test("fs.browse: not-implemented envelope (native dialog lives at the facade layer)", async () => {
  const { call, byId } = build();
  const res = await call("fs.browse", { title: "Pick a folder" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "not-implemented");
  assert.match(res.error.message, /dialog/i);

  // no-params is fine too (title is optional)
  const noTitle = await call("fs.browse", {});
  assert.equal(noTitle.error.code, "not-implemented");

  // bad input is still rejected BEFORE the not-implemented answer
  const bad = await call("fs.browse", { title: 42 });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.equal(byId["fs.browse"].schema({ title: 42 }).ok, false);
  assert.equal(byId["fs.browse"].schema({}).ok, true);
});

// ---------------- registry dispatch (real envelope wrapping) ----------------

test("registry dispatch: success wraps {ok:true,result}; errors pass through", async () => {
  registerAll();

  const places = await reg.dispatch({ kind: "bridge", id: "fs.places", params: {} });
  assert.equal(places.ok, true);
  assert.ok(Array.isArray(places.result.places));

  const reveal = await reg.dispatch({ kind: "bridge", id: "fs.reveal", params: { path: "/tmp/z.txt" } });
  assert.deepEqual(reveal, { ok: true, result: { path: path.normalize("/tmp/z.txt") } });

  const open = await reg.dispatch({ kind: "bridge", id: "fs.open", params: { path: "/tmp/o.txt" } });
  assert.deepEqual(open, { ok: true, result: { path: "/tmp/o.txt" } });

  const badOpen = await reg.dispatch({ kind: "bridge", id: "fs.open", params: {} });
  assert.equal(badOpen.ok, false);
  assert.equal(badOpen.error.code, "bad-params");

  const badReveal = await reg.dispatch({ kind: "bridge", id: "fs.reveal", params: { path: "rel" } });
  assert.equal(badReveal.ok, false);
  assert.equal(badReveal.error.code, "bad-params");

  const badPathForFile = await reg.dispatch({ kind: "bridge", id: "fs.pathForFile", params: { path: "nope" } });
  assert.equal(badPathForFile.ok, false);
  assert.equal(badPathForFile.error.code, "bad-params");

  const browse = await reg.dispatch({ kind: "bridge", id: "fs.browse", params: {} });
  assert.equal(browse.ok, false);
  assert.equal(browse.error.code, "not-implemented");
});
