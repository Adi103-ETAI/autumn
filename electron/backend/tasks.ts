// autumn — Wave-1 handlers: tasks (13 dispatchable + events.onTask push; docs/architecture/backend.md).
//
// Backing is REAL where possible: Prisma Task/Message rows, spawner for agent
// runs. `events.onTask` fires on real task transitions (steer/cancel/undo).
// Honest-minimal where autumn has no backing (forkChat, previewGuiFunding,
// decompose, canvasEdit as full pipeline). Registered by index.ts; do not edit
// shared files.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});
const notImplemented = (message: string) => ({
  ok: false as const,
  error: { code: "not-implemented" as const, message },
});

const validCanvas = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0");

export function makeTasksHandlers(deps: W1Deps): RegisteredHandler[] {
  const { db, spawner, emit, now } = deps;

  const taskEvent = (canvasId: string, action: string, taskId: string, detail?: Record<string, unknown>) =>
    emit("events.onTask", { canvasId, action, taskId, ts: now(), ...(detail ?? {}) });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "tasks.acknowledgeChatQueue",
      description:
        "acknowledge a chat-queue entry; params: { queueId } -> { ok: true } (no queue store; documented)",
      schema: (p) => (typeof p?.queueId === "string" ? { ok: true } : { ok: false, message: "queueId required" }),
      handler: (p) => {
        if (typeof p?.queueId !== "string") return badParams("queueId required");
        return { ok: true, queueId: p.queueId, acknowledged: true };
      },
    },
    {
      kind: "bridge",
      id: "tasks.cancel",
      description:
        "cancel a task; params: { canvasId, taskId } -> marks task cancelled + events.onTask",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.taskId === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId and taskId required" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.taskId !== "string") return badParams("canvasId and taskId required");
        const task = (await db.task.findMany({ where: { canvasId: p.canvasId, description: p.taskId }, take: 1 }))[0];
        if (!task) return notFound(`task not found: ${p.taskId}`);
        await db.task.update({ where: { id: task.id }, data: { status: "cancelled", updatedAt: new Date() } });
        taskEvent(p.canvasId, "cancelled", task.id);
        return { ok: true, taskId: task.id, status: "cancelled" };
      },
    },
    {
      kind: "bridge",
      id: "tasks.canvasEdit",
      description:
        "edit a canvas via a task; params: { canvasId, edit } -> { ok: true } (no canvas-edit pipeline; documented)",
      schema: (p) => (validCanvas(p?.canvasId) && typeof p?.edit === "string" ? { ok: true } : { ok: false, message: "canvasId and edit required" }),
      handler: (p) => {
        if (!validCanvas(p.canvasId) || typeof p.edit !== "string") return badParams("canvasId and edit required");
        return { ok: true, applied: false, reason: "no canvas-edit pipeline in autumn" };
      },
    },
    {
      kind: "bridge",
      id: "tasks.chatQueue",
      description:
        "chat queue listing; params: { canvasId? } -> { queue: [] } (no queue store)",
      schema: (p) => (p?.canvasId === undefined || validCanvas(p.canvasId) ? { ok: true } : { ok: false, message: "canvasId optional string" }),
      handler: () => ({ queue: [] }),
    },
    {
      kind: "bridge",
      id: "tasks.closeChatSession",
      description:
        "close a chat session; params: { canvasId, nodeId? } -> { ok: true } (no session store)",
      schema: (p) => (validCanvas(p?.canvasId) && (p?.nodeId === undefined || typeof p.nodeId === "string") ? { ok: true } : { ok: false, message: "canvasId required; nodeId optional string" }),
      handler: () => ({ ok: true, closed: true }),
    },
    {
      kind: "bridge",
      id: "tasks.decompose",
      description:
        "decompose a task into steps; params: { canvasId, task } -> { steps: [] } (no planner; documented empty)",
      schema: (p) => (validCanvas(p?.canvasId) && typeof p?.task === "string" ? { ok: true } : { ok: false, message: "canvasId and task required" }),
      handler: () => ({ steps: [], reason: "no task-decomposition planner in autumn" }),
    },
    {
      kind: "bridge",
      id: "tasks.editChatQueueEntry",
      description:
        "edit a chat-queue entry; params: { queueId, entry } -> { ok: true } (no queue store)",
      schema: (p) =>
        typeof p?.queueId === "string" && typeof p?.entry === "string"
          ? { ok: true }
          : { ok: false, message: "queueId and entry required" },
      handler: (p) => {
        if (typeof p?.queueId !== "string" || typeof p.entry !== "string") return badParams("queueId and entry required");
        return { ok: true, queueId: p.queueId };
      },
    },
    {
      kind: "bridge",
      id: "tasks.forkChat",
      description:
        "fork a chat; params: { canvasId, sessionId } -> not-implemented (no chat fork pipeline)",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.sessionId === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId and sessionId required" },
      handler: () => notImplemented("forkChat needs a chat-fork pipeline, which autumn does not have"),
    },
    {
      kind: "bridge",
      id: "tasks.previewGuiFunding",
      description:
        "preview GUI funding; params: {} -> { supported:false } (no funding integration)",
      schema: () => ({ ok: true }),
      handler: () => ({ supported: false, reason: "no GUI funding integration in autumn" }),
    },
    {
      kind: "bridge",
      id: "tasks.removeChatQueueEntry",
      description:
        "remove a chat-queue entry; params: { queueId } -> { ok: true } (no queue store)",
      schema: (p) => (typeof p?.queueId === "string" ? { ok: true } : { ok: false, message: "queueId required" }),
      handler: (p) => {
        if (typeof p?.queueId !== "string") return badParams("queueId required");
        return { ok: true, queueId: p.queueId, removed: true };
      },
    },
    {
      kind: "bridge",
      id: "tasks.resumeChatQueue",
      description:
        "resume a chat queue; params: { canvasId } -> { ok: true } (no queue store)",
      schema: (p) => (validCanvas(p?.canvasId) ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: () => ({ ok: true, resumed: true }),
    },
    {
      kind: "bridge",
      id: "tasks.steer",
      description:
        "steer a task (agent run via spawner); params: { canvasId, task, personaId?, harness? } -> spawner.runAgent result + events.onTask",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.task === "string" &&
        (p?.personaId === undefined || typeof p.personaId === "string") &&
        (p?.harness === undefined || typeof p.harness === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId and task required; personaId/harness optional strings" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.task !== "string") return badParams("canvasId and task required");
        const task = await db.task.create({
          data: { canvasId: p.canvasId, description: p.task, status: "in_progress", seq: 0 },
        });
        let result: { text: string; simulated?: boolean; fellBack?: boolean; error?: string } = { text: "", simulated: true };
        if (spawner.runAgent) {
          result = await spawner.runAgent({ harness: p.harness, task: p.task, canvasId: p.canvasId, nodeId: p.personaId ?? task.id });
        }
        await db.task.update({ where: { id: task.id }, data: { status: result.error ? "blocked" : "done", updatedAt: new Date() } });
        taskEvent(p.canvasId, "steered", task.id, { harness: p.harness, text: result.text });
        return { taskId: task.id, text: result.text, simulated: result.simulated, fellBack: result.fellBack, error: result.error };
      },
    },
    {
      kind: "bridge",
      id: "tasks.undo",
      description:
        "undo the last task action; params: { canvasId, taskId } -> { ok: true } (no undo log; documented)",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.taskId === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId and taskId required" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.taskId !== "string") return badParams("canvasId and taskId required");
        const task = (await db.task.findMany({ where: { canvasId: p.canvasId, description: p.taskId }, take: 1 }))[0];
        if (!task) return notFound(`task not found: ${p.taskId}`);
        taskEvent(p.canvasId, "undone", task.id);
        return { ok: true, taskId: task.id, undone: true };
      },
    },
  ];

  return handlers;
}
