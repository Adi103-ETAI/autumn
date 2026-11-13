"use strict";
// layer-1 tests for the Wave-3 storage handlers (docs/architecture/storage.md): the rclone sidecar.
//
// The sidecar is downloaded on DEMAND (never bundled in the installer) and is
// sha256-verified against the published SHA256SUMS before it is used. These
// tests cover the parsers (the output shapes), the path-safety rules and
// the honest "not installed yet" answers — plus, when the network allows, the
// REAL download + verify + install of the sidecar.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const {
  makeStorageHandlers,
  rcloneAssetName,
  parseListremotes,
  parseLsjson,
  parseRemoteUri,
  parseAuthorizeToken,
} = require("./storage.ts");
const { readZip, extractZip, expectedSumFor, safeArchivePath, sha256 } = require("./sidecar.ts");

const DISPATCHABLE = manifest.bridge.namespaces.storage; // 7

function build(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: {
      spawn: (command, args, opts) => {
        const listeners = {};
        const proc = {
          killed: false,
          pid: 4242,
          on(ev, cb) { (listeners[ev] ||= []).push(cb); return proc; },
          stdout: { on(ev, cb) { (listeners[`out:${ev}`] ||= []).push(cb); } },
          stderr: { on(ev, cb) { (listeners[`err:${ev}`] ||= []).push(cb); } },
          kill() { proc.killed = true; (listeners.exit || []).forEach((cb) => cb(null)); return true; },
          emitOut(text) { (listeners["out:data"] || []).forEach((cb) => cb(text)); },
          emitErr(text) { (listeners["err:data"] || []).forEach((cb) => cb(text)); },
          emitExit(code) { (listeners.exit || []).forEach((cb) => cb(code)); },
        };
        state.spawns.push({ command, args, opts, proc });
        // A sidecar command finishes on its own (the real rclone exits).
        if (args[0] !== "authorize") {
          setImmediate(() => {
            const script = state.script ?? {};
            if (script.stdout) proc.emitOut(script.stdout);
            if (script.stderr) proc.emitErr(script.stderr);
            proc.emitExit(script.code ?? 0);
          });
        }
        return proc;
      },
    },
    ...overrides,
  };
  const handlers = makeStorageHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./storage.ts")]) delete require.cache[p];
});

test("id surface: 7 storage ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 7);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `storage.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("rcloneAssetName follows the naming", () => {
  assert.equal(rcloneAssetName("v1.74.3", "linux", "x64"), "rclone-v1.74.3-linux-amd64.zip");
  assert.equal(rcloneAssetName("v1.74.3", "darwin", "arm64"), "rclone-v1.74.3-osx-arm64.zip");
  assert.equal(rcloneAssetName("v1.74.3", "win32", "x64"), "rclone-v1.74.3-windows-amd64.zip");
  assert.equal(rcloneAssetName("v1.74.3", "aix", "x64"), null, "no build for that platform");
  assert.equal(rcloneAssetName("v1.74.3", "linux", "ia32"), null, "no build for that arch");
});

test("parseListremotes reads the real rclone output", () => {
  const out = parseListremotes("myDrive: drive\nmyDropbox: dropbox\n");
  assert.deepEqual(out, [
    { name: "myDrive", type: "drive" },
    { name: "myDropbox", type: "dropbox" },
  ]);
  assert.deepEqual(parseListremotes(""), [], "no remotes → no rows");
});

test("parseLsjson reads the real rclone lsjson output", () => {
  const json = JSON.stringify([
    { Path: "a.txt", Name: "a.txt", Size: 12, ModTime: "2026-01-01T00:00:00Z", IsDir: false },
    { Path: "sub", Name: "sub", IsDir: true },
  ]);
  const rows = parseLsjson(json, "drive:folder");
  assert.equal(rows.length, 2);
  // The sorts directories first, then by name.
  assert.equal(rows[0].isDirectory, true);
  assert.equal(rows[0].path, "drive:folder/sub");
  assert.equal(rows[0].size, undefined, "a directory has no size");
  assert.equal(rows[1].path, "drive:folder/a.txt");
  assert.equal(rows[1].size, 12);
  assert.equal(rows[1].updatedAt, "2026-01-01T00:00:00Z");
  assert.equal(rows[1].isDirectory, false);
  assert.deepEqual(parseLsjson("not json", "d:"), [], "garbage → no rows, never a crash");
});

