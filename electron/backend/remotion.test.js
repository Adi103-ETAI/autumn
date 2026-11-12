"use strict";
// layer-1 tests for the remotion bridge ids (doc 32 W2-5 §2h). 7 dispatchable,
// none boundary: create (RE slug+uuid8+"-remotion" + freeChildName nesting),
// compositions (real <Composition id> parse of src/Root.tsx), start/stop/status
// (studio child lifecycle + RE empty-folder cleanup), render (real CLI run →
// verified output file), repair (RE refusal + W2-11 template gate).
// The `remotion` CLI deps ship at W2-11 — until then every CLI op must answer
// honest {supported:false, reason}, never a fake studio or fake mp4.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const { makeRemotionHandlers, findRemotionBin } = require("./remotion.ts");

const DISPATCHABLE = manifest.bridge.namespaces.remotion; // 7

function fakeProc() {
  const ls = {};
  const proc = {
    killed: false,
    pid: 909,
    on(ev, cb) { (ls[ev] ||= []).push(cb); return proc; },
    stderr: { on(ev, cb) { (ls[`stderr:${ev}`] ||= []).push(cb); } },
    kill() { proc.killed = true; (ls.exit || []).forEach((cb) => cb(null)); return true; },
    emitExit(code) { (ls.exit || []).forEach((cb) => cb(code)); },
    emitStderr(s) { (ls["stderr:data"] || []).forEach((cb) => cb(s)); },
    emitError(e) { (ls.error || []).forEach((cb) => cb(e)); },
  };
  return proc;
}

function build(overrides = {}) {
  const state = { emitted: [], spawns: [] };
  const deps = {
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    spawn: {
      spawn: (command, args, opts) => {
        const proc = fakeProc();
        state.spawns.push({ command, args, opts, proc });
        return proc;
      },
    },
    ...overrides,
  };
  const handlers = makeRemotionHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = async (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

async function withProjectsRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-projects-"));
  // The Remotion CLI downloads a ~350 MB headless shell into a project —
  // the temp dir MUST be removed again (a full tmpfs breaks every test).
  require("./store.ts").removeOnExit(dir);
  const saved = process.env.AUTUMN_PROJECTS_DIR;
  process.env.AUTUMN_PROJECTS_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (saved === undefined) delete process.env.AUTUMN_PROJECTS_DIR;
    else process.env.AUTUMN_PROJECTS_DIR = saved;
  }
}

async function withPath(dir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}

/**
 * Run `fn` with the Remotion CLI explicitly absent (AUTUMN_REMOTION_BIN="") —
 * the honest "this machine has no Remotion" state, independent of what is
 * installed on the test box.
 */
async function withoutRemotionCli(fn) {
  const saved = process.env.AUTUMN_REMOTION_BIN;
  process.env.AUTUMN_REMOTION_BIN = "";
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.AUTUMN_REMOTION_BIN;
    else process.env.AUTUMN_REMOTION_BIN = saved;
  }
}

/** A temp dir with a fake `remotion` executable (all platform names). */
function fakeBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-remo-"));
  require("./store.ts").removeOnExit(dir);
  for (const name of ["remotion", "remotion.cmd"]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    try { fs.chmodSync(p, 0o755); } catch { /* win32 */ }
  }
  return dir;
}

beforeEach(() => {
  reg.reset();
  for (const p of [require.resolve("./remotion.ts")]) delete require.cache[p];
});

