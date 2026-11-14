"use strict";
// autumn — the core protocol: the constants and the method surface.
//
// The core protocol is autumn's SECOND method set (129 methods / 21 groups).
// The bridge facade (`window.autumn`) is what the renderer uses; the core
// protocol is what the OTHER principals use — the `cli`, the `remote`
// (the phone relay) and the `local-client` — over the bus.
//
// The surface, the per-principal allow-lists and the limits are the ones the
// product defines: 129 methods, and a table that says exactly which
// principal may call which.
//
// See docs/architecture/core-protocol.md.

const CORE_API_VERSION = 2;
const CORE_SCHEMA_VERSION = 8;
const CORE_MIN_API_VERSION = CORE_API_VERSION;
const CORE_MAX_API_VERSION = CORE_API_VERSION;

/** A command may not be larger than this. */
const CORE_MAX_COMMAND_BYTES = 1024 * 1024;
/** Nor may a response. */
const CORE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Nor a single event. */
const CORE_MAX_EVENT_BYTES = 1024 * 1024;
/** Nor the queued events. */
const CORE_EVENT_QUEUE_BYTES = 4 * 1024 * 1024;

/** The staged terminal image limits. */
const TERMINAL_IMAGE_MAX_BYTES = 700 * 1024;
const TERMINAL_IMAGE_BASE64_MAX = Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4;
/** A staged image lives for 30 days. */
const STAGED_IMAGE_TTL_MS = 30 * 24 * 36e5;

/** Every core method, in the protocol's order. */
const CORE_METHODS = [
  "artifacts.query", "artifacts.mutate",
  "document.facts", "document.hold", "document.release", "document.forget",
  "core.handshake", "core.status", "core.cancel", "core.stop", "core.power",
  "core.windowState", "core.stopWork", "core.prepareHandoff", "core.completeHandoff",
  "facts.query", "facts.mutate",
  "bus.query", "bus.mutate", "bus.wait",
  "terminal.create", "terminal.input", "terminal.stageImage", "terminal.resize",
  "terminal.kill", "terminal.reclaimHost", "terminal.confirmStopped",
  "terminal.list", "terminal.snapshot",
  "devServer.prepare", "devServer.start", "devServer.confirm", "devServer.stop",
  "devServer.list", "devServer.preparation", "devServer.snapshot",
  "devServer.assertOwnership",
  "worktree.create", "worktree.repair", "worktree.setup", "worktree.claim",
  "worktree.remove", "worktree.list",
  "git.image", "git.query", "git.mutate",
  "agent.begin", "agent.finish", "agent.drop", "agent.reconcile", "agent.list",
  "launch.authorize",
  "ui.request", "ui.await", "ui.list", "ui.resolve", "ui.cancel", "ui.cancelNode",
  "ui.command.request", "ui.command.progress", "ui.command.stage",
  "ui.command.status", "ui.command.await", "ui.command.list",
  "ui.command.resolve", "ui.command.cancel",
  "intent.enqueue", "intent.list", "intent.ack",
  "capability.registerEndpoint", "capability.clearEndpoint",
  "cloudAgent.deliver", "cloudAgent.stageDelivery", "cloudAgent.settleDeliveries",
  "cloudAgent.get", "hosted.status", "hosted.activityView", "cloudAgent.list",
  "cloudAgent.save", "hosted.configure", "hosted.discover",
  "hosted.transferExecution", "hosted.prepare", "hosted.checkpoint",
  "hosted.promote", "hosted.abort",
  "capability.bindMcp", "capability.mcpAdmission", "capability.revokeMcp",
  "capability.bindHook", "capability.revokeHook", "capability.signalReady",
  "capability.resetReady",
  "delivery.setPolicy", "delivery.clearPolicy", "delivery.kick",
  "delivery.uncertainties", "delivery.automationState",
  "delivery.resolveUncertainty", "delivery.drainInbox", "delivery.nodeGone",
  "delivery.lifecycle",
  "remote.keepAwake.status", "remote.keepAwake.setEnabled",
  "remote.keepAwake.serving", "remote.status", "remote.enable", "remote.disable",
  "remote.device.activate", "remote.devices", "remote.revoke",
  "localClient.pending", "localClient.decide", "localClient.list",
  "localClient.revoke", "remote.push.register", "remote.push.unregister",
  "remote.push.mute",
  "chat.append", "chat.history", "chat.turn.request", "chat.turn.claim",
  "chat.turn.running", "chat.turn.complete", "chat.turn.cancel", "chat.turn.list",
  "fs.list", "fs.read",
  "agent.issueCapability",
];

