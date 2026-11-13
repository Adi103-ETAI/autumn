"use strict";
// Layer-1 units for the fs namespace (docs/architecture/finder.md): the whole-machine finder.
//
// Everything here is REAL: the listings, the previews, the search, the
// rename/move/copy/trash/mkdir really touch the disk (in a temp dir), and
// the content search really drives a `rg` process (scripted here, so the
// parsing is asserted without needing ripgrep installed).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register"); // transpile ./fs.ts on require
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { makeFsHandlers, safeName, sanitizePath, trashFolder } = require("./fs.ts");

const DISPATCHABLE = manifest.bridge.namespaces.fs; // 12

/** Build the handler table over a FAKE deps object. */
function build(overrides = {}) {
  const state = { revealed: [], opened: [], trashed: [], rgCalls: [] };
  const deps = {
    shell: {
      showItemInFolder: (p) => state.revealed.push(p),
      openPath: async (p) => {
        state.opened.push(p);
        return "";
      },
      openExternal: async () => {},
      trashItem: async (p) => {
        state.trashed.push(p);
      },
    },
    spawn: {
      spawn: (command, args) => {
        state.rgCalls.push({ command, args });
        const listeners = {};
        const proc = {
          on(ev, cb) { (listeners[ev] ||= []).push(cb); return proc; },
          stdout: { on(ev, cb) { (listeners[`out:${ev}`] ||= []).push(cb); } },
          stderr: { on(ev, cb) { (listeners[`err:${ev}`] ||= []).push(cb); } },
          kill() { return true; },
        };
        setImmediate(() => {
          const out = state.rgOut;
          if (out) (listeners["out:data"] || []).forEach((cb) => cb(out));
          (listeners.exit || []).forEach((cb) => cb(0));
        });
        return proc;
      },
    },
    ...overrides,
  };
  const handlers = makeFsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

/** A temp directory tree for the finder to work on. */
function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-finder-"));
  fs.mkdirSync(path.join(dir, "zeta-dir"));
  fs.mkdirSync(path.join(dir, "alpha-dir"));
  fs.writeFileSync(path.join(dir, "zeta-dir", "note.txt"), "hello needle world\n", "utf8");
  fs.writeFileSync(path.join(dir, "alpha-dir", "other.md"), "# nothing here\n", "utf8");
  fs.writeFileSync(path.join(dir, ".hidden"), "secret\n", "utf8");
  fs.writeFileSync(path.join(dir, "needle.txt"), "a needle in a haystack\n", "utf8");
  return dir;
}

beforeEach(() => reg.reset());

// ---------------- id surface ----------------

test("id surface: exactly the 12 manifest fs ids", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 12);
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    DISPATCHABLE.map((m) => `fs.${m}`).sort(),
  );
  for (const h of handlers) {
    assert.equal(h.kind, "bridge");
    assert.ok(h.description.includes("params:"), `${h.id}: description must document the param shape`);
    assert.ok(reg.inManifest("bridge", h.id), `${h.id}: must exist in manifest bridge namespace fs`);
  }
});

// ---------------- fs.places ----------------

test("fs.places: the places — the folders that really exist", async () => {
  const { call } = build();
  const res = await call("fs.places", {});
  assert.ok(Array.isArray(res.places));
  const names = res.places.map((p) => p.name);
  assert.ok(names.includes("Home"));
  for (const place of res.places) {
    assert.ok(path.isAbsolute(place.path), `${place.name} path is absolute`);
    assert.ok(fs.existsSync(place.path), `${place.name} really exists`);
  }
});

test("fs.places: the project folder is added when it exists", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.places", { projectPath: dir });
  const project = res.places.find((p) => p.path === dir);
  assert.ok(project, "the project folder is listed");
  assert.equal(project.name, `📁 ${path.basename(dir)}`);
});

// ---------------- fs.browse ----------------

test("fs.browse: really lists ONE directory — directories first, then the name", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.browse", { path: dir });
  assert.equal(res.path, dir);
  const names = res.entries.map((e) => e.name);
  assert.deepEqual(names, ["alpha-dir", "zeta-dir", "needle.txt"], "directories first, hidden excluded");
  const dirEntry = res.entries[0];
  assert.equal(dirEntry.isDirectory, true);
  assert.equal(dirEntry.size, undefined, "a directory has no size");
  assert.ok(dirEntry.updatedAt, "the mtime is reported");
  const fileEntry = res.entries.find((e) => e.name === "needle.txt");
  assert.equal(fileEntry.isDirectory, false);
  assert.equal(fileEntry.size, 23, "the real byte size of the file");
});

