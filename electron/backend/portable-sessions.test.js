"use strict";
// layer-1 tests for the portable-session layer (doc 35 §5): the sessions the
// OTHER agents wrote on this machine.
//
// The stores are REAL: the test lays out the RE's directory layouts in a temp
// dir (Claude Code, Codex, Pi, Amp, Grok) and the discovery really reads
// them — the titles, the cwds, the sizes and the content hits all come out of
// the actual files.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("../ts-register");
const { useTempUserData } = require("./store.ts");

const {
  defaultRoots,
  discoverPortableSessions,
  searchPortableSessions,
  searchTranscriptLines,
  folderFacts,
  folderFactRoots,
  readSessionLibrary,
  writeSessionLibrary,
  libraryEntryKey,
  claudeFiles,
  codexFiles,
  piFiles,
  ampFiles,
  grokFiles,
  titleFromChunk,
  extractCwd,
  codexCwdFromChunk,
  piCwdFromChunk,
  ampMetaFromChunk,
  fallbackTitle,
  PORTABLE_HARNESSES,
} = require("./portable-sessions.ts");

const CLAUDE_UUID = "11111111-2222-3333-4444-555555555555";
const CODEX_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Lay out the RE's store layouts in a temp dir and point the roots at it. */
function makeStores() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-stores-"));
  const claudeRoot = path.join(home, ".claude");
  const codexRoot = path.join(home, ".codex");
  const piRoot = path.join(home, ".pi-sessions");
  const ampRoot = path.join(home, "amp-threads");
  const grokHome = path.join(home, ".grok");
  const grokRoot = path.join(grokHome, "sessions");

  // Claude Code: <root>/projects/<project>/<uuid>.jsonl
  const claudeDir = path.join(claudeRoot, "projects", "-home-user-proj");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, `${CLAUDE_UUID}.jsonl`),
    [
      JSON.stringify({ type: "summary", summary: "Claude summary title" }),
      JSON.stringify({ type: "user", message: { content: "a claude needle" } }),
    ].join("\n") + "\n" + "x".repeat(600),
    "utf8",
  );

  // Codex: <root>/sessions/<y>/<m>/<d>/<uuid>.jsonl
  const codexDir = path.join(codexRoot, "sessions", "2026", "01", "02");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, `${CODEX_UUID}.jsonl`),
    [
      JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ text: "codex needle" }] } }),
    ].join("\n") + "\n" + "y".repeat(600),
    "utf8",
  );

  // Pi: <root>/<dir>/<name>_<id>.jsonl
  const piDir = path.join(piRoot, "somedir");
  fs.mkdirSync(piDir, { recursive: true });
  fs.writeFileSync(
    path.join(piDir, "run_abcdef.jsonl"),
    [
      JSON.stringify({ type: "session", cwd: "/tmp" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "pi hello" } }),
    ].join("\n") + "\n" + "z".repeat(600),
    "utf8",
  );

  // Amp: <root>/T-<id>.json
  fs.mkdirSync(ampRoot, { recursive: true });
  fs.writeFileSync(
    path.join(ampRoot, "T-ampthread.json"),
    JSON.stringify({ title: "Amp thread title", env: { initial: { trees: [{ uri: "file:///tmp" }] } } }) + " ".repeat(600),
    "utf8",
  );

  // Grok: <root>/<cwdDir>/<sessionId>/{summary.json,chat_history.jsonl}
  const grokDir = path.join(grokRoot, "cwdhash", "groksession1");
  fs.mkdirSync(grokDir, { recursive: true });
  fs.writeFileSync(
    path.join(grokDir, "summary.json"),
    JSON.stringify({ info: { cwd: "/tmp", title: "Grok thread title" } }),
    "utf8",
  );
  fs.writeFileSync(path.join(grokDir, "chat_history.jsonl"), JSON.stringify({ role: "user", content: "grok hello" }) + "\n" + "q".repeat(600), "utf8");

  process.env.CLAUDE_CONFIG_DIR = claudeRoot;
  process.env.CODEX_HOME = codexRoot;
  process.env.PI_CODING_AGENT_SESSION_DIR = piRoot;
  process.env.AMP_THREADS_DIR = ampRoot;
  process.env.GROK_HOME = grokHome;
  return { home, claudeRoot, codexRoot, piRoot, ampRoot, grokRoot };
}

const ENV_KEYS = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_SESSION_DIR", "AMP_THREADS_DIR", "GROK_HOME"];

beforeEach(() => {
  useTempUserData();
  for (const key of ENV_KEYS) delete process.env[key];
});

// ---------------------------------------------------------------------------
// the roots
// ---------------------------------------------------------------------------

