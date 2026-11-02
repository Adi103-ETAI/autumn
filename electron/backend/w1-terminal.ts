// autumn — Wave-1 handlers: terminal (43; 23 new dispatchable — start/input/resize/kill already in handlers.ts) (doc 31).
//
// STUB — filled in by the assigned Wave-1 agent. Registered by index.ts; do not
// edit shared files (w1-deps.ts, index.ts, handlers.ts, registry, manifest).
// Contract: every id must exist in electron/ipc/manifest.json bridge namespaces
// (conformance test enforces it). Envelope rules: return a plain payload on
// success, or { ok: false, error: { code, message } } for bad-params/not-found.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

export function makeTerminalHandlers(_deps: W1Deps): RegisteredHandler[] {
  return [];
}