test("fs.browse: showHidden reveals the dot files", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.browse", { path: dir, showHidden: true });
  assert.ok(res.entries.some((e) => e.name === ".hidden"));
});

test("fs.browse: a file (not a directory) and a relative path are refused", async () => {
  const dir = makeTree();
  const { call, byId } = build();
  const notADir = await call("fs.browse", { path: path.join(dir, "needle.txt") });
  assert.equal(notADir.ok, false);
  assert.equal(notADir.error.code, "handler-error");
  assert.match(notADir.error.message, /Not a directory/);
  const relative = await call("fs.browse", { path: "relative/dir" });
  assert.equal(relative.error.code, "bad-params");
  assert.equal(byId["fs.browse"].schema({ path: "relative" }).ok, false);
});

// ---------------- fs.preview ----------------

test("fs.preview: a text file comes back as text", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.preview", { path: path.join(dir, "needle.txt") });
  assert.equal(res.kind, "text");
  assert.match(res.content, /needle in a haystack/);
  assert.equal(res.truncated, false);
  assert.equal(res.ext, "txt");
});

test("fs.preview: an image comes back as a data URL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-img-"));
  // A 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(dir, "dot.png"), png);
  const { call } = build();
  const res = await call("fs.preview", { path: path.join(dir, "dot.png") });
  assert.equal(res.kind, "image");
  assert.match(res.dataUrl, /^data:image\/png;base64,/);
});

test("fs.preview: a binary file is reported as binary, never as text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-bin-"));
  fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
  const { call } = build();
  const res = await call("fs.preview", { path: path.join(dir, "blob.bin") });
  assert.equal(res.kind, "binary");
  assert.equal(res.size, 5);
});

test("fs.preview: a missing file and a directory are refused", async () => {
  const dir = makeTree();
  const { call } = build();
  const missing = await call("fs.preview", { path: path.join(dir, "nope.txt") });
  assert.equal(missing.error.code, "handler-error");
  assert.match(missing.error.message, /Not a file/);
  const isDir = await call("fs.preview", { path: path.join(dir, "zeta-dir") });
  assert.match(isDir.error.message, /Not a file/);
});

// ---------------- fs.search ----------------

test("fs.search: the name matches and the content matches are merged", async () => {
  const dir = makeTree();
  const { call, state } = build();
  state.rgOut = `${path.join(dir, "alpha-dir", "other.md")}:1:found the needle here\n`;
  const res = await call("fs.search", { path: dir, query: "needle" });
  const names = res.map((h) => h.name).sort();
  assert.ok(names.includes("needle.txt"), "the name match is found");
  assert.ok(names.includes("other.md"), "the content match is found");
  const contentHit = res.find((h) => h.name === "other.md");
  assert.equal(contentHit.line, 1);
  assert.equal(contentHit.snippet, "found the needle here");
  assert.equal(state.rgCalls.length, 1);
  assert.equal(state.rgCalls[0].command, "rg");
  assert.ok(state.rgCalls[0].args.includes("--"), "the query is passed after --");
});

test("fs.search: an empty query returns nothing and never spawns rg", async () => {
  const dir = makeTree();
  const { call, state } = build();
  const res = await call("fs.search", { path: dir, query: "   " });
  assert.deepEqual(res, []);
  assert.equal(state.rgCalls.length, 0);
});

test("fs.search: hidden files are skipped unless showHidden", async () => {
  const dir = makeTree();
  const { call } = build();
  const without = await call("fs.search", { path: dir, query: "hidden" });
  assert.equal(without.length, 0);
  const with_ = await call("fs.search", { path: dir, query: "hidden", showHidden: true });
  assert.ok(with_.some((h) => h.name === ".hidden"));
});

test("fs.search: a relative root is refused", async () => {
  const { call } = build();
  const res = await call("fs.search", { path: "relative", query: "x" });
  assert.equal(res.error.code, "bad-params");
});

// ---------------- fs.reveal / fs.open ----------------

test("fs.reveal: delegates to shell.showItemInFolder", async () => {
  const { call, state } = build();
  const want = path.normalize("/tmp/some-file.txt");
  const res = await call("fs.reveal", { path: want });
  assert.deepEqual(res, { path: want });
  assert.deepEqual(state.revealed, [want]);
});

test("fs.open: really opens the path with the OS and reports the OS's error", async () => {
  const { call, state } = build();
  const res = await call("fs.open", { path: "/tmp/o.txt" });
  assert.equal(res.opened, true);
  assert.deepEqual(state.opened, ["/tmp/o.txt"]);

  const failing = build({
    shell: {
      showItemInFolder: () => {},
      openPath: async () => "Failed to open path",
      openExternal: async () => {},
    },
  });
  const res2 = await failing.call("fs.open", { path: "/tmp/o.txt" });
  assert.equal(res2.opened, false);
  assert.match(res2.error, /Failed to open/);
});

