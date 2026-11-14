// autumn — the core protocol's content groups (Wave 4, doc 35 §7).
//
// The surfaces the other principals drive: the questions the agents ask, the
// commands the canvas runs, the facts, the documents, the chat turns and the
// agent sessions.
//
// Like the rest of the core surface, every method delegates to the backend
// that already does the work — the questions to the agents, the commands to
// the canvas, the chat to the project chat, the sessions to the database.

import type { RegisteredHandler } from "../handlers";
import type { W1Deps } from "../w1-deps";
import { badRequest, delegate, dispatcher, str, type BridgeLookup } from "./support";

export function makeCoreSurfaceGroups(deps: W1Deps, bridge: BridgeLookup): RegisteredHandler[] {
  const { db, now } = deps;
  const handlers: RegisteredHandler[] = [];

  // ---------------- ui (the questions the agents ask) ----------------
  handlers.push(
    delegate(bridge, {
      id: "ui.request",
      bridge: "agent.pendingQuestions",
      description: "the questions the agents are asking; params: {canvasId?, nodeId?} -> {questions[]}",
    }),
    delegate(bridge, {
      id: "ui.list",
      bridge: "agent.pendingQuestions",
      description: "the pending questions; params: {canvasId?, nodeId?} -> {questions[]}",
    }),
    delegate(bridge, {
      id: "ui.await",
      bridge: "agent.pendingQuestions",
      description: "the pending questions (awaiting an answer); params: {canvasId?, nodeId?}",
    }),
    delegate(bridge, {
      id: "ui.resolve",
      bridge: "agent.answerQuestion",
      description: "answer a question; params: {questionId, answer} -> {answered}",
      map: (p) => ({
        questionId: p.questionId ?? p.id,
        answer: p.answer ?? p.text ?? p.value ?? "",
        canvasId: p.canvasId,
      }),
    }),
    delegate(bridge, {
      id: "ui.cancel",
      bridge: "agent.answerQuestion",
      description: "cancel a question; params: {questionId} -> {cancelled}",
      map: (p) => ({
        questionId: p.questionId ?? p.id,
        answer: "__cancelled__",
        canvasId: p.canvasId,
      }),
    }),
    delegate(bridge, {
      id: "ui.cancelNode",
      bridge: "agent.pendingQuestions",
      description: "cancel every question of a node; params: {nodeId} -> {questions[]}",
      map: (p) => ({ canvasId: p.canvasId, nodeId: p.nodeId ?? p.id }),
    }),
  );

  // ---------------- ui.command (the canvas commands) ----------------
  handlers.push(
    delegate(bridge, {
      id: "ui.command.request",
      bridge: "canvas.stageCommand",
      description: "run a command on the canvas; params: {command, …} -> {command}",
      map: (p) => ({ ...p, op: p.op ?? "run" }),
    }),
    delegate(bridge, {
      id: "ui.command.stage",
      bridge: "canvas.stageCommand",
      description: "stage a command on the canvas; params: {command, …} -> {command}",
    }),
    delegate(bridge, {
      id: "ui.command.list",
      bridge: "canvas.pendingCommands",
      description: "the queued commands; params: {canvasId?} -> {commands[]}",
    }),
    delegate(bridge, {
      id: "ui.command.status",
      bridge: "canvas.pendingCommands",
      description: "the state of the queued commands; params: {canvasId?} -> {commands[]}",
    }),
    delegate(bridge, {
      id: "ui.command.progress",
      bridge: "canvas.commandProgress",
      description: "the progress of a command; params: {canvasId, requestId} -> {progress}",
    }),
    delegate(bridge, {
      id: "ui.command.await",
      bridge: "canvas.commandResult",
      description: "the result of a command; params: {canvasId, requestId} -> {result}",
    }),
    delegate(bridge, {
      id: "ui.command.resolve",
      bridge: "canvas.commandResult",
      description: "resolve a command; params: {canvasId, requestId, result} -> {resolved}",
    }),
    delegate(bridge, {
      id: "ui.command.cancel",
      bridge: "canvas.commandResult",
      description: "cancel a command; params: {canvasId, requestId} -> {cancelled}",
      map: (p) => ({ ...p, result: { cancelled: true } }),
    }),
  );

  // ---------------- facts ----------------
  handlers.push(
    dispatcher(bridge, {
      id: "facts.query",
      description:
        "read the facts; params: {operation:'notification'|'listNotifications'|'listLatestRunUsages'|'listNodeWorkflows'|'listPrObservations'|'listDeckTriage', args?}",
      ops: {
        notification: { bridge: "agent.pendingQuestions" },
        listNotifications: { bridge: "agent.pendingQuestions" },
        listLatestRunUsages: { bridge: "sessions.library" },
        listNodeWorkflows: { bridge: "tasks.chatQueue" },
        listPrObservations: { bridge: "git.prFacts" },
        listDeckTriage: { bridge: "slides.status" },
      },
      whenMissing: "the facts are not available in this build",
    }),
    {
      kind: "core",
      id: "facts.mutate",
      description:
        "change the facts; params: {op:'recordRunUsage'|'markNotificationSeen'|'dismissNotification', args?} -> {ok}",
      schema: (p) => (typeof p?.op === "string" ? { ok: true } : { ok: false, message: "op required" }),
      handler: async (params) => {
        const op = str(params ?? {}, "op") as string;
        const args = Array.isArray(params?.args) ? (params?.args as any[]) : [];
        if (op === "recordRunUsage") {
          const input = (args[0] ?? {}) as Record<string, unknown>;
          await db.agentLog.createMany({
            data: [
              {
                canvasId: String(input.canvasId ?? "default"),
                nodeId: String(input.nodeId ?? "unknown"),
                kind: "run_usage",
                text: JSON.stringify(input),
                meta: "{}",
              },
            ],
          });
          return { ok: true, recorded: true };
        }
        if (op === "markNotificationSeen" || op === "dismissNotification") {
          // The questions live in the agents' own store; answering one is how
          // it is marked as seen.
          const target = bridge("agent.answerQuestion");
          const questionId = args[0] as string | undefined;
          if (!target || !questionId) {
            return badRequest(`${op} needs a questionId`);
          }
          await target.handler(
            { questionId, answer: op === "dismissNotification" ? "__dismissed__" : "__seen__" },
            { principal: "desktop" },
          );
          return { ok: true };
        }
        return badRequest(`facts.mutate does not know the op "${op}"`);
      },
    },
  );

  // ---------------- document ----------------
  handlers.push(
    delegate(bridge, {
      id: "document.facts",
      bridge: "artifacts.get",
      description: "the facts of a document; params: {artifactId, …} -> {artifact}",
      map: (p) => ({ artifactId: p.artifactId ?? p.documentId ?? p.id }),
    }),
    delegate(bridge, {
      id: "document.hold",
      bridge: "artifacts.retire",
      description: "hold a document (stop it from changing); params: {artifactId, …} -> {artifact}",
      map: (p) => ({ artifactId: p.artifactId ?? p.documentId ?? p.id }),
    }),
    delegate(bridge, {
      id: "document.release",
      bridge: "artifacts.restore",
      description: "release a held document; params: {artifactId, …} -> {artifact}",
      map: (p) => ({ artifactId: p.artifactId ?? p.documentId ?? p.id }),
    }),
    delegate(bridge, {
      id: "document.forget",
      bridge: "artifacts.deleteVersions",
      description: "forget a document (drop its versions); params: {artifactId, …} -> {ok}",
      map: (p) => ({ artifactId: p.artifactId ?? p.documentId ?? p.id }),
    }),
  );

  // ---------------- chat ----------------
  handlers.push(
    delegate(bridge, {
      id: "chat.append",
      bridge: "projectChatHistory.upsert",
      description: "append to the project chat; params: {canvasId, …} -> {message}",
    }),
    delegate(bridge, {
      id: "chat.history",
      bridge: "projectChatHistory.read",
      description: "the project chat's history; params: {canvasId} -> {messages[]}",
    }),
    delegate(bridge, {
      id: "chat.turn.request",
      bridge: "bus.startChatTurn",
      description: "ask a chat agent to do something; params: {canvasId, nodeId, text} -> {turn}",
    }),
    delegate(bridge, {
      id: "chat.turn.claim",
      bridge: "bus.claimProjectChatInbox",
      description: "claim the next chat turn; params: {canvasId, nodeId} -> {turn}",
    }),
    delegate(bridge, {
      id: "chat.turn.running",
      bridge: "bus.executionStates",
      description: "the chat turns that are running; params: {canvasId} -> {states[]}",
    }),
    delegate(bridge, {
      id: "chat.turn.complete",
      bridge: "tasks.closeChatSession",
      description: "complete a chat turn; params: {canvasId, nodeId} -> {ok}",
    }),
    delegate(bridge, {
      id: "chat.turn.cancel",
      bridge: "tasks.cancel",
      description: "cancel a chat turn; params: {canvasId, nodeId} -> {ok}",
    }),
    delegate(bridge, {
      id: "chat.turn.list",
      bridge: "tasks.chatQueue",
      description: "the queued chat turns; params: {canvasId} -> {queue[]}",
    }),
  );

  // ---------------- agent ----------------
  handlers.push(
    {
      kind: "core",
      id: "agent.list",
      description: "the agent sessions; params: {canvasId?, engine?} -> {agents[]}",
      handler: async (params) => {
        const where: Record<string, unknown> = {};
        if (str(params ?? {}, "canvasId")) where.canvasId = str(params ?? {}, "canvasId");
        if (str(params ?? {}, "engine")) where.engine = str(params ?? {}, "engine");
        const rows = await db.session.findMany({ where, orderBy: { updatedAt: "desc" } });
        return {
          agents: rows.map((row: any) => ({
            id: row.id,
            canvasId: row.canvasId,
            nodeId: row.nodeId,
            engine: row.engine,
            title: row.title,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
          })),
        };
      },
    },
    {
      kind: "core",
      id: "agent.begin",
      description: "open an agent session; params: {canvasId, engine?, title?, nodeId?} -> {agent}",
      schema: (p) => (typeof p?.canvasId === "string" ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (params) => {
        const canvasId = str(params ?? {}, "canvasId") as string;
        const session = await db.session.create({
          data: {
            canvasId,
            engine: str(params ?? {}, "engine") ?? "codex",
            title: str(params ?? {}, "title") ?? `Session ${now()}`,
            ...(str(params ?? {}, "nodeId") ? { nodeId: str(params ?? {}, "nodeId") } : {}),
            messages: "[]",
          },
        });
        return { agent: { id: (session as any).id, canvasId, engine: (session as any).engine } };
      },
    },
    {
      kind: "core",
      id: "agent.finish",
      description: "close an agent session; params: {agentId} -> {agent}",
      schema: (p) => (typeof p?.agentId === "string" ? { ok: true } : { ok: false, message: "agentId required" }),
      handler: async (params) => {
        const agentId = str(params ?? {}, "agentId") as string;
        const session = await db.session.update({
          where: { id: agentId },
          data: { updatedAt: new Date(now()) },
        });
        return { agent: { id: agentId, finished: true } };
      },
    },
    {
      kind: "core",
      id: "agent.drop",
      description: "drop an agent session; params: {agentId} -> {dropped}",
      schema: (p) => (typeof p?.agentId === "string" ? { ok: true } : { ok: false, message: "agentId required" }),
      handler: async (params) => {
        const agentId = str(params ?? {}, "agentId") as string;
        await db.session.delete({ where: { id: agentId } });
        return { dropped: true, agentId };
      },
    },
    {
      kind: "core",
      id: "agent.reconcile",
      description: "the agent sessions that need reconciling; params: {canvasId?} -> {agents[]}",
      handler: async (params) => {
        const where: Record<string, unknown> = {};
        if (str(params ?? {}, "canvasId")) where.canvasId = str(params ?? {}, "canvasId");
        const rows = await db.session.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 });
        return {
          agents: rows.map((row: any) => ({
            id: row.id,
            engine: row.engine,
            title: row.title,
            stale: true,
          })),
        };
      },
    },
    {
      kind: "core",
      id: "agent.issueCapability",
      description:
        "issue a capability to an agent; params: {methods[], expiresAt?, purpose?} -> {grant} — the grant is what the capability principal may call",
      schema: (p) =>
        Array.isArray(p?.methods) && p.methods.length > 0
          ? { ok: true }
          : { ok: false, message: "methods[] required" },
      handler: async (params) => {
        const target = bridge("capability.registerEndpoint");
        if (!target) return badRequest("the capability registry is not available in this build");
        return target.handler(params ?? {}, { principal: "desktop" });
      },
    },
  );

  return handlers;
}
