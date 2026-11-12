"use strict";
// Renderer ↔ backend contract test (doc 31 §0, doc 29 §T layers 4 & 5).
//
// For every namespace the TARGET's renderer uses (manifest.rendererUsage) that
// belongs to Wave 1 (the 17 namespaces in doc 31):
//   - every NON-`on*` method the renderer uses MUST dispatch-resolve — either
//     registered as a handler in this process (Wave-0 makeHandlers / Wave-1
//     factories) or deliberately left out (none — the contract requires all);
//   - every `on*` method the renderer uses MUST exist in the preload facade as
//     a SUBSCRIPTION (cb) => unsubscribe), wired to `autumn:event:<id>`.
//
// This is the guard against the renderer calling something with no backend.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { buildFacade, isEventMethod } = require("../ipc/facade");

const WAVE1_NAMESPACES = [
  "bus", "terminal", "canvas", "files", "fs", "git", "worktrees",
  "devServer", "artifacts", "sessions", "tasks", "agent",
  "clipboard", "find", "thumbnails", "projectChatHistory", "events",
];

// Wave-0 handlers (14) + all 13 Wave-1 factories.
const { makeHandlers } = require("./handlers.ts");
const { makeBusHandlers } = require("./bus.ts");
const { makeTerminalHandlers } = require("./terminal.ts");
const { makeCanvasHandlers } = require("./canvas.ts");
const { makeFilesHandlers } = require("./files.ts");
const { makeFsHandlers } = require("./fs.ts");
const { makeGitHandlers } = require("./git.ts");
const { makeDevServerHandlers } = require("./devserver.ts");
const { makeOsHandlers } = require("./os.ts");
const { makeArtifactsHandlers } = require("./artifacts.ts");
const { makeSessionsHandlers } = require("./sessions.ts");
const { makeTasksHandlers } = require("./tasks.ts");
const { makeAgentHandlers } = require("./agent.ts");
const { makePchHandlers } = require("./pch.ts");

const W1_FACTORIES = [
  makeBusHandlers, makeTerminalHandlers, makeCanvasHandlers, makeFilesHandlers,
  makeFsHandlers, makeGitHandlers, makeDevServerHandlers, makeOsHandlers,
  makeArtifactsHandlers, makeSessionsHandlers, makeTasksHandlers,
  makeAgentHandlers, makePchHandlers,
];

/** Minimal fake W1Deps — factories only close over deps; they don't call them. */
function fakeDeps() {
  const noop = () => {};
  const model = new Proxy({}, { get: () => async () => [] });
  const modelWithCount = new Proxy({}, { get: (_t, prop) => async () => (prop === "count" ? 0 : []) });
  const db = new Proxy({}, { get: () => modelWithCount });
  return {
    busStore: { ensurePeer: noop, setPeerStatus: noop, sendMessage: async () => ({ delivered: true, id: "m", ts: 1 }), drainInbox: async () => ({ injection: "", drained: false }), listPeers: async () => [], getPeer: async () => null },
    pty: { createPty: () => false, subscribePty: () => () => {}, writePty: () => false, resizePty: noop, killPty: noop, ptyExists: () => false, ptyKind: () => undefined, ptyCount: () => 0, onPtyExit: () => () => {} },
    spawner: { runAgent: async () => ({ text: "" }), resolveAgentCommand: async () => null, HARNESS_BIN: {} },
    db,
    personas: { PERSONA_BY_ID: {} },
    emit: noop,
    now: () => Date.now(),
    fs: {},
    shell: { openPath: async () => "", showItemInFolder: noop, openExternal: async () => {} },
    clipboard: { readText: () => "", writeText: noop, readImage: () => null },
    screen: { capture: async () => null },
    git: () => ({}),
    spawn: { spawn: () => ({ on: noop, kill: noop }) },
  };
}

beforeEach(() => reg.reset());

test("contract: every renderer-used Wave-1 namespace exists in the bridge oracle", () => {
  const bridge = manifest.bridge.namespaces;
  for (const ns of WAVE1_NAMESPACES) {
    if (ns === "events") continue; // events is the pure push surface (16 `on*` only)
    assert.ok(bridge[ns], `namespace ${ns} missing from manifest bridge.namespaces`);
  }
});

