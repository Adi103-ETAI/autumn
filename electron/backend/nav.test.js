"use strict";
// layer-1 tests for the nav bridge id (docs/architecture/backend.md W2-1). Real fs against temp fixtures.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeNavHandlers } = require("./nav.ts");

const EXPECTED_IDS = ["nav.detect"];

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeNavHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

function mkFixture(t, recipe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w2-nav-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(recipe)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

beforeEach(() => reg.reset());

test("id surface: nav.detect in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 1);
  assert.ok(reg.inManifest("bridge", "nav.detect"));
});

test("detects a react-navigation project and lists screen files", async (t) => {
  const dir = mkFixture(t, {
    "package.json": JSON.stringify({ name: "demo", dependencies: { "@react-navigation/native": "^6" } }),
    "src/screens/Home.tsx": "export default function Home(){}",
    "src/screens/Settings.tsx": "export default function Settings(){}",
    "node_modules/x/y.tsx": "// ignored",
  });
  const { call } = build();
  const res = await call("nav.detect", { projectPath: dir });
  assert.equal(res.framework, "react-navigation");
  const screens = res.screens.find((s) => s.dir === "src/screens");
  assert.ok(screens, "screens dir detected");
  assert.ok(screens.files.some((f) => f.endsWith("Home.tsx")));
  assert.ok(screens.files.some((f) => f.endsWith("Settings.tsx")));
  assert.ok(!screens.files.some((f) => f.includes("node_modules")));
});

test("detects flutter via pubspec.yaml", async (t) => {
  const dir = mkFixture(t, { "pubspec.yaml": "name: demo\n" });
  const { call } = build();
  const res = await call("nav.detect", { projectPath: dir });
  assert.equal(res.framework, "flutter");
});

test("empty/plain project -> framework unknown, empty routeDirs/screens, no fabrication", async (t) => {
  const dir = mkFixture(t, { "README.md": "hi" });
  const { call } = build();
  const res = await call("nav.detect", { projectPath: dir });
  assert.equal(res.framework, "unknown");
  assert.deepEqual(res.routeDirs, []);
  assert.deepEqual(res.screens, []);
});

test("custom screens param overrides the defaults", async (t) => {
  const dir = mkFixture(t, { "ui/Main.tsx": "x", "src/screens/A.tsx": "y" });
  const { call } = build();
  const res = await call("nav.detect", { projectPath: dir, screens: ["ui"] });
  assert.equal(res.screens.length, 1);
  assert.equal(res.screens[0].dir, "ui");
  assert.ok(res.screens[0].files.some((f) => f.endsWith("Main.tsx")));
});

test("bad params -> bad-params envelope", async () => {
  const { call } = build();
  assert.equal((await call("nav.detect", { projectPath: "relative/path" })).error.code, "bad-params");
  assert.equal((await call("nav.detect", { projectPath: "/definitely/not/here/w2-test" })).error.code, "bad-params");
  assert.equal((await call("nav.detect", { projectPath: "/tmp", screens: "nope" })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads", async (t) => {
  const dir = mkFixture(t, { "README.md": "hi" });
  reg.reset();
  const handlers = makeNavHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "nav.detect", params: { projectPath: dir } });
  assert.equal(ok.ok, true);
  const bad = await reg.dispatch({ id: "nav.detect", params: { projectPath: "relative" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