test("defaultRoots honours the environment overrides (the RE's)", () => {
  process.env.CLAUDE_CONFIG_DIR = "/claude";
  process.env.CODEX_HOME = "/codex";
  process.env.PI_CODING_AGENT_SESSION_DIR = "/pi";
  process.env.AMP_THREADS_DIR = "/amp";
  process.env.GROK_HOME = "/grok";
  const roots = defaultRoots("/home/user");
  assert.equal(roots.claudeRoot, "/claude");
  assert.equal(roots.codexRoot, "/codex");
  assert.equal(roots.piRoot, "/pi");
  assert.equal(roots.ampRoot, "/amp");
  assert.equal(roots.grokRoot, path.join("/grok", "sessions"));
});

test("defaultRoots falls back to the home folders", () => {
  const roots = defaultRoots("/home/user");
  assert.equal(roots.claudeRoot, path.join("/home/user", ".claude"));
  assert.equal(roots.codexRoot, path.join("/home/user", ".codex"));
  assert.equal(roots.piRoot, path.join("/home/user", ".pi", "agent", "sessions"));
  assert.equal(roots.grokRoot, path.join("/home/user", ".grok", "sessions"));
});

// ---------------------------------------------------------------------------
// the discovery
// ---------------------------------------------------------------------------

test("the discovery finds every harness' sessions, with the real titles and cwds", () => {
  makeStores();
  const sessions = discoverPortableSessions(defaultRoots(), new Set());
  assert.ok(sessions.length >= 5, `expected the 5 stores to be found, got ${sessions.length}`);
  const byHarness = Object.fromEntries(sessions.map((s) => [s.harness, s]));

  assert.equal(byHarness.claude_code.title, "Claude summary title");
  assert.equal(byHarness.codex.cwd, "/tmp");
  assert.equal(byHarness.pi.cwd, "/tmp");
  assert.equal(byHarness.amp.title, "Amp thread title");
  assert.equal(byHarness.amp.cwd, "/tmp");
  assert.equal(byHarness.grok.title, "Grok thread title");
  for (const s of sessions) {
    assert.ok(s.sizeBytes > 0, `${s.sessionId} has a real size`);
    assert.ok(s.lastActive > 0, `${s.sessionId} has a real mtime`);
    assert.equal(typeof s.cwdExists, "boolean");
  }
});

test("the discovery marks the sessions autumn already tracks", () => {
  makeStores();
  const sessions = discoverPortableSessions(defaultRoots(), new Set([CLAUDE_UUID]));
  const claude = sessions.find((s) => s.harness === "claude_code");
  assert.equal(claude.tracked, true);
  const codex = sessions.find((s) => s.harness === "codex");
  assert.equal(codex.tracked, false);
});

test("a file smaller than the RE's floor is skipped", () => {
  const stores = makeStores();
  fs.writeFileSync(path.join(stores.claudeRoot, "projects", "-home-user-proj", "tiny.jsonl"), "{}", "utf8");
  const sessions = discoverPortableSessions(defaultRoots(), new Set());
  assert.equal(sessions.some((s) => s.sessionId === "tiny"), false);
});

test("the per-harness file readers follow the RE's layouts", () => {
  const stores = makeStores();
  assert.equal(claudeFiles(stores.claudeRoot).length, 1);
  assert.equal(claudeFiles(stores.claudeRoot)[0].sessionId, CLAUDE_UUID);
  assert.equal(codexFiles(stores.codexRoot).length, 1);
  assert.equal(codexFiles(stores.codexRoot)[0].sessionId, CODEX_UUID);
  assert.equal(piFiles(stores.piRoot).length, 1);
  assert.equal(piFiles(stores.piRoot)[0].sessionId, "abcdef");
  assert.equal(ampFiles(stores.ampRoot).length, 1);
  assert.equal(ampFiles(stores.ampRoot)[0].sessionId, "T-ampthread");
  assert.equal(grokFiles(stores.grokRoot).length, 1);
  assert.equal(grokFiles(stores.grokRoot)[0].sessionId, "groksession1");
  // A missing store is simply empty.
  assert.deepEqual(claudeFiles("/nope/nothing"), []);
});

// ---------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------

test("the search finds the content hits AND the metadata hits", async () => {
  makeStores();
  const byContent = await searchPortableSessions("needle", defaultRoots(), new Set());
  assert.ok(byContent.length >= 2, "both the claude and the codex transcript match");
  const claude = byContent.find((s) => s.harness === "claude_code");
  assert.ok(claude.hits.length > 0, "the transcript lines are really returned");
  assert.match(claude.hits[0], /needle/);

  const byTitle = await searchPortableSessions("Grok thread", defaultRoots(), new Set());
  assert.ok(byTitle.some((s) => s.harness === "grok"), "a title match is found");
});

