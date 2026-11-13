// autumn — Wave-2 handlers: runtime (3 dispatchable + onProgress push; docs/architecture/backend.md-2).
//
// runtime.ensureNode (no args → identity of the bundled Node), runtime.installCloudRuntime /
// runtime.removeCloudRuntime (install/delete the hosted runtime — autumn IS the runtime;
// there is nothing to install), runtime.onProgress (only on REAL ensureNode work —
// ensureNode is a probe, so no progress events are ever emitted).

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

export function makeRuntimeHandlers(deps: W1Deps): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "runtime.ensureNode",
      description:
        "probe the bundled Node runtime; params: {} -> { node, npm?, platform, arch } (real process.version, never invented)",
      schema: () => ({ ok: true }),
      handler: () => ({
        node: process.version,
        npm: (() => {
          try {
            return require("node:child_process").execSync("npm --version", { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
          } catch {
            return null;
          }
        })(),
        platform: process.platform,
        arch: process.arch,
      }),
    },
    {
      kind: "bridge",
      id: "runtime.installCloudRuntime",
      description:
        "install the hosted runtime; params: {} -> not-implemented (autumn IS the runtime — nothing to download/install)",
      schema: () => ({ ok: true }),
      handler: () => ({
        ok: false,
        error: {
          code: "not-implemented",
          message: "autumn bundles its runtime — installCloudRuntime is a no-op for this product (nothing exists to install)",
        },
      }),
    },
    {
      kind: "bridge",
      id: "runtime.removeCloudRuntime",
      description:
        "remove the hosted runtime; params: {} -> not-implemented (removing the runtime would brick the app — not a supported operation)",
      schema: () => ({ ok: true }),
      handler: () => ({
        ok: false,
        error: {
          code: "not-implemented",
          message: "removeCloudRuntime is not a supported operation — the runtime ships with autumn (uninstall autumn instead)",
        },
      }),
    },
  ];

  return handlers;
}