test("id surface: 7 remotion ids, all in the manifest, none boundary", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 7);
  assert.deepEqual(handlers.map((h) => h.id).sort(), DISPATCHABLE.map((m) => `remotion.${m}`).sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("create: RE slug + uuid8 + '-remotion' under the projects root; the template is scaffolded in", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const folder = await call("remotion.create", {});
    assert.ok(folder.startsWith(root + path.sep));
    assert.match(path.basename(folder), /^autumn-[0-9a-f]{8}-remotion$/);
    assert.ok(fs.existsSync(folder));
    // The bundled template really lands in the project.
    assert.ok(fs.existsSync(path.join(folder, "package.json")));
    assert.ok(fs.existsSync(path.join(folder, "src", "Root.tsx")));
    assert.ok(fs.existsSync(path.join(folder, "src", "index.ts")));
    assert.ok(fs.existsSync(path.join(folder, "remotion.config.ts")));
    const ids = await call("remotion.compositions", folder);
    assert.deepEqual(ids, ["Caption", "PromoCard", "EndCard"], "the template's compositions are really there");

    const named = await call("remotion.create", { name: "My Clip" });
    assert.match(path.basename(named), /^my-clip-[0-9a-f]{8}-remotion$/);

    const parent = path.join(root, "editor-parent");
    fs.mkdirSync(parent, { recursive: true });
    const first = await call("remotion.create", { parent });
    assert.equal(path.basename(first), "video", "empty child name is free");
    fs.writeFileSync(path.join(first, "keep.txt"), "x", "utf8");
    const second = await call("remotion.create", { parent });
    assert.equal(path.basename(second), "video-2", "taken → video-2");
  });
});

test("compositions: [] outside the root and without src/Root.tsx; real id parse when present", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    assert.deepEqual(await call("remotion.compositions", "/etc"), []);

    const folder = path.join(root, "proj");
    fs.mkdirSync(folder, { recursive: true });
    assert.deepEqual(await call("remotion.compositions", folder), [], "no Root.tsx yet");

    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, "src", "Root.tsx"),
      [
        "import { Composition } from \"remotion\";",
        "export const Root = () => (",
        "  <>",
        "    <Composition id=\"Caption\" component={Caption} durationInFrames={90} fps={30} width={1080} height={1920} />",
        "    <Composition id='PromoCard' component={Promo} durationInFrames={60} fps={30} width={1080} height={1080} />",
        "  </>",
        ");",
      ].join("\n"),
      "utf8",
    );
    assert.deepEqual(await call("remotion.compositions", folder), ["Caption", "PromoCard"]);
  });
});

test("start: non-owned → RE error-state; no CLI (empty PATH) → {supported:false} honest W2-11 gate", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const refused = await call("remotion.start", "/etc");
    assert.equal(refused.status, "error");
    assert.match(refused.message, /points outside/);
    assert.match(refused.message, /Video Editor block/);

    const folder = path.join(root, "studio");
    fs.mkdirSync(folder, { recursive: true });
    const gated = await withoutRemotionCli(() => call("remotion.start", folder));
    assert.equal(gated.supported, false, "no CLI → capability absence, not a fake studio");
    assert.match(gated.reason, /Remotion/i);
    assert.equal((await call("remotion.status", folder)).status, "idle", "gate must not leave a running state");
  });
});

test("start: fake CLI → real spawn, running state with port/url; busy returns current state; stop kills + cleans", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call, state } = build();
    const folder = await call("remotion.create", {});
    const bins = fakeBinDir();
    await withPath(bins, async () => {
      const running = await call("remotion.start", { folder, port: 4123 });
      assert.equal(running.status, "running");
      assert.equal(running.port, 4123);
      assert.equal(running.url, "http://127.0.0.1:4123/");
      assert.equal(state.spawns.length, 1);
      assert.equal(path.basename(state.spawns[0].command), "remotion");
      assert.deepEqual(state.spawns[0].args.slice(0, 2), ["studio", "--port"]);
      assert.equal(state.spawns[0].opts.cwd, folder);

      const status = await call("remotion.status", folder);
      assert.equal(status.running, true);
      assert.equal(status.port, 4123);

      const busy = await call("remotion.start", folder);
      assert.equal(busy.status, "running", "busy → current state untouched");
      assert.equal(state.spawns.length, 1, "no second studio spawned");

      const stopped = await call("remotion.stop", folder);
      assert.equal(stopped.status, "idle");
      assert.equal(stopped.running, false);
      assert.equal(state.spawns[0].proc.killed, true, "the studio child is really killed");
      assert.equal((await call("remotion.status", folder)).running, false);
    });

    // stop on an owned folder that became empty → RE rmSync cleanup. A created
    // project now holds the template, so the cleanup is asserted on a folder
    // that really is empty.
    const doomed = path.join(root, "doomed-project");
    fs.mkdirSync(doomed, { recursive: true });
    await call("remotion.stop", doomed);
    assert.ok(!fs.existsSync(doomed), "empty owned folder removed, like RE");

    void root;
  });
});

