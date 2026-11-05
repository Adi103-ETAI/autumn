"use strict";
// layer-1 tests for the skills bridge ids (doc 32 W2-2). Real temp fixtures.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const { useTempUserData } = require("./store.ts");
const { makeSkillsHandlers, scanSkills } = require("./skills.ts");

const EXPECTED_IDS = ["skills.installed", "skills.sync"];

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeSkillsHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

/** Create a fake project root with a skills dir (per the RE on-disk model). */
function mkProject(t, withSkills = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w2-skills-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (withSkills) {
    fs.mkdirSync(path.join(dir, ".claude", "skills", "pdf-tools"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "skills", "pdf-tools", "SKILL.md"),
      "# PDF Tools\n\nExtracts text from PDFs.\n",
    );
    fs.mkdirSync(path.join(dir, ".claude", "skills", "web-cloner"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "skills", "web-cloner", "README.md"),
      "Website cloning helper.\n",
    );
    // A non-dir file in the skills dir must be ignored.
    fs.writeFileSync(path.join(dir, ".claude", "skills", "IGNORE_ME.txt"), "not a skill");
  }
  return dir;
}

beforeEach(() => reg.reset());

test("id surface: the 2 renderer-used skills ids, all in the manifest", () => {
  useTempUserData();
  const { handlers } = build();
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers.map((h) => h.id).sort(), [...EXPECTED_IDS].sort());
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id));
});

test("scanSkills discovers dir-based skills and ignores files", async (t) => {
  const root = mkProject(t);
  const found = scanSkills([root]);
  assert.equal(found.length, 2);
  const byId = Object.fromEntries(found.map((s) => [s.id, s]));
  assert.equal(byId[".claude/skills/pdf-tools"].name, "pdf-tools");
  assert.equal(byId[".claude/skills/pdf-tools"].description, "PDF Tools");
  assert.equal(byId[".claude/skills/web-cloner"].description, "Website cloning helper.");
  assert.ok(!found.some((s) => s.path.endsWith("IGNORE_ME.txt")));
});

test("scanSkills finds nothing on an empty root (never fabricates)", async (t) => {
  const root = mkProject(t, false);
  assert.deepEqual(scanSkills([root]), []);
});

test("skills.installed returns discovered skills + starters", async (t) => {
  const root = mkProject(t);
  const { call } = build();
  const res = await call("skills.installed", { roots: [root] });
  assert.ok(Array.isArray(res.skills));
  const discovered = res.skills.filter((s) => s.root === root);
  assert.equal(discovered.length, 2, "on-disk skills present");
});

test("skills.sync snapshots installed ids into the store (real)", async (t) => {
  const root = mkProject(t);
  const { call } = build();
  const res = await call("skills.sync", { roots: [root] });
  assert.equal(res.total, 2);
  assert.ok(res.updated >= 0);
  const store = JSON.parse(fs.readFileSync(path.join(process.env.AUTUMN_USER_DATA_DIR, "db", "skills.json"), "utf8"));
  assert.deepEqual([...store].sort(), [".claude/skills/pdf-tools", ".claude/skills/web-cloner"].sort());
  // Second sync: no new rows.
  const again = await call("skills.sync", { roots: [root] });
  assert.equal(again.updated, 0);
});

test("bad roots -> bad-params", async () => {
  const { call } = build();
  assert.equal((await call("skills.installed", {})).error.code, "bad-params");
  assert.equal((await call("skills.installed", { roots: [] })).error.code, "bad-params");
  assert.equal((await call("skills.installed", { roots: ["relative"] })).error.code, "bad-params");
  assert.equal((await call("skills.sync", { roots: "x" })).error.code, "bad-params");
});

test("registry dispatch round-trip wraps payloads", async (t) => {
  const root = mkProject(t);
  reg.reset();
  const handlers = makeSkillsHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "skills.installed", params: { roots: [root] } });
  assert.equal(ok.ok, true);
  assert.ok(Array.isArray(ok.result.skills));
  const bad = await reg.dispatch({ id: "skills.installed", params: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