test("contract: every renderer-used non-on* method dispatch-resolves", async () => {
  const deps = fakeDeps();
  for (const h of makeHandlers(deps)) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  for (const make of W1_FACTORIES) {
    for (const h of make(deps)) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }

  const usage = manifest.rendererUsage.namespaces;
  const missing = [];
  let checked = 0;
  for (const ns of WAVE1_NAMESPACES) {
    for (const method of usage[ns] ?? []) {
      const m = isEventMethod(method);
      if (m) continue; // handled by the on* test below
      checked++;
      const id = `${ns}.${method}`;
      if (!reg.has("bridge", id)) missing.push(id);
    }
  }
  assert.ok(checked > 100, `expected >100 renderer-used methods checked, got ${checked}`);
  assert.deepEqual(missing, [], `renderer-used methods with no backend: ${missing.join(", ")}`);
});

test("contract: every renderer-used on* method exists in the facade as a subscription", () => {
  const facade = buildFacade({
    manifest,
    invoke: async () => ({ ok: true, result: null }),
    subscribe: (id, cb) => {
      assert.equal(typeof cb, "function");
      return () => {};
    },
  });
  const usage = manifest.rendererUsage.namespaces;
  const missing = [];
  for (const ns of WAVE1_NAMESPACES) {
    for (const method of usage[ns] ?? []) {
      if (!isEventMethod(method)) continue;
      const member = facade[ns] && facade[ns][method];
      if (typeof member !== "function") missing.push(`${ns}.${method}`);
    }
  }
  assert.deepEqual(missing, [], `renderer-used on* methods missing from facade: ${missing.join(", ")}`);
});

