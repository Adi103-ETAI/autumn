"use strict";
// Wave-1 layer-1 tests for the files bridge ids (doc 29 §T, doc 31 §5).
// REAL fs against fs.mkdtemp fixtures — no mocking of the filesystem.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const { makeFilesHandlers } = require("./files.ts");

const EXPECTED_IDS = [
  "files.addToLibrary","files.assetPath","files.closeBufferChoice","files.copyInto",
  "files.createDirectory","files.createFile","files.editorIdentity","files.ensureCanvasDesign",
  "files.exists","files.importAssets","files.importFolder","files.list","files.listAssets",
  "files.listFolders","files.listProjectResources","files.listTree","files.materializeAssets",
  "files.moveEntry","files.mutationIdentity","files.openFileNode","files.openIn","files.openTargets",
  "files.pathForFile","files.read","files.readAssetThumbnail","files.readDocument",
  "files.readImageThumbnail","files.readProjectThumbnail","files.releaseFileNode","files.removeFolder",
  "files.renameEntry","files.revealEntry","files.saveAttachment","files.scaffoldScreen",
  "files.trashEntry","files.write","files.writeDocument",
];

function build(overrides = {}) {
  const state = { emitted: [], shown: [], opened: [] };
  const deps = {
    fs: fs.promises,
    shell: {
      openPath: async (p) => { state.opened.push(p); return ""; },
      showItemInFolder: (p) => { state.shown.push(p); },
      openExternal: async () => {},
      ...(overrides.shell || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    ...overrides,
  };
  const handlers = makeFilesHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

function mkTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w1-files-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("id surface: exactly the 37 renderer-used files ids, all in the manifest", () => {
  const { handlers, byId } = build();
  assert.equal(handlers.length, 37);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  const reg = require("../ipc/registry");
  for (const h of handlers) {
    assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
    assert.match(h.description, /params:/);
  }
});

test("files.write/read/exists round-trip writes for real and emits onFileNodeChanged", async (t) => {
  const dir = mkTmp(t);
  const target = path.join(dir, "sub", "note.txt");
  const { call, state } = build();

  const w = await call("files.write", { path: target, content: "hello autumn" });
  assert.equal(w.ok, true);
  assert.equal(fs.readFileSync(target, "utf8"), "hello autumn");
  assert.deepEqual(state.emitted, [["files.onFileNodeChanged", { path: target, change: "created" }]]);

  const r = await call("files.read", { path: target });
  assert.equal(r.content, "hello autumn");

  const e = await call("files.exists", { path: target });
  assert.deepEqual(e, { exists: true, type: "file" });
});

test("files.list sorts dirs first then files, alphabetical", async (t) => {
  const dir = mkTmp(t);
  fs.writeFileSync(path.join(dir, "b.txt"), "");
  fs.writeFileSync(path.join(dir, "a.txt"), "hey");
  fs.mkdirSync(path.join(dir, "zdir"));
  const { call } = build();
  const res = await call("files.list", { dir });
  assert.deepEqual(res.items.map((i) => i.name), ["zdir", "a.txt", "b.txt"]);
  assert.equal(res.items[1].size, 3);
});

test("files.listTree is bounded and returns rel paths", async (t) => {
  const dir = mkTmp(t);
  fs.mkdirSync(path.join(dir, "one"));
  fs.writeFileSync(path.join(dir, "one", "two.txt"), "x");
  const { call } = build();
  const res = await call("files.listTree", { dir, depth: 2 });
  const rels = res.items.map((i) => i.rel);
  assert.ok(rels.includes("one"));
  assert.ok(rels.includes(path.join("one", "two.txt")));
});

test("files.createFile refuses to overwrite; files.createDirectory is recursive", async (t) => {
  const dir = mkTmp(t);
  const target = path.join(dir, "keep.txt");
  fs.writeFileSync(target, "original", "utf8");
  const { call, state } = build();

  const dupe = await call("files.createFile", { path: target });
  assert.equal(dupe.ok, false);
  assert.equal(dupe.error.code, "handler-error");
  assert.equal(fs.readFileSync(target, "utf8"), "original");

  const created = await call("files.createFile", { path: path.join(dir, "fresh.txt"), content: "new" });
  assert.equal(created.ok, true);

  const mkdir = await call("files.createDirectory", { path: path.join(dir, "deep", "deeper") });
  assert.equal(mkdir.ok, true);
  assert.equal(mkdir.created, true);

  const emitted = state.emitted.filter(([id]) => id === "files.onFileNodeChanged");
  assert.ok(emitted.length >= 2);
});

test("files.renameEntry / moveEntry move files for real and emit renamed", async (t) => {
  const dir = mkTmp(t);
  const from = path.join(dir, "old.txt");
  fs.writeFileSync(from, "data", "utf8");
  const to = path.join(dir, "nested", "new.txt");
  const { call, state } = build();

  const res = await call("files.renameEntry", { path: from, to });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.readFileSync(to, "utf8"), "data");

  const moved = await call("files.moveEntry", { path: to, to: path.join(dir, "moved.txt") });
  assert.equal(moved.ok, true);
  assert.equal(fs.existsSync(path.join(dir, "moved.txt")), true);

  assert.deepEqual(
    state.emitted.filter(([id]) => id === "files.onFileNodeChanged").map(([, p]) => p.change),
    ["renamed", "renamed"],
  );
});

test("files.trashEntry moves into .autumn-trash with a timestamp suffix", async (t) => {
  const dir = mkTmp(t);
  const target = path.join(dir, "doomed.txt");
  fs.writeFileSync(target, "x", "utf8");
  const { call, state } = build();

  const res = await call("files.trashEntry", { path: target });
  assert.equal(res.ok, true);
  assert.match(res.path, /\.autumn-trash[\/\\]doomed\.txt\./);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(res.path), true);
  assert.deepEqual(state.emitted, [["files.onFileNodeChanged", { path: target, change: "deleted", to: res.path }]]);
});

test("files.removeFolder refuses home/root and deletes for real", async (t) => {
  const dir = mkTmp(t);
  const victim = path.join(dir, "victim");
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, "x.txt"), "x");
  const { call } = build();

  const refuse = await call("files.removeFolder", { path: os.tmpdir() });
  assert.equal(refuse.error.code, "bad-params");

  const res = await call("files.removeFolder", { path: victim });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(victim), false);
});

