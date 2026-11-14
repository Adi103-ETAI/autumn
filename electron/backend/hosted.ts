// autumn — Wave-4 handlers: the hosted tier's namespaces.
//
// The parts of the product that live on someone else's machine: the cloud
// workspace, the cloud agents, the compute environments, the plan and the
// checkout, the code sync, the hosted servers, the analytics, the shared
// frames, the hosted messaging, the agent connections, the multiplayer and
// the liveblocks.
//
// They are NOT built here — autumn is local-first. But they EXIST in the
// contract, and every one of them answers honestly:
//
//   { ok: false, error: { code: "not-implemented", message: "…" } }
//
// A client gets a real answer (and the reason) instead of "no handler for
// cloud.create".
//
// The two that ARE local live in their own modules: the updater
// (`update.*`) drives the real electron-updater, and the device simulator is
// a test tool of the upstream app that Autumn does not ship.

import type { RegisteredHandler } from "./handlers";

const REASON =
  "this belongs to the hosted tier — autumn is local-first, so there is no cloud service behind it";

export function makeHostedHandlers(): RegisteredHandler[] {
  const hosted = (id: string, description: string): RegisteredHandler => ({
    kind: "bridge",
    id,
    description,
    handler: async () => ({
      ok: false,
      error: { code: "not-implemented" as const, message: REASON },
    }),
  });

  return [
    // ---------------- cloud ----------------
    hosted("cloud.create", "create a cloud workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.save", "save a cloud workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.load", "load a cloud workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.openShared", "open a shared cloud workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "cloud.loadParticipantOverlay",
      "load a participant's overlay; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted(
      "cloud.saveParticipantOverlay",
      "save a participant's overlay; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("cloud.recentShared", "the recently shared cloud workspaces; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "cloud.forgetRecentShared",
      "forget a recently shared cloud workspace; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("cloud.shareInfo", "the sharing information; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.setShared", "share a workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.delete", "delete a cloud workspace; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloud.joinWorkspace", "join a cloud workspace; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- cloudAgents ----------------
    hosted("cloudAgents.status", "the cloud agents' status; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloudAgents.accounts", "the cloud agents' accounts; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "cloudAgents.connectCursor",
      "connect a Cursor account; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted(
      "cloudAgents.removeAccount",
      "remove a cloud agent's account; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("cloudAgents.models", "the cloud agents' models; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "cloudAgents.repositories",
      "the cloud agents' repositories; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("cloudAgents.list", "the cloud agents; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloudAgents.create", "create a cloud agent; params: {} -> not-implemented (the hosted tier)"),
    hosted("cloudAgents.submit", "submit a cloud agent; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "cloudAgents.reconcile",
      "reconcile the cloud agents; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("cloudAgents.stop", "stop a cloud agent; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- compute ----------------
    hosted("compute.github", "the compute provider's GitHub; params: {} -> not-implemented (the hosted tier)"),
    hosted("compute.overview", "the compute overview; params: {} -> not-implemented (the hosted tier)"),
    hosted("compute.create", "create a compute environment; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "compute.cancelCreation",
      "cancel a compute environment's creation; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("compute.get", "read a compute environment; params: {} -> not-implemented (the hosted tier)"),
    hosted("compute.rename", "rename a compute environment; params: {} -> not-implemented (the hosted tier)"),
    hosted("compute.sendTask", "send a task to a compute environment; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "compute.openTerminal",
      "open a terminal on a compute environment; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted(
      "compute.controlTerminal",
      "control a terminal on a compute environment; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("compute.operate", "operate a compute environment; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- plan ----------------
    hosted("plan.get", "the plan; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.catalog", "the plan's catalog; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.foundingOffer", "the founding offer; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.foundingState", "the founding offer's state; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.prepareCheckout", "prepare a checkout; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.purchases", "the purchases; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.purchase", "make a purchase; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.startCheckout", "start a checkout; params: {} -> not-implemented (the hosted tier)"),
    hosted("plan.openPortal", "open the billing portal; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- codeSync ----------------
    hosted("codeSync.refresh", "refresh the code sync; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.startHost", "host a code sync; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.startGuest", "join a code sync; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.guestDir", "the guest's folder; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.stop", "stop the code sync; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "codeSync.removeGuestCopy",
      "remove the guest's copy; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("codeSync.consent", "the code sync's consent; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.setConsent", "set the code sync's consent; params: {} -> not-implemented (the hosted tier)"),
    hosted("codeSync.preflight", "check the code sync before it starts; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- servers ----------------
    hosted("servers.probe", "probe a server; params: {} -> not-implemented (the hosted tier)"),
    hosted("servers.integration", "a server's integration; params: {} -> not-implemented (the hosted tier)"),
    hosted("servers.hostKey", "the server's host key; params: {} -> not-implemented (the hosted tier)"),
    hosted("servers.trustHost", "trust a server's host; params: {} -> not-implemented (the hosted tier)"),
    hosted("servers.publicKeys", "the server's public keys; params: {} -> not-implemented (the hosted tier)"),
    hosted("servers.createKey", "create a server key; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- analytics ----------------
    hosted("analytics.bootstrap", "start the analytics; params: {} -> not-implemented (autumn has no analytics)"),
    hosted("analytics.capture", "capture an analytics event; params: {} -> not-implemented (autumn has no analytics)"),
    hosted("analytics.flags", "the analytics flags; params: {} -> not-implemented (autumn has no analytics)"),
    hosted(
      "analytics.accessRequest",
      "the analytics access request; params: {} -> not-implemented (autumn has no analytics)",
    ),

    // ---------------- share ----------------
    hosted("share.hostSync", "host a shared frame; params: {} -> not-implemented (the hosted tier)"),
    hosted("share.viewerSession", "a viewer's session; params: {} -> not-implemented (the hosted tier)"),
    hosted("share.frameAttach", "attach a shared frame; params: {} -> not-implemented (the hosted tier)"),

    // ---------------- the rest ----------------
    hosted("simulator.start", "start the device simulator; params: {} -> not-implemented (autumn ships no simulator)"),
    hosted("simulator.stop", "stop the device simulator; params: {} -> not-implemented (autumn ships no simulator)"),
    hosted("simulator.status", "the device simulator's status; params: {} -> not-implemented (autumn ships no simulator)"),
    hosted("hostedMessaging.admit", "admit a hosted message; params: {} -> not-implemented (the hosted tier)"),
    hosted("hostedMessaging.status", "the hosted messaging's status; params: {} -> not-implemented (the hosted tier)"),
    hosted("hostedMessaging.action", "act on the hosted messaging; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "agentConnections.request",
      "request an agent connection; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted(
      "agentConnections.openSetup",
      "open the agent connection's setup; params: {} -> not-implemented (the hosted tier)",
    ),
    hosted("liveblocks.auth", "sign in to the liveblocks service; params: {} -> not-implemented (the hosted tier)"),
    hosted(
      "multiplayer.requestAccess",
      "ask for multiplayer access; params: {} -> not-implemented (the hosted tier)",
    ),
  ];
}