test("an empty pattern lists everything with no hits", async () => {
  makeStores();
  const all = await searchPortableSessions("   ", defaultRoots(), new Set());
  assert.ok(all.length >= 5);
  for (const s of all) assert.deepEqual(s.hits, []);
});

test("searchTranscriptLines returns the matching lines", () => {
  const text = "one\ntwo needle\nthree\nfour needle\n";
  const hits = searchTranscriptLines(text, "needle");
  assert.equal(hits.length, 2);
  assert.match(hits[0], /two needle/);
  assert.deepEqual(searchTranscriptLines(text, "nothing"), []);
});

// ---------------------------------------------------------------------------
// the parsers
// ---------------------------------------------------------------------------

test("the transcript parsers are the RE's", () => {
  assert.equal(extractCwd('{"cwd":"/home/x"}'), "/home/x");
  assert.equal(extractCwd("no cwd here"), null);
  assert.equal(codexCwdFromChunk('{"type":"session_meta","payload":{"cwd":"/c"}}'), "/c");
  assert.equal(piCwdFromChunk('{"type":"session","cwd":"/p"}'), "/p");
  const amp = ampMetaFromChunk('{"title":"T","env":{"initial":{"trees":[{"uri":"file:///a/b"}]}}}');
  assert.equal(amp.title, "T");
  assert.equal(amp.cwd, "/a/b");
  assert.equal(titleFromChunk('{"type":"summary","summary":"S"}', "claude_code"), "S");
  assert.equal(titleFromChunk('{"type":"message","message":{"role":"user","content":"hi"}}', "pi"), "hi");
  assert.equal(fallbackTitle("/home/user/project"), "Session in project");
  assert.equal(fallbackTitle(null), "Untitled session");
});

// ---------------------------------------------------------------------------
// the library file
// ---------------------------------------------------------------------------

test("the library index is written and read back", () => {
  const dir = useTempUserData();
  assert.deepEqual(readSessionLibrary(), [], "no index yet");
  writeSessionLibrary([
    { sessionId: "s1", sourceId: "claude_code", title: "One", lastActive: 5, harness: "claude_code" },
    { sessionId: "s2", sourceId: "codex", title: "Two", lastActive: 6, harness: "codex" },
  ]);
  const rows = readSessionLibrary();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "One");
  assert.ok(fs.existsSync(path.join(dir, "session-library.json")));
  assert.equal(libraryEntryKey(rows[0]), "claude_code claude_code s1");
});

test("a damaged library file is preserved and reported", () => {
  const dir = useTempUserData();
  fs.writeFileSync(path.join(dir, "session-library.json"), "not json at all", "utf8");
  const rows = readSessionLibrary();
  assert.deepEqual(rows, []);
  const preserved = fs.readdirSync(dir).filter((f) => f.includes("corrupt"));
  assert.equal(preserved.length, 1, "the damaged file is kept for diagnosis");
});

// ---------------------------------------------------------------------------
// the folder facts
// ---------------------------------------------------------------------------

test("the folder facts tell a folder from a repository from a missing path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-facts-"));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const facts = folderFacts([repo, dir, path.join(dir, "ghost")], folderFactRoots());
  assert.equal(facts.length, 3);
  assert.equal(facts[0].kind, "repository", "a folder with a .git is a repository");
  assert.equal(facts[0].name, "repo");
  assert.equal(facts[1].kind, "folder");
  assert.equal(facts[2].kind, "missing");
});

test("the folder facts flag the home folder and the temporary folders", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-home-"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-tmp-"));
  const inside = path.join(tmp, "inside");
  fs.mkdirSync(inside, { recursive: true });
  const roots = { home, generated: [tmp], system: [] };
  const facts = folderFacts([home, inside], roots);
  assert.equal(facts[0].home, true, "the home folder is flagged");
  assert.equal(facts[1].home, false);
  assert.equal(facts[1].temporary, true, "a folder INSIDE a temporary root is flagged");
});

test("the folder facts ignore a relative path and de-duplicate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-facts-"));
  const facts = folderFacts(["relative", dir, dir], folderFactRoots());
  assert.equal(facts.length, 1, "the relative path is dropped and the duplicate collapses");
});

// ---------------------------------------------------------------------------
// the harness list
// ---------------------------------------------------------------------------

test("the portable harnesses are the RE's", () => {
  assert.deepEqual([...PORTABLE_HARNESSES], ["claude_code", "codex", "pi", "amp", "grok"]);
});