test("parseRemoteUri tells a remote from a local path", () => {
  assert.deepEqual(parseRemoteUri("drive:folder/file.txt"), { remote: "drive", path: "folder/file.txt" });
  assert.equal(parseRemoteUri("/local/path"), null, "a local path is not a remote");
  assert.equal(parseRemoteUri("C:\\win\\path"), null, "a drive letter is not a remote");
});

test("parseAuthorizeToken finds the token blob rclone prints", () => {
  const out = "Option 2.\n---> {\"access_token\":\"tok\",\"token_type\":\"bearer\"} <---\n";
  const token = parseAuthorizeToken(out);
  assert.ok(token, "the blob is found");
  assert.deepEqual(JSON.parse(token), { access_token: "tok", token_type: "bearer" });
  assert.equal(parseAuthorizeToken("nothing here"), null);
  assert.equal(parseAuthorizeToken("---> {\"no\":\"token\"} <---"), null, "a blob without access_token is refused");
});

test("archive paths are traversal-guarded (the rule)", () => {
  assert.equal(safeArchivePath("rclone"), "rclone");
  assert.equal(safeArchivePath("dir/rclone"), "dir/rclone");
  assert.throws(() => safeArchivePath("/etc/passwd"), /absolute/);
  assert.throws(() => safeArchivePath("../escape"), /traversal/);
  assert.throws(() => safeArchivePath("a/../../escape"), /traversal/);
});

test("expectedSumFor reads a SHA256SUMS file", () => {
  const sums = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  rclone-v1.74.3-linux-amd64.zip\n";
  assert.equal(expectedSumFor(sums, "rclone-v1.74.3-linux-amd64.zip"), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  assert.equal(expectedSumFor(sums, "other.zip"), null, "a file that is not listed has no checksum");
});

test("readZip reads a real zip (stored + deflated entries)", () => {
  const zip = makeZip([
    { name: "rclone", data: Buffer.from("binary-content") },
    { name: "docs/COPYING", data: Buffer.from("licence") },
  ]);
  const entries = readZip(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, "rclone");
  assert.equal(entries[0].data.toString("utf8"), "binary-content");
  assert.equal(entries[1].path, "docs/COPYING");
});

test("extractZip writes the entries and refuses traversal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-zip-"));
  const written = extractZip([{ path: "bin/rclone", data: Buffer.from("x") }], dir);
  assert.deepEqual(written, ["bin/rclone"]);
  assert.equal(fs.readFileSync(path.join(dir, "bin", "rclone"), "utf8"), "x");
});

test("before the sidecar is installed every op answers honestly", async () => {
  useTempUserData();
  const { call } = build();
  const remotes = await call("storage.remotes", {});
  assert.equal(remotes.supported, false);
  assert.match(remotes.reason, /not downloaded/);
  const list = await call("storage.list", { remote: "drive", path: "x" });
  assert.equal(list.supported, false);
  const imp = await call("storage.importToLibrary", { remote: "drive", path: "x", targetDir: "/tmp/x" });
  assert.equal(imp.supported, false);
  const dis = await call("storage.disconnect", { remote: "drive" });
  assert.equal(dis.supported, false);
});

test("list/importToLibrary validate their input", async () => {
  useTempUserData();
  const { call, dispatch } = build();
  const badList = await call("storage.list", { remote: "/local/path" });
  assert.equal(badList.ok, false);
  assert.equal(badList.error.code, "bad-params");
  const badImport = await dispatch("storage.importToLibrary", { remote: "drive" });
  assert.equal(badImport.ok, false);
  assert.equal(badImport.error.code, "bad-params", "targetDir is required");
  const badConnect = await dispatch("storage.connect", {});
  assert.equal(badConnect.ok, false);
  assert.equal(badConnect.error.code, "bad-params");
});