/** The `cli` principal: drive a terminal, look around. */
const CORE_CLI_METHODS = [
  "core.handshake", "core.status", "core.stopWork",
  "terminal.create", "terminal.input", "terminal.resize", "terminal.kill",
  "terminal.list", "terminal.snapshot",
  "devServer.stop", "devServer.list",
  "worktree.list",
  "agent.list",
];

/** The `local-client` principal: the in-app surfaces (the dock, the panels). */
const CORE_LOCAL_CLIENT_METHODS = [
  "core.handshake", "core.status",
  "bus.query", "bus.mutate",
  "terminal.list", "agent.list",
  "ui.list", "ui.resolve", "ui.command.request", "ui.command.await",
  "chat.history", "facts.query",
];

/** The `remote` principal: the phone relay. */
const CORE_REMOTE_METHODS = [
  "remote.keepAwake.status", "remote.keepAwake.setEnabled",
  "core.handshake", "core.status",
  "facts.query", "facts.mutate",
  "bus.query", "bus.mutate",
  "terminal.input", "terminal.stageImage", "terminal.list", "terminal.snapshot",
  "devServer.list", "worktree.list", "git.query", "agent.list",
  "ui.list", "ui.resolve", "ui.command.request", "ui.command.status",
  "ui.command.list", "ui.command.await", "ui.command.cancel",
  "remote.push.register", "remote.push.unregister", "remote.push.mute",
  "chat.history", "chat.turn.request", "chat.turn.cancel",
  "fs.list", "fs.read",
];

/** The methods that change something (the bus asks for the handshake to say so). */
const CORE_MUTATION_METHODS = [
  "artifacts.mutate",
  "core.cancel", "core.stop", "core.power", "core.windowState",
  "core.stopWork", "core.prepareHandoff", "core.completeHandoff",
  "facts.mutate",
  "bus.mutate", "bus.wait",
  "terminal.create", "terminal.input", "terminal.stageImage", "terminal.resize",
  "terminal.kill", "terminal.reclaimHost", "terminal.confirmStopped",
  "devServer.prepare", "devServer.start", "devServer.confirm", "devServer.stop",
  "worktree.create", "worktree.repair", "worktree.setup", "worktree.claim",
  "worktree.remove",
  "git.mutate",
  "agent.begin", "agent.finish", "agent.drop", "agent.reconcile",
  "launch.authorize",
  "ui.request", "ui.resolve", "ui.cancel", "ui.cancelNode",
  "ui.command.request", "ui.command.progress", "ui.command.stage",
  "ui.command.resolve", "ui.command.cancel",
  "intent.enqueue", "intent.ack",
  "capability.registerEndpoint", "capability.clearEndpoint",
  "cloudAgent.save",
  "hosted.configure", "hosted.discover", "hosted.transferExecution",
  "hosted.prepare", "hosted.checkpoint", "hosted.promote", "hosted.abort",
  "cloudAgent.deliver", "cloudAgent.stageDelivery", "cloudAgent.settleDeliveries",
  "capability.bindMcp", "capability.revokeMcp",
  "capability.bindHook", "capability.revokeHook",
  "capability.signalReady", "capability.resetReady",
  "delivery.setPolicy", "delivery.clearPolicy", "delivery.kick",
  "delivery.resolveUncertainty", "delivery.drainInbox", "delivery.nodeGone",
  "delivery.lifecycle",
  "remote.keepAwake.setEnabled", "remote.keepAwake.serving",
  "remote.enable", "remote.disable", "remote.device.activate", "remote.revoke",
  "localClient.decide", "localClient.revoke",
  "remote.push.register", "remote.push.unregister", "remote.push.mute",
  "chat.append", "chat.turn.request", "chat.turn.claim", "chat.turn.running",
  "chat.turn.complete", "chat.turn.cancel",
  "agent.issueCapability",
];