test("files.copyInto copies a directory recursively", async (t) => {
  const src = mkTmp(t);
  const dest = mkTmp(t);
  fs.mkdirSync(path.join(src, "nested"));
  fs.writeFileSync(path.join(src, "nested", "file.txt"), "copy me", "utf8");
  const { call, state } = build();

  const res = await call("files.copyInto", { source: src, dir: dest });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(dest, path.basename(src), "nested", "file.txt"), "utf8"), "copy me");
  assert.deepEqual(state.emitted, [["files.onFileNodeChanged", { path: res.path, change: "created" }]]);
});

test("files.readDocument parses JSON; invalid JSON -> bad-params; files.writeDocument round-trips", async (t) => {
  const dir = mkTmp(t);
  const doc = path.join(dir, "doc.json");
  const { call, state } = build();

  const bad = await call("files.readDocument", { path: doc });
  assert.equal(bad.error.code, "not-found");

  fs.writeFileSync(doc, "{not json", "utf8");
  const invalid = await call("files.readDocument", { path: doc });
  assert.equal(invalid.error.code, "bad-params");

  const w = await call("files.writeDocument", { path: doc, document: { a: 1, list: [1, 2] } });
  assert.equal(w.ok, true);
  const read = await call("files.readDocument", { path: doc });
  assert.deepEqual(read.document, { a: 1, list: [1, 2] });
  assert.deepEqual(state.emitted.map(([, p]) => p.change), ["modified"]);
});

test("pathForFile / assetPath reject traversal and relative paths", async () => {
  const { call } = build();
  assert.equal((await call("files.pathForFile", { path: "relative.txt" })).error.code, "bad-params");
  assert.equal((await call("files.pathForFile", { path: "/tmp/ok.txt" })).path, "/tmp/ok.txt");
  assert.equal((await call("files.assetPath", { name: "../../etc/passwd" })).error.code, "bad-params");
  assert.equal((await call("files.assetPath", { dir: "/tmp/assets", name: "img.png" })).path, path.join("/tmp/assets", "img.png"));
});

test("bad-params for missing/invalid paths across handlers; not-found for ghost files", async (t) => {
  const dir = mkTmp(t);
  const { call } = build();
  for (const id of ["files.list", "files.exists", "files.read", "files.write", "files.createFile",
    "files.createDirectory", "files.renameEntry", "files.moveEntry", "files.trashEntry",
    "files.removeFolder", "files.revealEntry", "files.editorIdentity", "files.mutationIdentity",
    "files.openFileNode", "files.readImageThumbnail", "files.readDocument", "files.readProjectThumbnail"]) {
    const res = await call(id, { path: "relative/path" });
    assert.equal(res.ok, false, id);
    assert.equal(res.error.code, "bad-params", id);
  }
  const ghost = await call("files.read", { path: path.join(dir, "ghost.txt") });
  assert.equal(ghost.error.code, "not-found");
});

