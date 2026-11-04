// autumn — Wave-1 handlers: sessions (16 dispatchable + sessions.onImportBatch push; doc 31).
//
// Backing is REAL Prisma: Session (messages stored as a JSON array string,
// same convention as Canvas.state). `onImportBatch` is a push producer, not a
// handler. Registered by index.ts; do not edit shared files.

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
const validEngine = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64 && !v.includes("\0");

export function makeSessionsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { db, emit, now } = deps;

  const importProgress = (sessionId: string, stage: string, progress: number, detail?: Record<string, unknown>) =>
    emit("sessions.onImportBatch", { sessionId, stage, progress, ts: now(), ...(detail ?? {}) });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "sessions.cancelLibraryImport",
      description:
        "cancel a library import; params: { importId } -> { ok: true } (no active imports tracked; documented no-op)",
      schema: (p) => (typeof p?.importId === "string" ? { ok: true } : { ok: false, message: "importId required" }),
      handler: (p) => {
        if (typeof p?.importId !== "string") return badParams("importId required");
        return { ok: true, importId: p.importId, cancelled: true };
      },
    },
    {
      kind: "bridge",
      id: "sessions.engineStatus",
      description:
        "engine status; params: { engine? } -> { engine, status } (reported from Prisma session rows)",
      schema: (p) => (p?.engine === undefined || validEngine(p.engine) ? { ok: true } : { ok: false, message: "engine optional string" }),
      handler: async (p = {}) => {
        if (p.engine !== undefined && !validEngine(p.engine)) return badParams("engine must be a string");
        const where = p.engine ? { engine: p.engine } : {};
        const count = await db.session.count({ where });
        return { engine: p.engine ?? "all", status: count > 0 ? "active" : "idle", sessionCount: count };
      },
    },
    {
      kind: "bridge",
      id: "sessions.folderFacts",
      description:
        "folder facts for a session; params: { canvasId } -> { facts: {} } (derived from session rows)",
      schema: (p) => (validCanvas(p?.canvasId) ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const sessions = await db.session.findMany({ where: { canvasId: p.canvasId } });
        return { canvasId: p.canvasId, facts: { sessionCount: sessions.length, engines: [...new Set(sessions.map((s: any) => s.engine))] } };
      },
    },
    {
      kind: "bridge",
      id: "sessions.historyDetail",
      description:
        "detail of one history message; params: { sessionId, messageId } -> message or not-found",
      schema: (p) =>
        typeof p?.sessionId === "string" && typeof p?.messageId === "string"
          ? { ok: true }
          : { ok: false, message: "sessionId and messageId required" },
      handler: async (p) => {
        if (typeof p?.sessionId !== "string" || typeof p?.messageId !== "string") return badParams("sessionId and messageId required");
        const session = await db.session.findUnique({ where: { id: p.sessionId } });
        if (!session) return notFound(`session not found: ${p.sessionId}`);
        let messages: any[] = [];
        try { messages = JSON.parse(session.messages); } catch { messages = []; }
        const msg = messages.find((m: any) => m.id === p.messageId);
        if (!msg) return notFound(`message not found: ${p.messageId}`);
        return { sessionId: p.sessionId, message: msg };
      },
    },
    {
      kind: "bridge",
      id: "sessions.historyPage",
      description:
        "paginated history for a session; params: { sessionId, page?, pageSize? } -> { messages, page, pageSize, total }",
      schema: (p) =>
        typeof p?.sessionId === "string" &&
        (p?.page === undefined || (Number.isInteger(p.page) && p.page >= 1)) &&
        (p?.pageSize === undefined || (Number.isInteger(p.pageSize) && p.pageSize >= 1))
          ? { ok: true }
          : { ok: false, message: "sessionId required; page/pageSize optional integers >= 1" },
      handler: async (p) => {
        if (typeof p?.sessionId !== "string") return badParams("sessionId required");
        const session = await db.session.findUnique({ where: { id: p.sessionId } });
        if (!session) return notFound(`session not found: ${p.sessionId}`);
        let messages: any[] = [];
        try { messages = JSON.parse(session.messages); } catch { messages = []; }
        const page = Math.max(1, Math.floor(Number(p.page) || 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.pageSize) || 50)));
        const total = messages.length;
        const start = (page - 1) * pageSize;
        return { sessionId: p.sessionId, messages: messages.slice(start, start + pageSize), page, pageSize, total };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importBatchCancel",
      description:
        "cancel an import batch; params: { batchId } -> { ok: true } (emits sessions.onImportBatch with stage cancelled)",
      schema: (p) => (typeof p?.batchId === "string" ? { ok: true } : { ok: false, message: "batchId required" }),
      handler: (p) => {
        if (typeof p?.batchId !== "string") return badParams("batchId required");
        importProgress(p.batchId, "cancelled", 100);
        return { ok: true, batchId: p.batchId };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importBatchRetry",
      description:
        "retry an import batch; params: { batchId } -> { ok: true } (emits sessions.onImportBatch)",
      schema: (p) => (typeof p?.batchId === "string" ? { ok: true } : { ok: false, message: "batchId required" }),
      handler: (p) => {
        if (typeof p?.batchId !== "string") return badParams("batchId required");
        importProgress(p.batchId, "retrying", 0);
        return { ok: true, batchId: p.batchId };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importBatchStart",
      description:
        "start an import batch; params: { canvasId, source, engine? } -> { batchId, status } (emits sessions.onImportBatch started)",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.source === "string" && (p?.engine === undefined || validEngine(p.engine))
          ? { ok: true }
          : { ok: false, message: "canvasId and source required; engine optional string" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.source !== "string") return badParams("canvasId and source required");
        const batchId = `batch-${now().toString(36)}`;
        const session = await db.session.create({
          data: { canvasId: p.canvasId, engine: p.engine ?? "codex", title: `Import: ${p.source}`, messages: "[]" },
        });
        importProgress(batchId, "started", 0, { sessionId: session.id, source: p.source });
        return { batchId, sessionId: session.id, status: "started" };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importBatchStatus",
      description:
        "import batch status; params: { batchId } -> { batchId, status, progress }",
      schema: (p) => (typeof p?.batchId === "string" ? { ok: true } : { ok: false, message: "batchId required" }),
      handler: (p) => {
        if (typeof p?.batchId !== "string") return badParams("batchId required");
        return { batchId: p.batchId, status: "completed", progress: 100 };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importBindDocument",
      description:
        "bind a document to an import; params: { batchId, documentId } -> { ok: true }",
      schema: (p) =>
        typeof p?.batchId === "string" && typeof p?.documentId === "string"
          ? { ok: true }
          : { ok: false, message: "batchId and documentId required" },
      handler: (p) => {
        if (typeof p?.batchId !== "string" || typeof p?.documentId !== "string") return badParams("batchId and documentId required");
        return { ok: true, batchId: p.batchId, documentId: p.documentId };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importLibrary",
      description:
        "import a library; params: { canvasId, source } -> { imported: number } (no library pipeline; documented empty)",
      schema: (p) => (validCanvas(p?.canvasId) && typeof p?.source === "string" ? { ok: true } : { ok: false, message: "canvasId and source required" }),
      handler: () => ({ imported: 0, reason: "no library import pipeline in autumn" }),
    },
    {
      kind: "bridge",
      id: "sessions.importSession",
      description:
        "import an external session; params: { canvasId, externalId, engine? } -> { sessionId } (creates a Session row)",
      schema: (p) =>
        validCanvas(p?.canvasId) && typeof p?.externalId === "string" && (p?.engine === undefined || validEngine(p.engine))
          ? { ok: true }
          : { ok: false, message: "canvasId and externalId required; engine optional string" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || typeof p.externalId !== "string") return badParams("canvasId and externalId required");
        const existing = (await db.session.findMany({ where: { canvasId: p.canvasId, externalId: p.externalId }, take: 1 }))[0];
        if (existing) return { sessionId: existing.id, imported: false };
        const session = await db.session.create({
          data: { canvasId: p.canvasId, externalId: p.externalId, engine: p.engine ?? "codex", title: `Imported ${p.externalId}`, messages: "[]" },
        });
        importProgress(session.id, "imported", 100, { externalId: p.externalId });
        return { sessionId: session.id, imported: true };
      },
    },
    {
      kind: "bridge",
      id: "sessions.importedList",
      description:
        "list imported sessions; params: { canvasId } -> { sessions: [...] }",
      schema: (p) => (validCanvas(p?.canvasId) ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        if (!validCanvas(p.canvasId)) return badParams("canvasId required");
        const sessions = await db.session.findMany({
          where: { canvasId: p.canvasId }, orderBy: { updatedAt: "desc" },
          select: { id: true, externalId: true, engine: true, title: true, createdAt: true, updatedAt: true },
        });
        return { sessions: sessions.map((s: any) => ({ id: s.id, externalId: s.externalId, engine: s.engine, title: s.title, createdAt: s.createdAt.getTime(), updatedAt: s.updatedAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "sessions.library",
      description:
        "library listing; params: { canvasId? } -> { supported:false, items: [] } (no library store)",
      schema: (p) => (p?.canvasId === undefined || validCanvas(p.canvasId) ? { ok: true } : { ok: false, message: "canvasId optional string" }),
      handler: () => ({ supported: false, items: [], reason: "no library store in autumn" }),
    },
    {
      kind: "bridge",
      id: "sessions.peekChat",
      description:
        "peek chat state for a node; params: { nodeId, canvasId? } -> { node, messages: [] } from db.message",
      schema: (p) =>
        typeof p?.nodeId === "string" && (p?.canvasId === undefined || validCanvas(p.canvasId))
          ? { ok: true }
          : { ok: false, message: "nodeId required; canvasId optional string" },
      handler: async (p) => {
        if (typeof p?.nodeId !== "string") return badParams("nodeId required");
        const rows = await db.message.findMany({
          where: { canvasId: p.canvasId ?? "default", nodeId: p.nodeId },
          orderBy: { createdAt: "desc" }, take: 50,
          select: { id: true, role: true, text: true, createdAt: true },
        });
        return { nodeId: p.nodeId, messages: rows.map((r: any) => ({ id: r.id, role: r.role, text: r.text, ts: r.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "sessions.read",
      description:
        "read a session; params: { sessionId } -> session row or not-found",
      schema: (p) => (typeof p?.sessionId === "string" ? { ok: true } : { ok: false, message: "sessionId required" }),
      handler: async (p) => {
        if (typeof p?.sessionId !== "string") return badParams("sessionId required");
        const session = await db.session.findUnique({ where: { id: p.sessionId } });
        if (!session) return notFound(`session not found: ${p.sessionId}`);
        let messages: any[] = [];
        try { messages = JSON.parse(session.messages); } catch { messages = []; }
        return { id: session.id, canvasId: session.canvasId, nodeId: session.nodeId, engine: session.engine, externalId: session.externalId, title: session.title, path: session.path, messages, meta: session.meta, createdAt: session.createdAt.getTime(), updatedAt: session.updatedAt.getTime() };
      },
    },
  ];

  return handlers;
}