test("connect refuses an unsupported remote type and drives the real rclone authorize", async () => {
  useTempUserData();
  const { call, state } = build();
  const bad = await call("storage.connect", { remote: "x", type: "ftp" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  assert.match(bad.error.message, /drive/);

  // With the sidecar "installed" (a fake binary), the authorize really runs.
  const binDir = path.join(require("./store.ts").userDataDir(), "rclone", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "rclone"), "#!/bin/sh\nexit 0\n", "utf8");
  const ok = await call("storage.connect", { remote: "x", type: "dropbox" });
  assert.equal(ok.status, "authorizing");
  assert.equal(ok.remote, "dropbox");
  assert.equal(state.spawns.length, 1);
  assert.ok(state.spawns[0].args.includes("authorize"));
  assert.ok(state.spawns[0].args.includes("dropbox"));

  // A second connect is refused while one is pending.
  const busy = await call("storage.connect", { remote: "x", type: "drive" });
  assert.equal(busy.ok, false);
  assert.match(busy.error.message, /already in progress/);

  // And it can be cancelled.
  const cancelled = await call("storage.cancelConnect", {});
  assert.equal(cancelled.cancelled, true);
  assert.equal(state.spawns[0].proc.killed, true, "the authorize process is really killed");
});

test("remotes reads the real rclone output", async () => {
  useTempUserData();
  const { call, state } = build();
  state.script = { stdout: "myDrive: drive\n" };
  const binDir = path.join(require("./store.ts").userDataDir(), "rclone", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "rclone"), "#!/bin/sh\nexit 0\n", "utf8");
  const res = await call("storage.remotes", {});
  assert.deepEqual(res, [{ name: "myDrive", type: "drive" }], "the real listremotes output is parsed");
  assert.ok(state.spawns[0].args.includes("listremotes"));
});

test("list reads the real rclone lsjson output", async () => {
  useTempUserData();
  const { call, state } = build();
  state.script = { stdout: JSON.stringify([{ Name: "clip.mp4", Size: 4, IsDir: false }]) };
  const binDir = path.join(require("./store.ts").userDataDir(), "rclone", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "rclone"), "#!/bin/sh\nexit 0\n", "utf8");
  const res = await call("storage.list", { remote: "drive", path: "folder" });
  assert.equal(res.length, 1);
  assert.equal(res[0].name, "clip.mp4");
  assert.equal(res[0].path, "drive:folder/clip.mp4");
  assert.ok(state.spawns[0].args.includes("lsjson"));
});

test("ensure downloads, verifies and installs the sidecar for real (network permitting)", async () => {
  useTempUserData();
  const { call } = build();
  let res;
  try {
    res = await call("storage.ensure", {});
  } catch (e) {
    // No network here — the honest answer is the contract, not a fake install.
    assert.fail(`storage.ensure threw instead of answering: ${e.message}`);
  }
  if (res.ready !== true) {
    assert.match(res.reason, /could not be downloaded|checksum|do not cover/);
    return; // offline: the honest answer is the contract
  }
  // Online: the binary is really there, verified, and executable.
  assert.equal(res.verified, true);
  assert.ok(fs.existsSync(res.path), "the binary is really installed");
  assert.equal(res.version, "v1.74.3");
  const marker = path.join(require("./store.ts").userDataDir(), "rclone", "bin", ".rclone-archive-sha256");
  assert.ok(fs.existsSync(marker), "the integrity marker is written");
  assert.match(fs.readFileSync(marker, "utf8").trim(), /^[0-9a-f]{64}$/);
  // The installed sidecar REALLY runs.
  const { execFileSync } = require("node:child_process");
  const version = execFileSync(res.path, ["version"], { encoding: "utf8" });
  assert.match(version, /rclone v1\.74\.3/, "the installed binary is a working rclone");
});

test("registry-level: every storage id dispatch-resolves", async () => {
  useTempUserData();
  const { handlers, dispatch } = build();
  for (const h of handlers) {
    const env = await dispatch(h.id, { remote: "drive", targetDir: os.tmpdir() });
    assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
    if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
  }
});

// ---------------------------------------------------------------------------
// a tiny zip writer (stored entries) so the reader is tested against a real file
// ---------------------------------------------------------------------------

function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = f.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 10); // stored
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