test("fs.reveal / fs.open / fs.pathForFile: relative/empty/NUL/non-string -> bad-params", async () => {
  const { call, byId, state } = build();
  for (const id of ["fs.reveal", "fs.open", "fs.pathForFile"]) {
    for (const params of [{}, { path: "" }, { path: "relative.txt" }, { path: "/a\0b" }, { path: null }]) {
      const res = await call(id, params);
      assert.equal(res.ok, false, `${id} ${JSON.stringify(params)}`);
      assert.equal(res.error.code, "bad-params");
      assert.equal(byId[id].schema(params).ok, false);
    }
  }
  assert.deepEqual(state.revealed, []);
  assert.deepEqual(state.opened, []);
});

// ---------------- fs.rename ----------------

test("fs.rename: really renames the file", async () => {
  const dir = makeTree();
  const { call } = build();
  const from = path.join(dir, "needle.txt");
  const res = await call("fs.rename", { path: from, newName: "renamed.txt" });
  assert.equal(res.path, path.join(dir, "renamed.txt"));
  assert.ok(fs.existsSync(res.path), "the new file is really there");
  assert.ok(!fs.existsSync(from), "the old file is really gone");
});

test("fs.rename: a name with a separator is refused, an existing destination collides", async () => {
  const dir = makeTree();
  const { call } = build();
  const from = path.join(dir, "needle.txt");
  const sep = await call("fs.rename", { path: from, newName: "a/b.txt" });
  assert.equal(sep.error.code, "bad-params");
  const dotdot = await call("fs.rename", { path: from, newName: ".." });
  assert.equal(dotdot.error.code, "bad-params");
  const collide = await call("fs.rename", { path: from, newName: ".hidden" });
  assert.equal(collide.error.code, "handler-error");
  assert.match(collide.error.message, /already exists/);
});

test("fs.rename: a missing file is reported, not invented", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.rename", { path: path.join(dir, "ghost.txt"), newName: "x.txt" });
  assert.equal(res.error.code, "handler-error");
  assert.match(res.error.message, /Not found/);
});

// ---------------- fs.move ----------------

test("fs.move: really moves the files into the folder", async () => {
  const dir = makeTree();
  const target = path.join(dir, "zeta-dir");
  const { call } = build();
  const res = await call("fs.move", { paths: [path.join(dir, "needle.txt")], destDir: target });
  assert.equal(res.moved, 1);
  assert.deepEqual(res.collisions, []);
  assert.deepEqual(res.failed, []);
  assert.ok(fs.existsSync(path.join(target, "needle.txt")), "the file really moved");
  assert.ok(!fs.existsSync(path.join(dir, "needle.txt")));
});

test("fs.move: a collision is reported, never silent", async () => {
  const dir = makeTree();
  const target = path.join(dir, "zeta-dir");
  fs.writeFileSync(path.join(target, "needle.txt"), "already here", "utf8");
  const { call } = build();
  const res = await call("fs.move", { paths: [path.join(dir, "needle.txt")], destDir: target });
  assert.equal(res.moved, 0);
  assert.deepEqual(res.collisions, ["needle.txt"]);
  assert.ok(fs.existsSync(path.join(dir, "needle.txt")), "the source is untouched");
});

test("fs.move: a missing destination is refused", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.move", { paths: [path.join(dir, "needle.txt")], destDir: path.join(dir, "nope") });
  assert.equal(res.error.code, "handler-error");
  assert.match(res.error.message, /not a folder/i);
});

// ---------------- fs.copyInto ----------------

test("fs.copyInto: really copies — the source stays", async () => {
  const dir = makeTree();
  const target = path.join(dir, "zeta-dir");
  const { call } = build();
  const res = await call("fs.copyInto", { paths: [path.join(dir, "needle.txt")], destDir: target });
  assert.equal(res.moved, 1);
  assert.ok(fs.existsSync(path.join(target, "needle.txt")));
  assert.ok(fs.existsSync(path.join(dir, "needle.txt")), "the source is untouched");
});

test("fs.copyInto: a directory really recurses", async () => {
  const dir = makeTree();
  const target = path.join(dir, "zeta-dir");
  const { call } = build();
  const res = await call("fs.copyInto", { paths: [path.join(dir, "alpha-dir")], destDir: target });
  assert.equal(res.moved, 1);
  assert.ok(fs.existsSync(path.join(target, "alpha-dir", "other.md")));
});

// ---------------- fs.trash ----------------

