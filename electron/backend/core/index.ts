// autumn — the core protocol's handler set (Wave 4, doc 35 §7).
//
// 129 methods over 21 groups, in three parts:
//
//   bridge-groups.ts  the groups that map straight onto the bridge handlers
//                     (artifacts, terminal, devServer, worktree, git, fs,
//                     remote)
//   behaviour.ts      the groups with a lifecycle of their own (core, launch,
//                     intent, capability, delivery, localClient, the staged
//                     images, the dev-server lifecycle)
//   surfaces.ts       the content the other principals drive (ui, ui.command,
//                     facts, document, chat, agent)
//   hosted.ts         the hosted tier — it exists and answers honestly
//
// Every method is registered under the "core" kind, so the registry dispatches
// it with the principal check in front (electron/ipc/auth.js).

import type { RegisteredHandler } from "../handlers";
import type { W1Deps } from "../w1-deps";
import { makeCoreBridgeGroups } from "./bridge-groups";
import { makeCoreLifecycleGroups } from "./behaviour";
import { makeCoreHostedGroups } from "./hosted";
import { makeCoreSurfaceGroups } from "./surfaces";
import type { BridgeLookup } from "./support";

/** Every core handler, in the protocol's group order. */
export function makeCoreHandlers(deps: W1Deps, bridge: BridgeLookup): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [];
  handlers.push(...makeCoreBridgeGroups(bridge));
  handlers.push(...makeCoreLifecycleGroups(deps, bridge));
  handlers.push(...makeCoreSurfaceGroups(deps, bridge));
  handlers.push(...makeCoreHostedGroups());
  return handlers;
}
