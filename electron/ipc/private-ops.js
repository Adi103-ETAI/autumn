"use strict";
// autumn — PRIVATE facade ops: autumn's own backend operations that have NO
// equivalent in the contract surface ().
//
// While target-surface methods (bridge/core ids from electron/ipc/manifest.json)
// are strict — a registered handler must exist in the adapted surface — a small,
// explicit allow-list lives here for operations autumn's UI needs that the upstream
// implements elsewhere (or not at all). They are exposed on the facade under the
// dunder namespace `window.autumn.__ops.<name>` and registered with ids
// `__ops.<name>` (1:1 naming: dunder = autumn-internal, not target surface).
//
// Rules (enforced by conformance.test.js):
//   1. Every registered `__ops.*` id MUST be in this list (no silent additions).
//   2. This list is tiny and deliberate — if an op can map to a target method,
//      map it instead (see docs/architecture/ipc-facade.md mapping table).
module.exports = [
  "__ops.canvasDelete", // canvas DELETE (target canvas ns has no delete)
  "__ops.logsClear",    // activity log clear (target activity ns has no delete)
  "__ops.commander",    // autumn Commander planning (the upstream has no commander namespace)
  "__ops.agentRun",     // one-shot agent CLI run (target agent ns is Q&A; revisit Wave 4)
];
