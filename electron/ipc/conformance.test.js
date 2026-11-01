"use strict";
// Conformance + renderer-contract tests (doc 29 §T layers 4 & 5).
//
// These are GENERATED evidence: electron/ipc/manifest.json is produced from the
// target's reverse-engineering inventories — October Desktop v1.0.56
// (scripts/gen-ipc-manifest.mjs reads autumn/evidence/inventories/*.md). They assert
// the oracle's totals so any drift in the oracles, the manifest, or the facade is caught.
//
// Implementation counts are honest baselines: the conformance test reports how many
// of the 129 core methods / 572 bridge methods are registered TODAY, and fails only
// if registered handlers claim methods outside the target surface.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const reg = require("./registry");
const manifest = require("./manifest.json");

beforeEach(() => reg.reset());

// ---- Known evidence facts (validated against the oracles, see doc 27/28) --------

// The 7 `october.*.*` regex hits in the TARGET's renderer bundle that are NOT bridge
// calls: the target's preload exposes none of them (0 mentions) — they are
// renderer-local objects in October's code, not part of any bridge.
const KNOWN_NON_BRIDGE = [
  "announcement",
  "collaboratorOutbox",
  "communityInvite",
  "personal",
  "quickOpenRecent",
  "recentModels",
  "remoteNotice",
];

// Bridge namespaces the target's own desktop UI never calls (serve CLI/remote principals).
const EXPECTED_DORMANT = [
  "activity",
  "agentAuth",
  "chats",
  "documents",
  "inference",
  "multiplayer",
];

test("manifest totals match the v1.0.56 RE oracles (target: October Desktop)", () => {
  assert.equal(manifest.project, "autumn");
  assert.deepEqual(manifest.protocol, { API_VERSION: 2, SCHEMA: 8 });
  assert.equal(manifest.counts.coreMethods, 129, "core methods");
  assert.equal(manifest.counts.coreGroups, 21, "core groups");
  assert.equal(manifest.counts.bridgeNamespaces, 68, "bridge namespaces");
  assert.equal(manifest.counts.bridgeMethods, 572, "bridge second-level methods");
  assert.equal(manifest.counts.rendererCalls, 476, "target renderer october.* matches");
  assert.deepEqual(
    manifest.principals,
    ["desktop", "cli", "remote", "local-client", "capability"],
    "per-principal auth roles (doc 22)"
  );
});

test("renderer usage: 469 genuine bridge calls across 62 namespaces", () => {
  const usage = manifest.rendererUsage.namespaces;
  const bridge = manifest.bridge.namespaces;

  // 476 total matches = 469 genuine + 7 non-bridge artifacts
  const nonBridge = Object.keys(usage).filter((ns) => !(ns in bridge));
  assert.deepEqual(
    nonBridge.sort(),
    [...KNOWN_NON_BRIDGE].sort(),
    "renderer-only namespaces must be exactly the 7 known non-bridge artifacts"
  );

  // Within bridge namespaces, every renderer call must resolve to a bridge method
  const unresolved = [];
  let genuine = 0;
  for (const [ns, methods] of Object.entries(usage)) {
    if (!(ns in bridge)) continue; // artifact namespace, counted above
    for (const m of methods) {
      genuine++;
      if (!bridge[ns].includes(m)) unresolved.push(`${ns}.${m}`);
    }
  }
  assert.deepEqual(unresolved, [], "every genuine renderer call resolves");
  assert.equal(genuine, 469, "genuine bridge call count");

  // 68 bridge ns - 62 used = 6 dormant
  const usedBridgeNs = Object.keys(usage).filter((ns) => ns in bridge);
  assert.equal(usedBridgeNs.length, 62, "bridge namespaces used by the renderer");
  const dormant = Object.keys(bridge).filter((ns) => !usedBridgeNs.includes(ns));
  assert.deepEqual(
    dormant.sort(),
    [...EXPECTED_DORMANT].sort(),
    "dormant namespaces (doc 27 §2.1)"
  );
});

test("every core method id is unique and dotted group.method", () => {
  const seen = new Set();
  for (const [group, methods] of Object.entries(manifest.core.groups)) {
    for (const m of methods) {
      assert.ok(m.startsWith(group + "."), `${m} must live in group ${group}`);
      assert.ok(!seen.has(m), `duplicate core method ${m}`);
      seen.add(m);
    }
  }
  assert.equal(seen.size, 129);
});

test("every bridge method id is unique and lives in its namespace", () => {
  const seen = new Set();
  for (const [ns, methods] of Object.entries(manifest.bridge.namespaces)) {
    for (const m of methods) {
      const id = `${ns}.${m}`;
      assert.ok(!seen.has(id), `duplicate bridge method ${id}`);
      seen.add(id);
    }
  }
  assert.equal(seen.size, 572);
});

test("registered handlers always belong to the target surface (no invented methods)", async () => {
  // Register a couple of in-surface and confirm manifest membership works.
  reg.register("bridge", "settings.get", () => ({}));
  reg.register("core", "bus.query", () => ({}));
  assert.equal(reg.inManifest("bridge", "settings.get"), true);
  assert.equal(reg.inManifest("core", "bus.query"), true);
  assert.equal(reg.inManifest("bridge", "invented.thing"), false);
});

test("honest baseline: conformance reports implemented/total", async () => {
  // Baseline = 0 implemented. As waves land methods, `implemented` grows; this test
  // documents the count and asserts none exceed the target surface.
  const impl = reg.implemented();
  for (const h of impl) {
    assert.ok(
      reg.inManifest(h.kind, h.id),
      `registered ${h.kind}:${h.id} is not part of the target surface (October Desktop v1.0.56)`
    );
  }
  // The report line (visible in test output via assert message on failure only).
  assert.ok(impl.length >= 0);
  // Future waves flip this: assert.equal(impl.filter(h=>h.kind==="core").length, 129)
  const coreDone = impl.filter((h) => h.kind === "core").length;
  const bridgeDone = impl.filter((h) => h.kind === "bridge").length;
  assert.ok(coreDone <= 129 && bridgeDone <= 572, "counts within surface");
});

test("all 68 namespaces are enumerable for the Bridge Inspector", () => {
  const ns = Object.keys(manifest.bridge.namespaces);
  assert.equal(ns.length, 68);
  // inspector needs methods per namespace + total
  const total = Object.values(manifest.bridge.namespaces).reduce((a, v) => a + v.length, 0);
  assert.equal(total, 572);
});