test("contract: every Wave-1 handler/description is present and every id is bridge-kind", () => {
  const deps = fakeDeps();
  const seen = [];
  for (const make of W1_FACTORIES) {
    for (const h of make(deps)) {
      assert.equal(h.kind, "bridge");
      assert.ok(h.description && h.description.length > 0, `${h.id} missing description`);
      seen.push(h.id);
    }
  }
  const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate ids across Wave-1 factories: ${dupes.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Wave-2 contract (doc 32 §0 / §7 W2-6): the 19 platform namespaces, 115
// renderer-used dispatchable ids + 6 `on*` subscriptions. Same two rules as
// Wave 1 — every renderer-used non-on* id dispatch-resolves, every on* is a
// facade subscription — plus: bridge kind, descriptions, no duplicate ids
// across the whole registered surface.
// ---------------------------------------------------------------------------

const { W1_FACTORIES: _W1F, W2_FACTORIES } = require("./index.ts");

// Doc 32 §0 — the 19 Wave-2 namespaces (rendererUsage cross-check below).
const WAVE2_NAMESPACES = [
  "settings", "update", "diagnostics", "resources", "runtime", "wallpapers",
  "nav", "element", "cues", "skills", "auth", "agentAccounts", "backends",
  "browser", "voice", "phone", "video", "slides", "remotion",
];

/** Register the FULL surface (Wave-0 + Wave-1 + Wave-2) into the registry. */
function registerAll() {
  const deps = fakeDeps();
  for (const h of makeHandlers(deps)) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  for (const make of [...W1_FACTORIES, ...W2_FACTORIES]) {
    for (const h of make(deps)) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  }
  return deps;
}

test("contract(W2): the 19 Wave-2 namespaces exist in the bridge oracle and in rendererUsage", () => {
  const bridge = manifest.bridge.namespaces;
  const usage = manifest.rendererUsage.namespaces;
  for (const ns of WAVE2_NAMESPACES) {
    assert.ok(bridge[ns], `namespace ${ns} missing from manifest bridge.namespaces`);
    assert.ok(usage[ns], `namespace ${ns} missing from manifest rendererUsage`);
  }
  assert.equal(WAVE2_NAMESPACES.length, 19, "doc 32 §0 scope is 19 namespaces");
});

test("contract(W2): every renderer-used non-on* Wave-2 method dispatch-resolves", async () => {
  registerAll();
  const usage = manifest.rendererUsage.namespaces;
  const missing = [];
  let checked = 0;
  for (const ns of WAVE2_NAMESPACES) {
    for (const method of usage[ns] ?? []) {
      if (isEventMethod(method)) continue;
      checked++;
      const id = `${ns}.${method}`;
      if (!reg.has("bridge", id)) missing.push(id);
    }
  }
  assert.equal(checked, 115, `doc 32 §0 scope is 115 renderer-used dispatchable ids, got ${checked}`);
  assert.deepEqual(missing, [], `renderer-used Wave-2 methods with no backend: ${missing.join(", ")}`);
});

test("contract(W2): every renderer-used on* Wave-2 method exists in the facade as a subscription", () => {
  const facade = buildFacade({
    manifest,
    invoke: async () => ({ ok: true, result: null }),
    subscribe: (id, cb) => {
      assert.equal(typeof cb, "function");
      return () => {};
    },
  });
  const usage = manifest.rendererUsage.namespaces;
  const missing = [];
  let checked = 0;
  for (const ns of WAVE2_NAMESPACES) {
    for (const method of usage[ns] ?? []) {
      if (!isEventMethod(method)) continue;
      checked++;
      const member = facade[ns] && facade[ns][method];
      if (typeof member !== "function") missing.push(`${ns}.${method}`);
    }
  }
  assert.equal(checked, 6, `doc 32 §0 scope is 6 on* subscriptions, got ${checked}`);
  assert.deepEqual(missing, [], `renderer-used Wave-2 on* methods missing from facade: ${missing.join(", ")}`);
});

test("contract(W2): every Wave-2 handler is bridge-kind, described, and unique across the full surface", () => {
  const deps = fakeDeps();
  const seen = [];
  for (const make of W2_FACTORIES) {
    for (const h of make(deps)) {
      assert.equal(h.kind, "bridge", `${h.id} must be bridge kind`);
      assert.ok(h.description && h.description.length >= 10, `${h.id} missing a real description`);
      assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in the target surface (no invented ids)`);
      seen.push(h.id);
    }
  }
  const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate ids across Wave-2 factories: ${dupes.join(", ")}`);

  // Cross-wave uniqueness: no Wave-2 id may collide with the Wave-0/1 surface.
  const wave1Ids = new Set();
  for (const make of W1_FACTORIES) for (const h of make(deps)) wave1Ids.add(h.id);
  const collide = seen.filter((id) => wave1Ids.has(id));
  assert.deepEqual(collide, [], `Wave-2 ids colliding with Wave-1: ${collide.join(", ")}`);
});

test("contract(W2): every boundary id dispatches and answers the not-implemented envelope", async () => {
  registerAll();
  // The voice-pack boundary ids were IMPLEMENTED in Wave 3 (doc 35 §6) — they
  // are real now, so they are no longer boundary ids.
  const BOUNDARY = [
    "backends.convexAuthStatus", "backends.convexCreate", "backends.convexLogin",
    "runtime.installOctober", "runtime.removeOctober",
  ];
  for (const id of BOUNDARY) {
    assert.ok(reg.has("bridge", id), `${id} must dispatch`);
    const env = await reg.dispatch({ kind: "bridge", id, params: {} });
    assert.equal(env.ok, false, `${id} must fail honestly`);
    assert.equal(env.error.code, "not-implemented", `${id} must be the boundary envelope`);
    assert.ok(env.error.message.length > 10, `${id} needs an explanatory message`);
  }
});

test("contract(W3): the voice-pack ids are implemented, not boundary ids", async () => {
  registerAll();
  const IMPLEMENTED = ["voice.compile", "voice.cancelCompile", "voice.intentReady", "voice.parakeet", "voice.voicePack"];
  for (const id of IMPLEMENTED) {
    assert.ok(reg.has("bridge", id), `${id} must dispatch`);
    const env = await reg.dispatch({ kind: "bridge", id, params: { action: "status", utterance: "hello" } });
    assert.equal(env.ok, true, `${id} must resolve`);
    assert.notEqual(env.error?.code, "not-implemented", `${id} must not be a boundary id any more`);
  }
});

test("contract(W2): the registered surface covers every renderer-used id across ALL waves", async () => {
  registerAll();
  const usage = manifest.rendererUsage.namespaces;
  const missing = [];
  let checked = 0;
  for (const [ns, methods] of Object.entries(usage)) {
    for (const method of methods) {
      if (isEventMethod(method)) continue;
      checked++;
      if (!reg.has("bridge", `${ns}.${method}`)) missing.push(`${ns}.${method}`);
    }
  }
  // Namespaces not yet built (Wave 3/4 subsystems: cloud, compute, storage, …)
  // are expected here until their milestones land — so this asserts the PARTIAL
  // set we own today is complete, and reports the remainder for the roadmap.
  const w2Owned = new Set(WAVE2_NAMESPACES);
  const w1Owned = new Set([...WAVE1_NAMESPACES]);
  const ownedMissing = missing.filter((id) => {
    const ns = id.slice(0, id.lastIndexOf("."));
    return w2Owned.has(ns) || w1Owned.has(ns);
  });
  assert.ok(checked > 300, `expected >300 renderer-used ids checked, got ${checked}`);
  assert.deepEqual(ownedMissing, [], `owned-wave renderer-used ids with no backend: ${ownedMissing.join(", ")}`);
});