/** The `bus.query` operations. */
const CORE_BUS_QUERY_OPERATIONS = [
  "listCanvases", "currentSnapshot", "nodeName", "nodeKind",
  "nodeOwnerDeviceId", "nodeOwnerSnapshot", "nodeExecutionState",
  "nodeNeedsInput", "resolveNodeId", "listPeers", "getPeerContext",
  "getSummaryHistory", "recentActivity", "terminalNodesUnder",
  "liveTerminalCwds", "roots", "openRequestsFor", "hasOpenPeerTurn",
  "pendingCount", "pendingGeneration", "pendingTerminalRecipients",
  "pendingRecipients", "deliveryUncertainRecipients", "deliveryUncertainties",
  "stagedDeliveryUncertainty", "listTasks", "collaboratorConsentRequests",
  "collaboratorSendStatus", "octoberDeliveryStates", "collaboratorAllowances",
];

/** The `facts.query` operations. */
const CORE_FACTS_QUERY_OPERATIONS = [
  "notification", "listNotifications", "listLatestRunUsages",
  "listNodeWorkflows", "listPrObservations", "listDeckTriage",
];

const CORE_METHOD_SET = new Set(CORE_METHODS);
const CORE_CLI_METHOD_SET = new Set(CORE_CLI_METHODS);
const CORE_LOCAL_CLIENT_METHOD_SET = new Set(CORE_LOCAL_CLIENT_METHODS);
const CORE_REMOTE_METHOD_SET = new Set(CORE_REMOTE_METHODS);
const CORE_MUTATION_METHOD_SET = new Set(CORE_MUTATION_METHODS);
const CORE_BUS_QUERY_OPERATION_SET = new Set(CORE_BUS_QUERY_OPERATIONS);
const CORE_FACTS_QUERY_OPERATION_SET = new Set(CORE_FACTS_QUERY_OPERATIONS);

/** Is this a core method? */
function isCoreMethod(value) {
  return typeof value === "string" && CORE_METHOD_SET.has(value);
}

/** Does this method change something? */
function isCoreMutation(method) {
  return CORE_MUTATION_METHOD_SET.has(method);
}

module.exports = {
  CORE_API_VERSION,
  CORE_SCHEMA_VERSION,
  CORE_MIN_API_VERSION,
  CORE_MAX_API_VERSION,
  CORE_MAX_COMMAND_BYTES,
  CORE_MAX_RESPONSE_BYTES,
  CORE_MAX_EVENT_BYTES,
  CORE_EVENT_QUEUE_BYTES,
  TERMINAL_IMAGE_MAX_BYTES,
  TERMINAL_IMAGE_BASE64_MAX,
  STAGED_IMAGE_TTL_MS,
  CORE_METHODS,
  CORE_CLI_METHODS,
  CORE_LOCAL_CLIENT_METHODS,
  CORE_REMOTE_METHODS,
  CORE_MUTATION_METHODS,
  CORE_BUS_QUERY_OPERATIONS,
  CORE_FACTS_QUERY_OPERATIONS,
  CORE_METHOD_SET,
  CORE_CLI_METHOD_SET,
  CORE_LOCAL_CLIENT_METHOD_SET,
  CORE_REMOTE_METHOD_SET,
  CORE_MUTATION_METHOD_SET,
  CORE_BUS_QUERY_OPERATION_SET,
  CORE_FACTS_QUERY_OPERATION_SET,
  isCoreMethod,
  isCoreMutation,
};