test("editor-buffer ids are honest derivations or documented no-ops", async (t) => {
  const dir = mkTmp(t);
  const f = path.join(dir, "x.txt");
  fs.writeFileSync(f, "x", "utf8");
  const { call } = build();

  const identity = await call("files.editorIdentity", { path: f });
  assert.equal(identity.size, 1);
  assert.equal(typeof identity.changeId, "string");

  const opened = await call("files.openFileNode", { path: f });
  assert.match(opened.ref, /^ref-/);
  const missing = await call("files.openFileNode", { path: path.join(dir, "ghost") });
  assert.equal(missing.error.code, "not-found");

  assert.deepEqual(await call("files.releaseFileNode", { path: f }), { ok: true });
  assert.deepEqual(await call("files.closeBufferChoice", { path: f }), { ok: true });
  const targets = await call("files.openTargets", { path: f });
  assert.equal(targets.targets.length, 1);
  assert.equal(targets.targets[0].id, "default");
});

test("thumbnail ids never invent bytes: {thumbnail:null} + not-found", async (t) => {
  const dir = mkTmp(t);
  const f = path.join(dir, "img.png");
  fs.writeFileSync(f, "png", "utf8");
  const { call } = build();
  for (const id of ["files.readImageThumbnail", "files.readAssetThumbnail", "files.readProjectThumbnail"]) {
    const res = await call(id, { path: f });
    assert.equal(res.thumbnail, null, id);
    assert.equal(res.exists, true, id);
    const missing = await call(id, { path: path.join(dir, "ghost.png") });
    assert.equal(missing.error.code, "not-found", id);
  }
});

test("importAssets/importFolder/materializeAssets copy real files", async (t) => {
  const src = mkTmp(t);
  const dst = mkTmp(t);
  fs.writeFileSync(path.join(src, "a.png"), "A", "utf8");
  fs.writeFileSync(path.join(src, "b.txt"), "B", "utf8"); // non-asset ext, ignored by importAssets? b.txt is not in ASSET_EXT but importAssets copies ALL files
  fs.mkdirSync(path.join(src, "nested"));
  fs.writeFileSync(path.join(src, "nested", "n.txt"), "N", "utf8");

  const { call } = build();
  const imp = await call("files.importAssets", { sourceDir: src, targetDir: path.join(dst, "assets") });
  assert.equal(imp.imported, 2); // regular files only, nested dir skipped

  const folder = await call("files.importFolder", { source: src, targetDir: dst });
  assert.equal(folder.ok, true);
  assert.equal(fs.existsSync(path.join(folder.path, "nested", "n.txt")), true);

  const mat = await call("files.materializeAssets", {
    dir: path.join(dst, "mat"),
    assets: [{ name: "one.txt", content: "1" }, { name: "two.txt", content: "2" }],
  });
  assert.equal(mat.materialized, 2);

  const traversal = await call("files.materializeAssets", {
    dir: dst,
    assets: [{ name: "../escape.txt", content: "x" }],
  });
  assert.equal(traversal.error.code, "bad-params");
});

test("files.addToLibrary is an honest empty result (no store, no fake success)", async () => {
  const { call } = build();
  const res = await call("files.addToLibrary", { paths: ["/tmp/x"] });
  assert.deepEqual(res, { supported: false, added: 0, reason: "autumn has no asset-library store" });
});

test("files.scaffoldScreen creates a real component file", async (t) => {
  const dir = mkTmp(t);
  const { call, state } = build();
  const res = await call("files.scaffoldScreen", { dir, name: "Settings Panel!" });
  assert.equal(res.ok, true);
  const tsx = res.files.find((f) => f.endsWith("Screen.tsx"));
  assert.match(fs.readFileSync(tsx, "utf8"), /function Settings-panelScreen\(/);
  assert.deepEqual(state.emitted.map(([id, p]) => [id, p.change]).sort(), [
    ["files.onFileNodeChanged", "created"],
    ["files.onFileNodeChanged", "created"],
  ]);
});

test("files.saveAttachment writes utf8 and base64; name traversal rejected", async (t) => {
  const dir = mkTmp(t);
  const { call } = build();
  const utf8 = await call("files.saveAttachment", { dir, name: "note.txt", content: "hello" });
  assert.equal(fs.readFileSync(utf8.path, "utf8"), "hello");
  const b64 = await call("files.saveAttachment", { dir, name: "bin.bin", content: Buffer.from("abc").toString("base64"), encoding: "base64" });
  assert.deepEqual(fs.readFileSync(b64.path), Buffer.from("abc"));
  const bad = await call("files.saveAttachment", { dir, name: "../evil.txt", content: "x" });
  assert.equal(bad.error.code, "bad-params");
});

test("registry dispatch round-trip wraps plain payloads and passes envelopes through", async (t) => {
  const dir = mkTmp(t);
  const reg = require("../ipc/registry");
  reg.reset();
  const handlers = makeFilesHandlers({
    fs: fs.promises,
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    emit: () => {},
    now: () => Date.now(),
  });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });

  const ok = await reg.dispatch({ id: "files.exists", params: { path: dir } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { exists: true, type: "dir" });

  const bad = await reg.dispatch({ id: "files.exists", params: { path: "relative" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  reg.reset();
});
