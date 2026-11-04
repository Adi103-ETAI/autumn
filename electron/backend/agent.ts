// autumn — Wave-1 handlers: agent (2 dispatchable + events.onAgentQuestion(-Resolved) push; doc 31).
//
// Backing is REAL spawner/db: answerQuestion runs an agent via spawner and
// emits events.onAgentQuestion on a real trigger; pendingQuestions reads from
// Prisma Message/Task rows. Registered by index.ts; do not edit shared files.

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

const validCanvas = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0");

export function makeAgentHandlers(deps: W1Deps): RegisteredHandler[] {
  const { db, spawner, emit, now } = deps;

  const questionEvent = (canvasId: string, action: string, questionId: string, detail?: Record<string, unknown>) =>
    emit("events.onAgentQuestion", { canvasId, action, questionId, ts: now(), ...(detail ?? {}) });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "agent.answerQuestion",
      description:
        "answer an agent question via spawner; params: { canvasId, question, personaId?, harness? } -> spawner result + events.onAgentQuestionResolved",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.question === "string" &&
        (p?.personaId === undefined || typeof p.personaId === "string") &&
        (p?.harness === undefined || typeof p.harness === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId and question required; personaId/harness optional strings" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.question !== "string") return badParams("canvasId and question required");
        const questionId = `q-${now().toString(36)}`;
        let result: { text: string; simulated?: boolean; fellBack?: boolean; error?: string } = { text: "", simulated: true };
        if (spawner.runAgent) {
          result = await spawner.runAgent({ harness: p.harness, task: p.question, canvasId: p.canvasId, nodeId: p.personaId ?? questionId });
        }
        emit("events.onAgentQuestionResolved", { canvasId: p.canvasId, questionId, answer: result.text, ts: now(), ok: !result.error });
        return { questionId, text: result.text, simulated: result.simulated, fellBack: result.fellBack, error: result.error };
      },
    },
    {
      kind: "bridge",
      id: "agent.pendingQuestions",
      description:
        "pending agent questions; params: { canvasId? } -> { questions: [] } from db.message where role=commander (empty when none)",
      schema: (p) => (p?.canvasId === undefined || validCanvas(p.canvasId) ? { ok: true } : { ok: false, message: "canvasId optional string" }),
      handler: async (p = {}) => {
        if (p.canvasId !== undefined && !validCanvas(p.canvasId)) return badParams("canvasId must be a string");
        const rows = await db.message.findMany({
          where: { canvasId: p.canvasId ?? "default", nodeId: "commander", role: "commander" },
          orderBy: { createdAt: "desc" }, take: 50,
          select: { id: true, text: true, createdAt: true },
        });
        return { questions: rows.map((r: any) => ({ id: r.id, text: r.text, ts: r.createdAt.getTime() })) };
      },
    },
  ];

  return handlers;
}
