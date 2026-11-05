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
