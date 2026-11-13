"use strict";
// Layer-1 units for the os namespace — clipboard / find / thumbnails (docs/architecture/backend.md).
// Headless: no Electron — deps.clipboard and deps.screen are FAKES that record
// calls and control their return values; find.* runs against REAL fs in
// fs.mkdtemp dirs with distinct mtimes; at least one test round-trips through
// the REAL registry (dispatch wraps plain payloads, passes envelopes through).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register"); // transpile ./os.ts on require
const reg = require("../ipc/registry");
const { makeOsHandlers } = require("./os.ts");

// find.* runs against the REAL fs (docs/architecture/backend.md allows fs.mkdtemp for fs tests).
const realFs = require("node:fs/promises");

/** Exactly the 7 renderer-used os bridge ids (renderer-usage.md). */
const IDS = [
  "clipboard.readImagePath",
  "clipboard.readText",
  "clipboard.writeText",
  "find.candidates",
  "find.rank",
  "find.recent",
  "thumbnails.capture",
];

/** Build the handler table over FAKE deps; `state` records interactions. */
function build(overrides = {}) {
  const state = {
    writtenText: [],
    readTextCalls: 0,
    readImageCalls: 0,
    captureCalls: 0,
    emitted: [],
  };
  const deps = {
    clipboard: {
      text: "",
      image: null,
      readText() {
        state.readTextCalls += 1;
        return this.text;
      },
      writeText(t) {
        state.writtenText.push(t);
      },
      readImage() {
        state.readImageCalls += 1;
        return this.image;
      },
      ...(overrides.clipboard || {}),
    },
    screen: {
      result: "data:image/png;base64,AAAA",
      async capture() {
        state.captureCalls += 1;
        return this.result;
      },
      ...(overrides.screen || {}),
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    fs: realFs, // REAL fs/promises for the find.* walk (tmp dirs)
    ...(overrides.deps || {}),
  };
  const handlers = makeOsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call, state };
}

/** Register the whole set on the REAL registry (dispatch-level checks). */
function registerAll() {
  // screen forced to null so thumbnails.capture exercises its not-implemented path
  const { handlers } = build({ screen: { result: null } });
  for (const h of handlers) {
    reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
}

/** Fresh tmp dir, removed when the test ends. */
function mkTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-w1-os-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Create a file and pin its mtime (seconds) so ordering assertions are exact. */
function writeFileAt(dir, name, content, mtimeSec) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  fs.utimesSync(p, mtimeSec, mtimeSec);
  return p;
}

beforeEach(() => reg.reset());

// ---------------- id surface ----------------

test("id surface: exactly the 7 renderer-used os ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 7, "exactly 7 handlers");
  assert.deepEqual(handlers.map((h) => h.id).sort(), IDS, "no extra/renamed ids");
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(h.description.includes("params:"), `${h.id}: description must document the param shape`);
    assert.ok(reg.inManifest("bridge", h.id), `${h.id}: must exist in a manifest bridge namespace`);
  }
});

// ---------------- clipboard.writeText / readText ----------------

test("clipboard.writeText: delegates to deps.clipboard.writeText and reports length", async () => {
  const { call, state } = build();
  assert.deepEqual(await call("clipboard.writeText", { text: "hello" }), { ok: true, length: 5 });
  assert.deepEqual(state.writtenText, ["hello"]);
});

