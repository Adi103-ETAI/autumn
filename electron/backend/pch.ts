// autumn — Wave-1 handlers: projectChatHistory (3 dispatchable; docs/architecture/backend.md).
//
// Backing is REAL where possible: Prisma Message rows for read/upsert, and
// commander-prompt for importLegacy parsing. Registered by index.ts; do not
// edit shared files.

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

export function makePchHandlers(deps: W1Deps): RegisteredHandler[] {
  const { db, emit, now } = deps;

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "projectChatHistory.importLegacy",
      description:
        "import legacy chat history; params: { canvasId, source, format? } -> { imported: number } (no legacy importer; documented empty)",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.source === "string" && (p?.format === undefined || typeof p.format === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId and source required; format optional string" },
      handler: () => ({ imported: 0, reason: "no legacy chat importer in autumn" }),
    },
    {
      kind: "bridge",
      id: "projectChatHistory.read",
      description:
        "read project chat history; params: { canvasId, nodeId?, limit? } -> { messages: [...] } from db.message",
      schema: (p) =>
        validCanvas(p?.canvasId) &&
        (p?.nodeId === undefined || typeof p.nodeId === "string") &&
        (p?.limit === undefined || (Number.isFinite(p.limit) && p.limit >= 1))
          ? { ok: true }
          : { ok: false, message: "canvasId required; nodeId/limit optional" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const limit = Math.min(500, Math.max(1, Number(p.limit) || 100));
        const where: { canvasId: string; nodeId?: string } = { canvasId: p.canvasId };
        if (p.nodeId) where.nodeId = p.nodeId;
        const rows = await db.message.findMany({ where, orderBy: { createdAt: "asc" }, take: limit, select: { id: true, nodeId: true, role: true, text: true, authorId: true, createdAt: true } });
        return { canvasId: p.canvasId, messages: rows.map((r: any) => ({ id: r.id, nodeId: r.nodeId, role: r.role, text: r.text, authorId: r.authorId, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "projectChatHistory.upsert",
      description:
        "upsert a project chat message; params: { canvasId, nodeId, role, text, authorId? } -> created message",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.nodeId === "string" && typeof p?.role === "string" && typeof p?.text === "string" &&
        (p?.authorId === undefined || typeof p.authorId === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId, nodeId, role, text required; authorId optional string" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.nodeId !== "string" || typeof p.role !== "string" || typeof p.text !== "string") {
          return badParams("canvasId, nodeId, role, text required");
        }
        const created = await db.message.create({
          data: { canvasId: p.canvasId, nodeId: p.nodeId, role: p.role, text: p.text, authorId: p.authorId ?? null },
        });
        return { id: created.id, canvasId: created.canvasId, nodeId: created.nodeId, role: created.role, text: created.text, authorId: created.authorId, createdAt: created.createdAt.getTime() };
      },
    },
  ];

  return handlers;
}