test("status: default {status:'idle', running:false} with no folder or unknown folder", async () => {
  useTempUserData();
  const { call } = build();
  assert.deepEqual(await call("remotion.status", {}), { status: "idle", running: false });
  const unknown = await call("remotion.status", "/tmp/never-started-xyz");
  assert.equal(unknown.status, "idle");
  assert.equal(unknown.running, false);
});

test("render: ownership + no-composition + no-CLI gates before any spawn", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call, state } = build();
    const foreign = await call("remotion.render", "/etc");
    assert.equal(foreign.status, "error");
    assert.match(foreign.message, /Autumn does not own this Video folder\./);

    const folder = path.join(root, "renderproj");
    fs.mkdirSync(folder, { recursive: true });
    const noComp = await call("remotion.render", folder);
    assert.match(noComp.message, /No video to render yet/, "RE-style message state, not an envelope");
    assert.equal(noComp.rendering, false);

    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, "src", "Root.tsx"),
      "<Composition id=\"EndCard\" component={End} durationInFrames={30} fps={30} width={1920} height={1080} />",
      "utf8",
    );
    const gated = await withoutRemotionCli(() => call("remotion.render", folder));
    assert.equal(gated.supported, false);
    assert.match(gated.reason, /Remotion/i);
    assert.equal(state.spawns.length, 0, "no spawn on any gate");
  });
});

test("render: real CLI run verifies the output file → {path, bytes, durationMs}; failure → handler-error with stderr tail", async () => {
  const dir = useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call, state } = build();
    const folder = path.join(root, "okproj");
    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, "src", "Root.tsx"),
      "<Composition id=\"Caption\" component={C} durationInFrames={10} fps={30} width={1080} height={1920} />",
      "utf8",
    );
    const bins = fakeBinDir();
    await withPath(bins, async () => {
      const p = call("remotion.render", folder);
      assert.equal(state.spawns.length, 1);
      const { args, proc } = state.spawns[0];
      assert.deepEqual(args.slice(0, 2), ["render", "Caption"], "first parsed id is used");
      const outPath = args[2];
      assert.ok(outPath.startsWith(path.join(dir, "remotion") + path.sep), `output under <userData>/remotion: ${outPath}`);
      fs.writeFileSync(outPath, "MP4DATA", "utf8");
      proc.emitExit(0);
      const res = await p;
      assert.equal(res.path, outPath);
      assert.equal(res.bytes, 7);
      assert.ok(res.durationMs >= 0);
      assert.ok(res.jobId);
      assert.equal(res.composition, "Caption");

      // failure path: exit non-zero with stderr tail
      const failFolder = path.join(root, "failproj");
      fs.mkdirSync(path.join(failFolder, "src"), { recursive: true });
      fs.writeFileSync(path.join(failFolder, "src", "Root.tsx"), "<Composition id=\"X\" />", "utf8");
      const fp = call("remotion.render", failFolder);
      state.spawns[1].proc.emitStderr("Error: bundle failed\n");
      state.spawns[1].proc.emitExit(1);
      const err = await fp;
      assert.equal(err.ok, false);
      assert.equal(err.error.code, "handler-error");
      assert.match(err.error.message, /exited 1/);
      assert.match(err.error.message, /bundle failed/);
    });
  });
});