test("clipboard.writeText: non-string / empty text -> bad-params (schema agrees)", async () => {
  const { call, byId, state } = build();
  for (const params of [{}, { text: 42 }, { text: "" }, { text: null }]) {
    const res = await call("clipboard.writeText", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["clipboard.writeText"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.deepEqual(state.writtenText, []); // clipboard untouched
});

test("clipboard.readText: real read through deps.clipboard.readText", async () => {
  const { call, state } = build({ clipboard: { text: "from os clipboard" } });
  assert.deepEqual(await call("clipboard.readText", {}), { text: "from os clipboard" });
  assert.equal(state.readTextCalls, 1);
});

// ---------------- clipboard.readImagePath ----------------

test("clipboard.readImagePath: no image on the clipboard -> not-found", async () => {
  const { call, state } = build(); // image: null
  const res = await call("clipboard.readImagePath", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "not-found");
  assert.match(res.error.message, /no image on clipboard/);
  assert.equal(state.readImageCalls, 1); // a real read was attempted
});

test("clipboard.readImagePath: image -> real PNG written under os.tmpdir(), exists verified", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const { call } = build({ clipboard: { image: { toPNG: () => png } } });
  const res = await call("clipboard.readImagePath", {});
  try {
    assert.equal(res.exists, true);
    assert.ok(path.isAbsolute(res.path));
    assert.ok(res.path.startsWith(os.tmpdir()), "written to the OS temp dir");
    assert.ok(path.basename(res.path).startsWith("autumn-clipboard-"), "unique default name");
    assert.ok(res.path.endsWith(".png"));
    assert.deepEqual(fs.readFileSync(res.path), png); // bytes on disk match toPNG()
  } finally {
    fs.rmSync(res.path, { force: true }); // no litter in tmpdir
  }
});

test("clipboard.readImagePath: explicit path is written there instead", async (t) => {
  const dir = mkTmp(t);
  const dest = path.join(dir, "clip.png");
  const png = Buffer.from("PNG-BYTES");
  const { call, state } = build({ clipboard: { image: { toPNG: () => png } } });
  const res = await call("clipboard.readImagePath", { path: dest });
  assert.deepEqual(res, { path: dest, exists: true });
  assert.deepEqual(fs.readFileSync(dest), png);
  assert.equal(state.readImageCalls, 1);
});

test("clipboard.readImagePath: bad path param -> bad-params before touching the clipboard", async () => {
  const { call, byId, state } = build({ clipboard: { image: { toPNG: () => Buffer.from("x") } } });
  for (const params of [{ path: "" }, { path: 42 }, { path: "a\0b" }, { path: null }]) {
    const res = await call("clipboard.readImagePath", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["clipboard.readImagePath"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.equal(state.readImageCalls, 0);
});

// ---------------- thumbnails.capture ----------------

test("thumbnails.capture: returns the data-URL from deps.screen.capture", async () => {
  const { call, state } = build();
  assert.deepEqual(await call("thumbnails.capture", {}), { dataUrl: "data:image/png;base64,AAAA" });
  assert.equal(state.captureCalls, 1);
  // width/height are accepted (advisory — injected capture() takes no size arg)
  assert.deepEqual(await call("thumbnails.capture", { width: 320, height: 200 }), {
    dataUrl: "data:image/png;base64,AAAA",
  });
  assert.equal(state.captureCalls, 2);
});

test("thumbnails.capture: null capture (headless) -> not-implemented, no invented bytes", async () => {
  const { call } = build({ screen: { result: null } });
  const res = await call("thumbnails.capture", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "not-implemented");
  assert.ok(!("dataUrl" in res), "no fabricated image payload");
  assert.match(res.error.message, /desktopCapturer|display/i);
});

test("thumbnails.capture: non-numeric width/height -> bad-params (schema agrees)", async () => {
  const { call, byId } = build();
  for (const params of [{ width: "320" }, { height: -5 }, { width: 0 }]) {
    const res = await call("thumbnails.capture", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["thumbnails.capture"].schema(params).ok, false, JSON.stringify(params));
  }
  assert.equal(byId["thumbnails.capture"].schema({ width: 640 }).ok, true);
});

// ---------------- find.recent ----------------

test("find.recent: bounded walk over real fs, sorted mtimeMs desc with sizes", async (t) => {
  const dir = mkTmp(t);
  const older = writeFileAt(dir, "older.txt", "old", 1700000000);
  const mid = writeFileAt(dir, "mid.txt", "mid", 1700000100);
  const newer = writeFileAt(dir, "newer.txt", "newer-content", 1700000200);
  const sub = path.join(dir, "sub");
  fs.mkdirSync(sub);
  const nested = writeFileAt(sub, "nested.txt", "n", 1700000300);

  const { call } = build();
  const res = await call("find.recent", { dir });
  assert.deepEqual(
    res.items.map((i) => i.path),
    [nested, newer, mid, older],
    "newest first, nested dirs walked",
  );
  for (const item of res.items) {
    assert.equal(typeof item.mtimeMs, "number");
    assert.equal(typeof item.size, "number");
  }
  assert.equal(res.items.find((i) => i.path === newer).size, "newer-content".length);

  const capped = await call("find.recent", { dir, limit: 2 });
  assert.deepEqual(capped.items.map((i) => i.path), [nested, newer], "limit caps the newest slice");
});

test("find.recent: default dir is the process cwd (bounded walk, not homedir)", async (t) => {
  const dir = mkTmp(t);
  const file = writeFileAt(dir, "cwd-file.txt", "x", 1700000000);
  const { call } = build();
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const res = await call("find.recent", {});
    assert.deepEqual(res.items.map((i) => i.path), [file]);
  } finally {
    process.chdir(prev);
  }
});

test("find.recent: missing dir -> { items: [] }; bad params -> bad-params", async () => {
  const { call, byId } = build();
  const missing = path.join(os.tmpdir(), `autumn-no-such-dir-${Date.now()}`);
  assert.deepEqual(await call("find.recent", { dir: missing }), { items: [] });
  for (const params of [{ dir: 42 }, { dir: "" }, { limit: "many" }, { limit: 0 }]) {
    const res = await call("find.recent", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["find.recent"].schema(params).ok, false, JSON.stringify(params));
  }
});

// ---------------- find.candidates ----------------

test("find.candidates: case-insensitive basename match with documented scores", async (t) => {
  const dir = mkTmp(t);
  writeFileAt(dir, "alpha-notes.md", "a", 1700000000);
  writeFileAt(dir, "Beta-log.txt", "b", 1700000100);
  writeFileAt(dir, "gamma.txt", "g", 1700000200);
  const sub = path.join(dir, "nested");
  fs.mkdirSync(sub);
  writeFileAt(sub, "alpha-2.txt", "n", 1700000300);

  const { call } = build();

  // prefix (80) beats nothing else; tie between root + nested breaks by path asc
  const alpha = await call("find.candidates", { query: "alpha", dir });
  assert.deepEqual(
    alpha.items.map((i) => ({ base: path.basename(i.path), score: i.score })),
    [
      { base: "alpha-notes.md", score: 80 },
      { base: "alpha-2.txt", score: 80 },
    ],
  );

  // case-insensitive: uppercase query still matches "Beta-log.txt"
  const beta = await call("find.candidates", { query: "BETA", dir });
  assert.deepEqual(beta.items, [
    { path: path.join(dir, "Beta-log.txt"), score: 80 },
  ]);

  // exact basename -> 100
  const exact = await call("find.candidates", { query: "gamma.txt", dir });
  assert.deepEqual(exact.items, [{ path: path.join(dir, "gamma.txt"), score: 100 }]);

  // limit + no match
  assert.equal((await call("find.candidates", { query: "alpha", dir, limit: 1 })).items.length, 1);
  assert.deepEqual(await call("find.candidates", { query: "zzz-nope", dir }), { items: [] });
});

test("find.candidates: missing dir -> { items: [] }; bad params -> bad-params", async () => {
  const { call, byId } = build();
  const missing = path.join(os.tmpdir(), `autumn-no-such-dir-${Date.now()}`);
  assert.deepEqual(await call("find.candidates", { query: "x", dir: missing }), { items: [] });
  for (const params of [{}, { query: "" }, { query: 42 }, { query: "a", dir: 7 }, { query: "a", limit: "3" }]) {
    const res = await call("find.candidates", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["find.candidates"].schema(params).ok, false, JSON.stringify(params));
  }
});

// ---------------- find.rank ----------------

test("find.rank: pure scorer — exact 100 / prefix 80 / contains 60 / none 0", async () => {
  const { call } = build();
  const res = await call("find.rank", {
    query: "alpha",
    items: [
      { path: "/x/beta.txt" }, // 0
      { path: "/x/notes-alpha.md" }, // 60
      { path: "/x/alpha" }, // 100
      { path: "/x/alpha-2.txt" }, // 80
    ],
  });
  assert.deepEqual(res.items, [
    { path: "/x/alpha", score: 100 },
    { path: "/x/alpha-2.txt", score: 80 },
    { path: "/x/notes-alpha.md", score: 60 },
    { path: "/x/beta.txt", score: 0 },
  ]);
  // scoring is case-insensitive on the basename only
  const ci = await call("find.rank", { query: "BETA", items: [{ path: "/d/Beta-log.txt" }] });
  assert.deepEqual(ci.items, [{ path: "/d/Beta-log.txt", score: 80 }]);
});

test("find.rank: empty or missing items -> { items: [] }; bad params -> bad-params", async () => {
  const { call, byId } = build();
  assert.deepEqual(await call("find.rank", { query: "a" }), { items: [] });
  assert.deepEqual(await call("find.rank", { query: "a", items: [] }), { items: [] });
  for (const params of [
    { items: [{ path: "/x/a" }] }, // no query
    { query: "" },
    { query: 42 },
    { query: "a", items: "nope" },
    { query: "a", items: [{}] },
    { query: "a", items: [{ path: 5 }] },
  ]) {
    const res = await call("find.rank", params);
    assert.equal(res.ok, false, JSON.stringify(params));
    assert.equal(res.error.code, "bad-params");
    assert.equal(byId["find.rank"].schema(params).ok, false, JSON.stringify(params));
  }
});

// ---------------- registry dispatch (real envelope wrapping) ----------------

test("registry dispatch: plain payloads wrap; not-found/not-implemented pass through", async () => {
  registerAll();

  const write = await reg.dispatch({ kind: "bridge", id: "clipboard.writeText", params: { text: "hi" } });
  assert.deepEqual(write, { ok: true, result: { ok: true, length: 2 } });

  const read = await reg.dispatch({ kind: "bridge", id: "clipboard.readText", params: {} });
  assert.deepEqual(read, { ok: true, result: { text: "" } });

  const badWrite = await reg.dispatch({ kind: "bridge", id: "clipboard.writeText", params: { text: 7 } });
  assert.equal(badWrite.ok, false);
  assert.equal(badWrite.error.code, "bad-params");

  // fake clipboard has no image -> deliberate not-found envelope
  const noImage = await reg.dispatch({ kind: "bridge", id: "clipboard.readImagePath", params: {} });
  assert.equal(noImage.ok, false);
  assert.equal(noImage.error.code, "not-found");
  assert.match(noImage.error.message, /no image on clipboard/);

  // fake screen returns null -> deliberate not-implemented envelope
  const cap = await reg.dispatch({ kind: "bridge", id: "thumbnails.capture", params: {} });
  assert.equal(cap.ok, false);
  assert.equal(cap.error.code, "not-implemented");

  const rank = await reg.dispatch({
    kind: "bridge",
    id: "find.rank",
    params: { query: "a", items: [{ path: "/x/a" }, { path: "/x/b" }] },
  });
  assert.deepEqual(rank, {
    ok: true,
    result: { items: [{ path: "/x/a", score: 100 }, { path: "/x/b", score: 0 }] },
  });

  const badRank = await reg.dispatch({ kind: "bridge", id: "find.rank", params: { items: [] } });
  assert.equal(badRank.ok, false);
  assert.equal(badRank.error.code, "bad-params");
});

// ---------------- no fabricated events ----------------

test("no events are emitted (find has no real trigger for events.onBrowserFind)", async (t) => {
  const dir = mkTmp(t);
  writeFileAt(dir, "e.txt", "x", 1700000000);
  const { call, state } = build();
  await call("find.recent", { dir });
  await call("find.candidates", { query: "e", dir });
  await call("find.rank", { query: "e", items: [{ path: "/x/e" }] });
  await call("clipboard.writeText", { text: "x" });
  await call("clipboard.readText", {});
  assert.deepEqual(state.emitted, []);
});
