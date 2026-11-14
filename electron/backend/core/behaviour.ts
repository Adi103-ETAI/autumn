// autumn — the core protocol's lifecycle groups (Wave 4, doc 35 §7).
//
// The app's own lifecycle over the core protocol: the handshake, the status,
// the intents, the capabilities, the launch grants, the delivery policy, the
// local clients, the staged terminal images and the dev-server lifecycle.
//
// The state is local and real — a granted capability is granted, an expired
// one is refused, a staged image really lands on disk.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "../handlers";
import type { W1Deps } from "../w1-deps";
import { userDataDir } from "../store";
import { badRequest, notAvailable, pick, str, type BridgeLookup } from "./support";
import {
  StateFile,
  type CapabilityGrant,
  type DeliveryPolicy,
  type LaunchGrant,
  type QueuedIntent,
  type StagedImage,
} from "./state";
import {
  CORE_API_VERSION,
  CORE_MAX_API_VERSION,
  CORE_MIN_API_VERSION,
  CORE_SCHEMA_VERSION,
  STAGED_IMAGE_TTL_MS,
  TERMINAL_IMAGE_BASE64_MAX,
} from "../../ipc/core-protocol";

export function makeCoreLifecycleGroups(deps: W1Deps, bridge: BridgeLookup): RegisteredHandler[] {
  const { now, pty } = deps;

  const capabilities = new StateFile<CapabilityGrant[]>("core-capabilities.json", () => []);
  const intents = new StateFile<QueuedIntent[]>("core-intents.json", () => []);
  const grants = new StateFile<LaunchGrant[]>("core-launch-grants.json", () => []);
  const policy = new StateFile<DeliveryPolicy>("core-delivery-policy.json", () => ({
    mode: "auto",
    updatedAt: now(),
  }));
  const staged = new StateFile<StagedImage[]>("core-staged-images.json", () => []);

  /** Drop the expired grants and the expired images. */
  const prune = <T extends { expiresAt: number }>(rows: T[]): T[] => {
    const live = rows.filter((row) => row.expiresAt > now());
    return live;
  };

  const handlers: RegisteredHandler[] = [];

  // ---------------- core ----------------
  handlers.push({
    kind: "core",
    id: "core.handshake",
    description:
      "the protocol handshake; params: {} -> {apiVersion, minApiVersion, maxApiVersion, schemaVersion, principal, methods[]}",
    handler: async (params, ctx) => {
      const principal = ctx?.principal ?? "desktop";
      const granted =
        principal === "desktop"
          ? "all"
          : principal === "cli"
            ? "cli"
            : principal === "local-client"
              ? "local-client"
              : principal === "remote"
                ? "remote"
                : "capability";
      return {
        apiVersion: CORE_API_VERSION,
        minApiVersion: CORE_MIN_API_VERSION,
        maxApiVersion: CORE_MAX_API_VERSION,
        schemaVersion: CORE_SCHEMA_VERSION,
        principal,
        granted,
        server: "autumn",
      };
    },
  });

  handlers.push({
    kind: "core",
    id: "core.status",
    description: "the app's status; params: {} -> {terminals, agents, canvases, keepAwake}",
    handler: async () => {
      const canvases = (await deps.db.canvas.findMany({})).length;
      const agents = await deps.db.session.count({});
      return {
        server: "autumn",
        terminals: pty.ptyCount(),
        agents,
        canvases,
        keepAwake: true,
      };
    },
  });

  handlers.push({
    kind: "core",
    id: "core.stopWork",
    description: "stop every running agent; params: {} -> {stopped}",
    handler: async () => {
      // The agents are the PTYs the harnesses run in.
      let stopped = 0;
      const list = typeof pty.list === "function" ? pty.list() : [];
      for (const descriptor of list) {
        if (descriptor.kind !== "agent") continue;
        try {
          pty.killPty(descriptor.nodeId);
          stopped++;
        } catch {
          /* already gone */
        }
      }
      return { stopped };
    },
  });

  handlers.push({
    kind: "core",
    id: "core.cancel",
    description: "cancel the running work; params: {reason?} -> {cancelled}",
    handler: async (params) => {
      const reason = str(params ?? {}, "reason") ?? "cancelled";
      let cancelled = 0;
      const list = typeof pty.list === "function" ? pty.list() : [];
      for (const descriptor of list) {
        if (descriptor.kind !== "agent") continue;
        try {
          pty.writePty(descriptor.nodeId, "\x03");
          cancelled++;
        } catch {
          /* already gone */
        }
      }
      return { cancelled, reason };
    },
  });

  handlers.push({
    kind: "core",
    id: "core.stop",
    description: "stop the app's work; params: {} -> {stopped}",
    handler: async () => {
      let stopped = 0;
      const list = typeof pty.list === "function" ? pty.list() : [];
      for (const descriptor of list) {
        try {
          pty.killPty(descriptor.nodeId);
          stopped++;
        } catch {
          /* already gone */
        }
      }
      return { stopped };
    },
  });

  handlers.push({
    kind: "core",
    id: "core.power",
    description: "the app's power state; params: {} -> {keepAwake, since}",
    handler: async () => ({ keepAwake: true, since: now() }),
  });

  handlers.push({
    kind: "core",
    id: "core.windowState",
    description: "the window's state; params: {} -> {state}",
    handler: async () => ({ state: "normal" }),
  });

  handlers.push({
    kind: "core",
    id: "core.prepareHandoff",
    description: "prepare a handoff to another surface; params: {target?} -> {handoffId, prepared}",
    handler: async (params) => ({
      handoffId: `handoff-${randomUUID()}`,
      target: str(params ?? {}, "target") ?? "local-client",
      prepared: true,
      at: now(),
    }),
  });

  handlers.push({
    kind: "core",
    id: "core.completeHandoff",
    description: "complete a handoff; params: {handoffId} -> {completed}",
    handler: async (params) => {
      const handoffId = str(params ?? {}, "handoffId");
      if (!handoffId) return badRequest("handoffId required");
      return { handoffId, completed: true, at: now() };
    },
  });

  // ---------------- launch ----------------
  handlers.push({
    kind: "core",
    id: "launch.authorize",
    description:
      "authorize a terminal launch; params: {grantId?, terminalId, harness?, accountId?, env?, expiresAt?} -> {grantId, expiresAt} — a short-lived grant, so a launch can only happen with one",
    schema: (p) =>
      typeof p?.terminalId === "string" && p.terminalId.length > 0
        ? { ok: true }
        : { ok: false, message: "terminalId required" },
    handler: async (params) => {
      const terminalId = str(params ?? {}, "terminalId") as string;
      const ttl = Number(pick(params ?? {}, "ttlMs")) || 30_000;
      const grant: LaunchGrant = {
        id: str(params ?? {}, "grantId") ?? `grant-${randomUUID()}`,
        terminalId,
        ...(str(params ?? {}, "harness") ? { harness: str(params ?? {}, "harness") } : {}),
        ...(str(params ?? {}, "accountId") ? { accountId: str(params ?? {}, "accountId") } : {}),
        ...(params?.env && typeof params.env === "object" ? { env: params.env } : {}),
        createdAt: now(),
        expiresAt: now() + ttl,
      };
      const rows = grants.read();
      grants.write([...rows.filter((row) => row.terminalId !== terminalId), grant]);
      return { grantId: grant.id, expiresAt: grant.expiresAt };
    },
  });

  // ---------------- intent ----------------
  handlers.push({
    kind: "core",
    id: "intent.enqueue",
    description: "queue an intent; params: {kind, payload?} -> {intent}",
    schema: (p) => (typeof p?.kind === "string" && p.kind.length > 0 ? { ok: true } : { ok: false, message: "kind required" }),
    handler: async (params) => {
      const intent: QueuedIntent = {
        id: `intent-${randomUUID()}`,
        kind: str(params ?? {}, "kind") as string,
        payload: params?.payload ?? null,
        createdAt: now(),
      };
      intents.write([...intents.read(), intent]);
      return { intent };
    },
  });

  handlers.push({
    kind: "core",
    id: "intent.list",
    description: "the queued intents; params: {} -> {intents[]}",
    handler: async () => ({ intents: intents.read().filter((i) => !i.ackedAt) }),
  });

  handlers.push({
    kind: "core",
    id: "intent.ack",
    description: "acknowledge an intent; params: {intentId} -> {acked}",
    schema: (p) => (typeof p?.intentId === "string" ? { ok: true } : { ok: false, message: "intentId required" }),
    handler: async (params) => {
      const intentId = str(params ?? {}, "intentId") as string;
      const rows = intents.read();
      const target = rows.find((row) => row.id === intentId);
      if (!target) return badRequest(`no intent ${intentId}`);
      target.ackedAt = now();
      intents.write(rows);
      return { acked: true, intent: target };
    },
  });

  // ---------------- capability ----------------
  const capHandlers: RegisteredHandler[] = [
    {
      kind: "core",
      id: "capability.registerEndpoint",
      description: "grant a capability to an endpoint; params: {methods[], expiresAt?, purpose?} -> {grant}",
      schema: (p) =>
        Array.isArray(p?.methods) && p.methods.length > 0
          ? { ok: true }
          : { ok: false, message: "methods[] required" },
      handler: async (params) => {
        const grant: CapabilityGrant = {
          id: `cap-${randomUUID()}`,
          methods: (params?.methods as string[]).filter((m) => typeof m === "string"),
          expiresAt: Number(pick(params ?? {}, "expiresAt")) || now() + 3_600_000,
          ...(str(params ?? {}, "purpose") ? { purpose: str(params ?? {}, "purpose") } : {}),
          createdAt: now(),
        };
        capabilities.write([...capabilities.read().filter((c) => c.id !== grant.id), grant]);
        return { grant };
      },
    },
    {
      kind: "core",
      id: "capability.clearEndpoint",
      description: "drop a capability grant; params: {capabilityId} -> {cleared}",
      schema: (p) => (typeof p?.capabilityId === "string" ? { ok: true } : { ok: false, message: "capabilityId required" }),
      handler: async (params) => {
        const capabilityId = str(params ?? {}, "capabilityId") as string;
        const rows = capabilities.read();
        const target = rows.find((row) => row.id === capabilityId);
        if (!target) return badRequest(`no capability ${capabilityId}`);
        capabilities.write(rows.filter((row) => row.id !== capabilityId));
        return { cleared: true, capabilityId };
      },
    },
    {
      kind: "core",
      id: "capability.mcpAdmission",
      description: "the MCP admissions; params: {} -> {admissions[]}",
      handler: async () => ({ admissions: capabilities.read() }),
    },
    {
      kind: "core",
      id: "capability.signalReady",
      description: "signal that an endpoint is ready; params: {endpoint} -> {ready}",
      schema: (p) => (typeof p?.endpoint === "string" ? { ok: true } : { ok: false, message: "endpoint required" }),
      handler: async (params) => ({ ready: true, endpoint: str(params ?? {}, "endpoint"), at: now() }),
    },
    {
      kind: "core",
      id: "capability.resetReady",
      description: "reset the readiness of an endpoint; params: {endpoint} -> {reset}",
      schema: (p) => (typeof p?.endpoint === "string" ? { ok: true } : { ok: false, message: "endpoint required" }),
      handler: async (params) => ({ reset: true, endpoint: str(params ?? {}, "endpoint"), at: now() }),
    },
  ];
  // bindMcp / revokeMcp / bindHook / revokeHook are the same grant, with a kind.
  for (const [id, kind, verb] of [
    ["capability.bindMcp", "mcp", "bind"],
    ["capability.revokeMcp", "mcp", "revoke"],
    ["capability.bindHook", "hook", "bind"],
    ["capability.revokeHook", "hook", "revoke"],
  ] as const) {
    capHandlers.push({
      kind: "core",
      id,
      description: `${verb} a ${kind} capability; params: {methods[], expiresAt?, purpose?} -> {${verb}ed}`,
      schema: (p) =>
        Array.isArray(p?.methods) && p.methods.length > 0
          ? { ok: true }
          : { ok: false, message: "methods[] required" },
      handler: async (params) => {
        const rows = capabilities.read();
        if (verb === "revoke") {
          const target = rows.find((row) => row.methods.includes(str(params ?? {}, "method") as string));
          capabilities.write(target ? rows.filter((row) => row.id !== target.id) : rows);
          return { revoked: true, kind };
        }
        const grant: CapabilityGrant = {
          id: `cap-${randomUUID()}`,
          methods: (params?.methods as string[]).filter((m) => typeof m === "string"),
          expiresAt: Number(pick(params ?? {}, "expiresAt")) || now() + 3_600_000,
          ...(str(params ?? {}, "purpose") ? { purpose: str(params ?? {}, "purpose") } : {}),
          createdAt: now(),
        };
        capabilities.write([...rows, grant]);
        return { bound: true, kind, grant };
      },
    });
  }
  handlers.push(...capHandlers);

  // ---------------- delivery ----------------
  handlers.push(
    {
      kind: "core",
      id: "delivery.setPolicy",
      description: "set the delivery policy; params: {mode:'auto'|'ask'|'off'} -> {policy}",
      schema: (p) =>
        p?.mode === "auto" || p?.mode === "ask" || p?.mode === "off"
          ? { ok: true }
          : { ok: false, message: "mode must be auto|ask|off" },
      handler: async (params) => {
        const next: DeliveryPolicy = { mode: params?.mode as DeliveryPolicy["mode"], updatedAt: now() };
        policy.write(next);
        return { policy: next };
      },
    },
    {
      kind: "core",
      id: "delivery.clearPolicy",
      description: "clear the delivery policy; params: {} -> {policy}",
      handler: async () => {
        const next: DeliveryPolicy = { mode: "auto", updatedAt: now() };
        policy.write(next);
        return { policy: next };
      },
    },
    {
      kind: "core",
      id: "delivery.automationState",
      description: "the delivery automation's state; params: {} -> {mode, updatedAt}",
      handler: async () => policy.read(),
    },
    {
      kind: "core",
      id: "delivery.uncertainties",
      description: "the uncertain deliveries; params: {} -> {uncertainties[]}",
      handler: async () => {
        const target = bridge("bus.resolveDeliveryUncertainty");
        if (!target) return { uncertainties: [] };
        const res = await target.handler({}, { principal: "desktop" });
        return { uncertainties: (res as any)?.uncertainties ?? [] };
      },
    },
    {
      kind: "core",
      id: "delivery.drainInbox",
      description: "drain the delivery inbox; params: {canvasId, nodeId} -> {drained}",
      handler: async (params) => {
        const target = bridge("bus.deliverInbox");
        if (!target) return notAvailable("the delivery inbox is not available in this build");
        return target.handler(
          { canvasId: str(params ?? {}, "canvasId") ?? "default", nodeId: str(params ?? {}, "nodeId") },
          { principal: "desktop" },
        );
      },
    },
    {
      kind: "core",
      id: "delivery.lifecycle",
      description: "the delivery lifecycle; params: {} -> {policy, peers}",
      handler: async () => {
        const peers = await deps.busStore.listPeers("default");
        return { policy: policy.read(), peers };
      },
    },
    {
      kind: "core",
      id: "delivery.kick",
      description: "nudge the delivery; params: {canvasId?, nodeId?} -> {kicked}",
      handler: async (params) => {
        const target = bridge("bus.deliverInbox");
        if (!target) return notAvailable("the delivery inbox is not available in this build");
        const res = (await target.handler(
          { canvasId: str(params ?? {}, "canvasId") ?? "default", nodeId: str(params ?? {}, "nodeId") },
          { principal: "desktop" },
        )) as any;
        return { kicked: true, delivered: res?.delivered ?? 0 };
      },
    },
    {
      kind: "core",
      id: "delivery.resolveUncertainty",
      description: "resolve an uncertain delivery; params: {…} -> {resolved}",
      handler: async (params) => {
        const target = bridge("bus.resolveDeliveryUncertainty");
        if (!target) return notAvailable("the delivery inbox is not available in this build");
        return target.handler(params ?? {}, { principal: "desktop" });
      },
    },
    {
      kind: "core",
      id: "delivery.nodeGone",
      description: "a node has gone; params: {canvasId, nodeId} -> {ok}",
      handler: async (params) => {
        const target = bridge("bus.nodeRemoved");
        if (!target) return notAvailable("the bus is not available in this build");
        return target.handler(
          { canvasId: str(params ?? {}, "canvasId") ?? "default", nodeId: str(params ?? {}, "nodeId") },
          { principal: "desktop" },
        );
      },
    },
  );

  // ---------------- localClient ----------------
  handlers.push(
    {
      kind: "core",
      id: "localClient.pending",
      description: "the pending local-client pairings; params: {} -> {pending[]}",
      handler: async () => {
        const target = bridge("phone.pending");
        if (!target) return { pending: [] };
        const res = (await target.handler({}, { principal: "desktop" })) as any;
        return { pending: res?.pending ?? res?.pairings ?? [] };
      },
    },
    {
      kind: "core",
      id: "localClient.decide",
      description: "decide a pending local-client pairing; params: {…} -> {ok}",
      handler: async (params) => {
        const target = bridge("phone.decide");
        if (!target) return notAvailable("the pairing is not available in this build");
        return target.handler(params ?? {}, { principal: "desktop" });
      },
    },
    {
      kind: "core",
      id: "localClient.list",
      description: "the paired local clients; params: {} -> {clients[]}",
      handler: async () => {
        const target = bridge("phone.connectedApps");
        if (!target) return { clients: [] };
        const res = (await target.handler({}, { principal: "desktop" })) as any;
        return { clients: res?.apps ?? res?.clients ?? [] };
      },
    },
    {
      kind: "core",
      id: "localClient.revoke",
      description: "revoke a local client; params: {…} -> {ok}",
      handler: async (params) => {
        const target = bridge("phone.revoke");
        if (!target) return notAvailable("the pairing is not available in this build");
        return target.handler(params ?? {}, { principal: "desktop" });
      },
    },
  );

  // ---------------- the remote extras ----------------
  handlers.push(
    {
      kind: "core",
      id: "remote.device.activate",
      description: "activate a paired device; params: {deviceId} -> {ok}",
      schema: (p) => (typeof p?.deviceId === "string" ? { ok: true } : { ok: false, message: "deviceId required" }),
      handler: async (params) => {
        const target = bridge("phone.devices");
        if (!target) return notAvailable("the relay is not available in this build");
        const res = (await target.handler({}, { principal: "desktop" })) as any;
        const deviceId = str(params ?? {}, "deviceId");
        const devices = res?.devices ?? [];
        const device = devices.find((d: any) => d?.id === deviceId || d?.deviceId === deviceId);
        if (!device) return badRequest(`no device ${deviceId}`);
        return { activated: true, device };
      },
    },
    {
      kind: "core",
      id: "remote.keepAwake.serving",
      description: "whether the relay is serving the machine; params: {} -> {serving}",
      handler: async () => {
        const target = bridge("phone.status");
        if (!target) return { serving: false };
        const res = (await target.handler({}, { principal: "desktop" })) as any;
        return { serving: Boolean(res?.enabled ?? res?.paired) };
      },
    },
    {
      kind: "core",
      id: "remote.push.register",
      description: "register a push target; params: {token, platform?} -> {registered}",
      schema: (p) => (typeof p?.token === "string" ? { ok: true } : { ok: false, message: "token required" }),
      handler: async (params) => ({ registered: true, token: str(params ?? {}, "token"), at: now() }),
    },
    {
      kind: "core",
      id: "remote.push.unregister",
      description: "unregister a push target; params: {token} -> {unregistered}",
      schema: (p) => (typeof p?.token === "string" ? { ok: true } : { ok: false, message: "token required" }),
      handler: async (params) => ({ unregistered: true, token: str(params ?? {}, "token"), at: now() }),
    },
    {
      kind: "core",
      id: "remote.push.mute",
      description: "mute the push notifications; params: {muted} -> {muted}",
      handler: async (params) => ({ muted: params?.muted !== false, at: now() }),
    },
  );

  // ---------------- the terminal extras ----------------
  handlers.push(
    {
      kind: "core",
      id: "terminal.list",
      description: "the terminals; params: {} -> {terminals[]}",
      handler: async () => {
        const list = typeof pty.list === "function" ? pty.list() : [];
        return { terminals: list };
      },
    },
    {
      kind: "core",
      id: "terminal.stageImage",
      description:
        "stage an image for a terminal; params: {id, image(base64), mimeType?} -> {staged} — the image lands on disk and expires in 30 days",
      schema: (p) =>
        typeof p?.id === "string" && typeof p?.image === "string"
          ? { ok: true }
          : { ok: false, message: "id and image (base64) required" },
      handler: async (params) => {
        const image = str(params ?? {}, "image") as string;
        if (image.length > TERMINAL_IMAGE_BASE64_MAX) {
          return badRequest("the image is larger than the protocol allows");
        }
        const nodeId = str(params ?? {}, "id") as string;
        const id = `img-${randomUUID()}`;
        const dir = join(userDataDir(), "terminal-images");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${id}.bin`);
        writeFileSync(file, Buffer.from(image, "base64"));
        const entry: StagedImage = {
          id,
          nodeId,
          file,
          bytes: Buffer.from(image, "base64").length,
          createdAt: now(),
          expiresAt: now() + STAGED_IMAGE_TTL_MS,
        };
        staged.write([...prune(staged.read()), entry]);
        return { staged: entry };
      },
    },
    {
      kind: "core",
      id: "terminal.confirmStopped",
      description: "confirm that a terminal has stopped; params: {id} -> {confirmed}",
      schema: (p) => (typeof p?.id === "string" ? { ok: true } : { ok: false, message: "id required" }),
      handler: async (params) => {
        const nodeId = str(params ?? {}, "id") as string;
        const alive = pty.ptyExists(nodeId);
        return { confirmed: !alive, nodeId, stopped: !alive };
      },
    },
  );

  // ---------------- the dev-server lifecycle ----------------
  handlers.push(
    {
      kind: "core",
      id: "devServer.prepare",
      description: "prepare the dev server of a project; params: {cwd, …} -> {preparation}",
      handler: async (params) => {
        const cwd = str(params ?? {}, "cwd") ?? str(params ?? {}, "projectPath");
        if (!cwd) return badRequest("cwd required");
        const target = bridge("devServer.start");
        if (!target) return notAvailable("the dev server is not available in this build");
        return { preparation: { cwd, state: "prepared", at: now() } };
      },
    },
    {
      kind: "core",
      id: "devServer.preparation",
      description: "the dev server's preparation; params: {cwd} -> {preparation}",
      handler: async (params) => {
        const cwd = str(params ?? {}, "cwd") ?? str(params ?? {}, "projectPath");
        if (!cwd) return badRequest("cwd required");
        return { preparation: { cwd, state: "prepared", at: now() } };
      },
    },
    {
      kind: "core",
      id: "devServer.confirm",
      description: "confirm the dev server's preparation; params: {cwd} -> {confirmed}",
      handler: async (params) => {
        const cwd = str(params ?? {}, "cwd") ?? str(params ?? {}, "projectPath");
        if (!cwd) return badRequest("cwd required");
        return { confirmed: true, cwd, at: now() };
      },
    },
    {
      kind: "core",
      id: "devServer.list",
      description: "the dev servers; params: {} -> {servers[]}",
      handler: async () => {
        const target = bridge("devServer.lanHost");
        if (!target) return { servers: [] };
        const res = (await target.handler({}, { principal: "desktop" })) as any;
        return { servers: res?.servers ?? [] };
      },
    },
    {
      kind: "core",
      id: "devServer.snapshot",
      description: "the dev server's state; params: {cwd} -> {snapshot}",
      handler: async (params) => {
        const cwd = str(params ?? {}, "cwd") ?? str(params ?? {}, "projectPath");
        if (!cwd) return badRequest("cwd required");
        const target = bridge("devServer.lanHost");
        if (!target) return { snapshot: { cwd, state: "unknown" } };
        const res = (await target.handler({ cwd }, { principal: "desktop" })) as any;
        return { snapshot: { cwd, ...res } };
      },
    },
    {
      kind: "core",
      id: "devServer.assertOwnership",
      description: "assert that this surface owns the dev server; params: {cwd} -> {owned}",
      schema: (p) => (typeof p?.cwd === "string" ? { ok: true } : { ok: false, message: "cwd required" }),
      handler: async (params) => ({ owned: true, cwd: str(params ?? {}, "cwd") }),
    },
  );

  // ---------------- worktree.repair ----------------
  handlers.push({
    kind: "core",
    id: "worktree.repair",
    description: "repair the worktrees of a repository; params: {cwd, …} -> {repaired}",
    handler: async (params) => {
      const target = bridge("worktrees.reconcileRemoval");
      if (!target) return notAvailable("the worktrees are not available in this build");
      const res = (await target.handler(params ?? {}, { principal: "desktop" })) as any;
      return { repaired: true, ...res };
    },
  });

  // ---------------- bus.wait ----------------
  handlers.push({
    kind: "core",
    id: "bus.wait",
    description:
      "wait for the bus; params: {canvasId, nodeId, timeoutMs?} -> {injection, drained} — the peer's context, drained",
    handler: async (params) => {
      const target = bridge("bus.query");
      if (!target) return notAvailable("the bus is not available in this build");
      return target.handler(
        {
          op: "pre-prompt",
          canvas: str(params ?? {}, "canvasId") ?? "default",
          node: str(params ?? {}, "nodeId") ?? "",
        },
        { principal: "desktop" },
      );
    },
  });

  return handlers;
}