test("render: positional (folder, composition) — composition must not be read as the folder", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call, state } = build();
    const folder = path.join(root, "posproj");
    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(path.join(folder, "src", "Root.tsx"), "<Composition id=\"Auto\" />", "utf8");
    const bins = fakeBinDir();
    await withPath(bins, async () => {
      const p = call("remotion.render", { args: [folder, "Manual"] });
      assert.equal(state.spawns.length, 1);
      assert.equal(state.spawns[0].args[1], "Manual", "explicit composition wins over the parsed one");
      fs.writeFileSync(state.spawns[0].args[2], "X", "utf8");
      state.spawns[0].proc.emitExit(0);
      const res = await p;
      assert.equal(res.composition, "Manual");
    });
  });
});

test("repair: no package.json → RE refusal; a broken project really gets the template back", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const { call } = build();
    const foreign = await call("remotion.repair", "/etc");
    assert.equal(foreign.status, "error");
    assert.match(foreign.message, /Autumn cannot repair this Video project\./);

    const bare = path.join(root, "bareproj");
    fs.mkdirSync(bare, { recursive: true });
    const noPkg = await call("remotion.repair", bare);
    assert.equal(noPkg.status, "error");
    assert.match(noPkg.message, /Autumn cannot repair this Video project\./);

    // A project that lost its sources is really repaired (idempotent).
    const pkg = path.join(root, "pkgproj");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "pkgproj" }), "utf8");
    const repaired = await call("remotion.repair", pkg);
    assert.ok(repaired.repaired.length > 0, "the missing template files are really copied back");
    assert.ok(repaired.repaired.includes("src/Root.tsx"));
    assert.ok(fs.existsSync(path.join(pkg, "src", "Root.tsx")));
    assert.ok(fs.existsSync(path.join(pkg, "remotion.config.ts")));

    const again = await call("remotion.repair", pkg);
    assert.deepEqual(again.repaired, [], "repair is idempotent — nothing missing the second time");
  });
});

test("registry-level: every remotion id dispatch-resolves", async () => {
  useTempUserData();
  await withProjectsRoot(async () => {
    const { handlers, dispatch } = build();
    for (const h of handlers) {
      const env = await dispatch(h.id, {});
      assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
      if (!env.ok) assert.ok(!/^no handler for /.test(env.error.message), `${h.id}: ${env.error.message}`);
    }
  });
});

test("findRemotionBin: project-local bin first, then PATH, then the app's own install", async () => {
  useTempUserData();
  await withProjectsRoot(async (root) => {
    const folder = path.join(root, "binproj");
    fs.mkdirSync(path.join(folder, "node_modules", ".bin"), { recursive: true });
    const local = path.join(folder, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
    fs.writeFileSync(local, "#!/bin/sh\nexit 0\n", "utf8");
    try { fs.chmodSync(local, 0o755); } catch { /* win32 */ }

    assert.equal(findRemotionBin(folder), local, "project-local bin wins");
    fs.rmSync(path.join(folder, "node_modules"), { recursive: true, force: true });

    const bins = fakeBinDir();
    await withPath(bins, () => {
      const viaPath = findRemotionBin(folder);
      assert.ok(viaPath, "falls back to PATH");
      assert.equal(path.basename(viaPath).replace(/\.cmd$/, ""), "remotion");
    });

    // The app's own install is the last resort (it ships with autumn).
    const appBin = path.join(__dirname, "..", "..", "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
    if (fs.existsSync(appBin)) {
      const viaApp = findRemotionBin(folder);
      assert.ok(viaApp, "the app's own Remotion install is used as the last resort");
    }

    // AUTUMN_REMOTION_BIN pins the CLI — an empty value means "none here".
    assert.equal(await withoutRemotionCli(() => findRemotionBin(folder)), null, "explicitly no CLI → null");
    const pinned = path.join(folder, "pinned-remotion");
    fs.writeFileSync(pinned, "#!/bin/sh\nexit 0\n", "utf8");
    const saved = process.env.AUTUMN_REMOTION_BIN;
    process.env.AUTUMN_REMOTION_BIN = pinned;
    try {
      assert.equal(findRemotionBin(folder), pinned, "the override wins");
    } finally {
      if (saved === undefined) delete process.env.AUTUMN_REMOTION_BIN;
      else process.env.AUTUMN_REMOTION_BIN = saved;
    }
  });
});