test("fs.trash: uses the OS trash when the shell provides one", async () => {
  const dir = makeTree();
  const { call, state } = build();
  const res = await call("fs.trash", { paths: [path.join(dir, "needle.txt")] });
  assert.equal(res.trashed, 1);
  assert.deepEqual(state.trashed, [path.join(dir, "needle.txt")]);
});

test("fs.trash: falls back to the platform's trash folder", async () => {
  const dir = makeTree();
  const trashHome = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-trash-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = trashHome;
  try {
    // A shell WITHOUT trashItem → the fallback runs.
    const noShell = build({
      shell: { showItemInFolder: () => {}, openPath: async () => "", openExternal: async () => {} },
    });
    const res = await noShell.call("fs.trash", { paths: [path.join(dir, "needle.txt")] });
    if (process.platform === "win32") {
      assert.equal(res.trashed, 0, "Windows has no portable trash folder without the OS shell");
      assert.equal(res.failed.length, 1);
    } else {
      assert.equal(res.trashed, 1);
      assert.ok(!fs.existsSync(path.join(dir, "needle.txt")), "the file really left");
      const folder = trashFolder();
      assert.ok(folder && fs.existsSync(path.join(folder, "needle.txt")), "the file is in the trash");
    }
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
  }
});

// ---------------- fs.mkdir ----------------

test("fs.mkdir: really creates the folder", async () => {
  const dir = makeTree();
  const { call } = build();
  const res = await call("fs.mkdir", { parentDir: dir, name: "new-folder" });
  assert.equal(res.path, path.join(dir, "new-folder"));
  assert.ok(fs.statSync(res.path).isDirectory(), "the folder really exists");
});

test("fs.mkdir: an existing name and a separator are refused", async () => {
  const dir = makeTree();
  const { call } = build();
  const exists = await call("fs.mkdir", { parentDir: dir, name: "zeta-dir" });
  assert.equal(exists.error.code, "handler-error");
  assert.match(exists.error.message, /Already exists/);
  const sep = await call("fs.mkdir", { parentDir: dir, name: "a/b" });
  assert.equal(sep.error.code, "bad-params");
  const notAFolder = await call("fs.mkdir", { parentDir: path.join(dir, "needle.txt"), name: "x" });
  assert.equal(notAFolder.error.code, "handler-error");
});

// ---------------- the pure helpers ----------------

test("safeName is the rule", () => {
  assert.equal(safeName("ok.txt"), "ok.txt");
  assert.equal(safeName("  spaced  "), "spaced");
  assert.throws(() => safeName(""), /Invalid name/);
  assert.throws(() => safeName("."), /Invalid name/);
  assert.throws(() => safeName(".."), /Invalid name/);
  assert.throws(() => safeName("a/b"), /Invalid name/);
  assert.throws(() => safeName("a\\b"), /Invalid name/);
  assert.throws(() => safeName(42), /Invalid name/);
});

test("sanitizePath normalizes and refuses the bad ones", () => {
  assert.equal(sanitizePath("/a//b/../c"), path.normalize("/a/c"));
  assert.equal(sanitizePath("relative"), null);
  assert.equal(sanitizePath("/a\0b"), null);
  assert.equal(sanitizePath(""), null);
});

// ---------------- registry dispatch (real envelope wrapping) ----------------

test("registry dispatch: success wraps {ok:true,result}; errors pass through", async () => {
  const dir = makeTree();
  const { dispatch } = build();
  const places = await dispatch("fs.places", {});
  assert.equal(places.ok, true);
  assert.ok(Array.isArray(places.result.places));

  const browse = await dispatch("fs.browse", { path: dir });
  assert.equal(browse.ok, true);
  assert.ok(browse.result.entries.length > 0);

  const badOpen = await dispatch("fs.open", {});
  assert.equal(badOpen.ok, false);
  assert.equal(badOpen.error.code, "bad-params");

  const badPathForFile = await dispatch("fs.pathForFile", { path: "nope" });
  assert.equal(badPathForFile.ok, false);
  assert.equal(badPathForFile.error.code, "bad-params");
});

test("registry dispatch: every fs id resolves to an envelope", async () => {
  const dir = makeTree();
  const { handlers, dispatch } = build();
  for (const h of handlers) {
    const env = await dispatch(h.id, {
      path: dir,
      paths: [path.join(dir, "needle.txt")],
      destDir: path.join(dir, "zeta-dir"),
      parentDir: dir,
      name: "made-folder",
      newName: "renamed.txt",
      query: "needle",
    });
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    assert.ok(!/^no handler for /.test(env.error?.message ?? ""), `${h.id}: ${env.error?.message}`);
  }
});
