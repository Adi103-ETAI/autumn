// autumn — Wave-1 handlers: artifacts (12 dispatchable + artifacts.onChanged push; docs/architecture/backend.md).
//
// Backing is REAL Prisma: Artifact / ArtifactVersion (canvasId is a plain
// string, no FK — artifacts may outlive a canvas row). `onChanged` is a push
// producer, not a handler. Registered by index.ts; do not edit shared files.

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
const validKind = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64 && !v.includes("\0");
const validName = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0");

export function makeArtifactsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { db, emit, now } = deps;

  const changed = (canvasId: string, artifactId: string, action: "saved" | "restored" | "deleted" | "retired") =>
    emit("artifacts.onChanged", { canvasId, artifactId, action, ts: now() });

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "artifacts.usage",
      description:
        "artifact usage facts derived from real rows (not telemetry); params: { artifactId?, canvasId? } -> { artifactId?, canvasId?, versionCount, retired, totalContentBytes, createdAt, updatedAt }",
      schema: (p) =>
        (p?.artifactId === undefined || typeof p.artifactId === "string") &&
        (p?.canvasId === undefined || validCanvas(p.canvasId))
          ? { ok: true }
          : { ok: false, message: "artifactId/canvasId optional strings" },
      handler: async (p = {}) => {
        if (p.artifactId !== undefined && typeof p.artifactId !== "string") return badParams("artifactId must be a string when given");
        if (p.canvasId !== undefined && !validCanvas(p.canvasId)) return badParams("canvasId must be a string when given");
        if (p.artifactId) {
          const a = await db.artifact.findUnique({ where: { id: p.artifactId } });
          if (!a) return notFound(`artifact not found: ${p.artifactId}`);
          const versionCount = (await db.artifactVersion.findMany({ where: { artifactId: p.artifactId } })).length;
          return { artifactId: p.artifactId, versionCount, retired: a.retired, totalContentBytes: Buffer.byteLength(a.content ?? "", "utf8"), createdAt: a.createdAt.getTime(), updatedAt: a.updatedAt.getTime() };
        }
        const where: { canvasId?: string } = p.canvasId ? { canvasId: p.canvasId } : {};
        const rows = await db.artifact.findMany({ where, select: { content: true, retired: true, createdAt: true, updatedAt: true } });
        return { canvasId: p.canvasId ?? null, count: rows.length, retired: rows.filter((r: any) => r.retired).length, totalContentBytes: rows.reduce((acc: number, r: any) => acc + Buffer.byteLength(r.content ?? "", "utf8"), 0) };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.catalog",
      description:
        "list artifacts for a canvas; params: { canvasId, kind? } -> { items: [{ id, name, kind, version, retired, createdAt, updatedAt }] }",
      schema: (p) =>
        (p?.canvasId === undefined || validCanvas(p.canvasId)) && (p?.kind === undefined || validKind(p.kind))
          ? { ok: true }
          : { ok: false, message: "canvasId optional string; kind optional string" },
      handler: async (p = {}) => {
        if (p.canvasId !== undefined && !validCanvas(p.canvasId)) return badParams("canvasId must be a string");
        if (p.kind !== undefined && !validKind(p.kind)) return badParams("kind must be a string");
        const where: { canvasId?: string; kind?: string; retired?: boolean } = {};
        if (p.canvasId) where.canvasId = p.canvasId;
        if (p.kind) where.kind = p.kind;
        where.retired = false;
        const rows = await db.artifact.findMany({
          where, orderBy: { updatedAt: "desc" },
          select: { id: true, canvasId: true, name: true, kind: true, version: true, retired: true, createdAt: true, updatedAt: true },
        });
        return { items: rows.map((r: any) => ({ id: r.id, canvasId: r.canvasId, name: r.name, kind: r.kind, version: r.version, retired: r.retired, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.deleteVersions",
      description:
        "delete old versions of an artifact; params: { artifactId, keepLatest?: number } -> { deleted: number }",
      schema: (p) =>
        typeof p?.artifactId === "string" &&
        (p?.keepLatest === undefined || (Number.isFinite(p.keepLatest) && p.keepLatest >= 0))
          ? { ok: true }
          : { ok: false, message: "artifactId required; keepLatest optional number >= 0" },
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        const keepLatest = Math.floor(Number(p.keepLatest) || 0);
        const versions = await db.artifactVersion.findMany({
          where: { artifactId: p.artifactId }, orderBy: { version: "desc" },
          select: { id: true, version: true },
        });
        const toDelete = versions.slice(keepLatest);
        for (const v of toDelete) await db.artifactVersion.delete({ where: { id: v.id } });
        changed(artifact.canvasId, p.artifactId, "deleted");
        return { artifactId: p.artifactId, deleted: toDelete.length };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.export",
      description:
        "export an artifact document; params: { artifactId } -> { artifact, versions } or not-found",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        const versions = await db.artifactVersion.findMany({
          where: { artifactId: p.artifactId }, orderBy: { version: "asc" },
          select: { id: true, version: true, content: true, path: true, createdAt: true },
        });
        return { artifact: { id: artifact.id, name: artifact.name, kind: artifact.kind, content: artifact.content, path: artifact.path, meta: artifact.meta }, versions: versions.map((v: any) => ({ id: v.id, version: v.version, content: v.content, path: v.path, createdAt: v.createdAt.getTime() })) };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.get",
      description:
        "get one artifact; params: { artifactId } -> artifact row or not-found",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        return { id: artifact.id, canvasId: artifact.canvasId, name: artifact.name, kind: artifact.kind, path: artifact.path, content: artifact.content, version: artifact.version, retired: artifact.retired, meta: artifact.meta, createdAt: artifact.createdAt.getTime(), updatedAt: artifact.updatedAt.getTime() };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.previewHtml",
      description:
        "preview HTML for an artifact; params: { artifactId, version? } -> { html } or not-found",
      schema: (p) =>
        typeof p?.artifactId === "string" &&
        (p?.version === undefined || Number.isInteger(p.version) && p.version >= 1)
          ? { ok: true }
          : { ok: false, message: "artifactId required; version optional integer >= 1" },
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        let content = artifact.content;
        if (p.version !== undefined) {
          const v = (await db.artifactVersion.findMany({ where: { artifactId: p.artifactId, version: Math.floor(p.version) }, take: 1 }))[0];
          if (!v) return notFound(`version ${p.version} not found for artifact ${p.artifactId}`);
          content = v.content;
        }
        const kind = artifact.kind;
        const html = kind === "html" ? (content ?? "") : kind === "text" ? `<pre>${(content ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>` : `<div>artifact ${artifact.name} (${kind})</div>`;
        return { artifactId: p.artifactId, version: p.version ?? artifact.version, html };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.read",
      description:
        "read artifact content; params: { artifactId, version? } -> { content } or not-found",
      schema: (p) =>
        typeof p?.artifactId === "string" &&
        (p?.version === undefined || Number.isInteger(p.version) && p.version >= 1)
          ? { ok: true }
          : { ok: false, message: "artifactId required; version optional integer >= 1" },
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        let content: string | null = null;
        let version: number | undefined;
        if (p.version !== undefined) {
          const v = (await db.artifactVersion.findMany({ where: { artifactId: p.artifactId, version: Math.floor(p.version) }, take: 1 }))[0];
          if (!v) return notFound(`version ${p.version} not found for artifact ${p.artifactId}`);
          content = v.content ?? null;
          version = v.version;
        } else {
          const a = await db.artifact.findUnique({ where: { id: p.artifactId } });
          if (!a) return notFound(`artifact not found: ${p.artifactId}`);
          content = a.content ?? null;
          version = a.version;
        }
        return { artifactId: p.artifactId, version, content };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.restore",
      description:
        "restore an artifact to a version; params: { artifactId, version } -> restored artifact + artifacts.onChanged",
      schema: (p) =>
        typeof p?.artifactId === "string" && Number.isInteger(p.version) && p.version >= 1
          ? { ok: true }
          : { ok: false, message: "artifactId required; version integer >= 1 required" },
      handler: async (p) => {
        if (typeof p?.artifactId !== "string" || !Number.isInteger(p.version) || p.version < 1) return badParams("artifactId required; version integer >= 1 required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        const v = (await db.artifactVersion.findMany({ where: { artifactId: p.artifactId, version: p.version }, take: 1 }))[0];
        if (!v) return notFound(`version ${p.version} not found for artifact ${p.artifactId}`);
        const updated = await db.artifact.update({
          where: { id: p.artifactId },
          data: { content: v.content, path: v.path, version: p.version, meta: v.meta, updatedAt: new Date() },
        });
        changed(artifact.canvasId, p.artifactId, "restored");
        return { id: updated.id, version: updated.version, content: updated.content, path: updated.path };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.retire",
      description:
        "retire an artifact (soft-delete); params: { artifactId } -> retired + artifacts.onChanged",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        const updated = await db.artifact.update({ where: { id: p.artifactId }, data: { retired: true, updatedAt: new Date() } });
        changed(artifact.canvasId, p.artifactId, "retired");
        return { id: updated.id, retired: updated.retired };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.reveal",
      description:
        "reveal an artifact's on-disk path; params: { artifactId } -> { path } or not-found (path may be null)",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        return { artifactId: p.artifactId, path: artifact.path ?? null };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.save",
      description:
        "save/create an artifact (+ a version snapshot); params: { canvasId, name, kind?, content?, path? } -> artifact + artifacts.onChanged",
      schema: (p) =>
        validCanvas(p?.canvasId) && validName(p?.name) &&
        (p?.kind === undefined || validKind(p.kind)) &&
        (p?.content === undefined || typeof p.content === "string") &&
        (p?.path === undefined || typeof p.path === "string")
          ? { ok: true }
          : { ok: false, message: "canvasId and name required; kind/content/path optional strings" },
      handler: async (p) => {
        if (!validCanvas(p.canvasId) || !validName(p.name)) return badParams("canvasId and name required");
        const kind = p.kind ?? "file";
        const existing = (await db.artifact.findMany({ where: { canvasId: p.canvasId, name: p.name, retired: false }, take: 1 }))[0];
        let artifact: any;
        if (existing) {
          await db.artifactVersion.create({
            data: { artifactId: existing.id, version: existing.version + 1, content: existing.content, path: existing.path, meta: existing.meta },
          });
          artifact = await db.artifact.update({
            where: { id: existing.id },
            data: { content: p.content ?? null, path: p.path ?? null, version: existing.version + 1, updatedAt: new Date() },
          });
        } else {
          artifact = await db.artifact.create({
            data: { canvasId: p.canvasId, name: p.name, kind, content: p.content ?? null, path: p.path ?? null, version: 1 },
          });
          await db.artifactVersion.create({
            data: { artifactId: artifact.id, version: 1, content: p.content ?? null, path: p.path ?? null },
          });
        }
        changed(p.canvasId, artifact.id, "saved");
        return { id: artifact.id, canvasId: artifact.canvasId, name: artifact.name, kind: artifact.kind, version: artifact.version, content: artifact.content, path: artifact.path };
      },
    },
    {
      kind: "bridge",
      id: "artifacts.versions",
      description:
        "list versions of an artifact; params: { artifactId } -> { versions: [...] } or not-found",
      schema: (p) => (typeof p?.artifactId === "string" ? { ok: true } : { ok: false, message: "artifactId required" }),
      handler: async (p) => {
        if (typeof p?.artifactId !== "string") return badParams("artifactId required");
        const artifact = await db.artifact.findUnique({ where: { id: p.artifactId } });
        if (!artifact) return notFound(`artifact not found: ${p.artifactId}`);
        const versions = await db.artifactVersion.findMany({
          where: { artifactId: p.artifactId }, orderBy: { version: "desc" },
          select: { id: true, version: true, content: true, path: true, meta: true, createdAt: true },
        });
        return { artifactId: p.artifactId, versions: versions.map((v: any) => ({ id: v.id, version: v.version, content: v.content, path: v.path, meta: v.meta, createdAt: v.createdAt.getTime() })) };
      },
    },
  ];

  return handlers;
}
