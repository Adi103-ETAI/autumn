// autumn — Wave-2 handlers: backends (23 dispatchable; doc 32 §2d).
//
// RE-derived (October-amd64.deb app.asar out/main/index.js: IPC wiring
// backendsList/backendsCreate/.../backendsConvexCreate + renderer call shapes in
// CanvasView/index chunks). The target's backends are CLOUD databases (Supabase/
// Convex adapters, org provisioning, sbp_ access tokens). autumn's design (doc 32
// §2d) is a LOCAL-FIRST mini data platform: named backends on disk with typed
// collection schemas, a guarded destructive-op queue, and an in-process local
// runtime. Same id surface, same call shapes, local backing — documented deviation.
//
// Storage layout (all under AUTUMN_USER_DATA_DIR via store.ts):
//   <userData>/backends/index.json           {backends:[{id,slug,name,linkedProjects[]}]}
//   <userData>/backends/<slug>/backend.json  {id,name,slug,createdAt,description,schema:{collections:[{name,fields:[{name,type}]}]}}
//   <userData>/backends/<slug>/data.json     {<collection>: [docs…]}
//   <userData>/backends/<slug>/pending.json  approval queue (destructive ops)
//   <userData>/backends/<slug>/meta.json     {syncedAt?, schemaVersion?, docsCount?, local?:{running,startedAt,pid}}
//   <userData>/backends/<slug>/client.ts     scaffolded typed client (regenerated on schema write)
//
// RE call shapes respected: create/provision/update take ONE object; link takes
// {id, app, projectPath, framework} (we read id+projectPath); localStart/
// localStop/localStatus take a bare id (string → paramsOf pos); sync takes
// {id, direction}; pending/approve/reject take ids positionally (changeId).

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { loadJson, saveJson, userDataDir } from "./store";
import { paramsOf, str } from "./params";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

// ---------------------------------------------------------------------------
// types + storage
// ---------------------------------------------------------------------------

type FieldType = "string" | "number" | "boolean" | "object" | "array" | "datetime";
const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "object", "array", "datetime"];

interface Field {
  name: string;
  type: FieldType;
}
interface Collection {
  name: string;
  fields: Field[];
}
interface BackendSchema {
  collections: Collection[];
}
interface Backend {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: number;
  schema: BackendSchema;
}
interface RegistryRow {
  id: string;
  slug: string;
  name: string;
  linkedProjects: string[];
}
interface Registry {
  backends: RegistryRow[];
}
type ApprovalStatus = "pending" | "approved" | "rejected";
interface Approval {
  approvalId: string;
  backendId: string;
  op: "dropCollection" | "wipeRows";
  collection?: string;
  /** Schema to apply on approve (dropCollection). */
  proposedSchema?: BackendSchema;
  requestedAt: number;
  status: ApprovalStatus;
  note?: string;
}
interface LocalState {
  running: boolean;
  startedAt?: number;
  stoppedAt?: number;
  pid?: number;
}
interface Meta {
  syncedAt?: number;
  schemaVersion?: number;
  docsCount?: number;
  local?: LocalState;
}

const backendsDir = () => join(userDataDir(), "backends");
const indexFile = () => join(backendsDir(), "index.json");
const dirOf = (slug: string) => join(backendsDir(), slug);
const backendFile = (slug: string) => join(dirOf(slug), "backend.json");
const dataFile = (slug: string) => join(dirOf(slug), "data.json");
const pendingFile = (slug: string) => join(dirOf(slug), "pending.json");
const metaFile = (slug: string) => join(dirOf(slug), "meta.json");
const clientFile = (slug: string) => join(dirOf(slug), "client.ts");

function readRegistry(): Registry {
  const r = loadJson<Registry>(indexFile(), { backends: [] });
  return Array.isArray(r.backends) ? r : { backends: [] };
}
function writeRegistry(r: Registry): void {
  mkdirSync(backendsDir(), { recursive: true });
  saveJson(indexFile(), r);
}
function readBackend(slug: string): Backend | null {
  try {
    const b = JSON.parse(readFileSync(backendFile(slug), "utf8")) as Backend;
    return b && b.id && b.slug === slug ? b : null;
  } catch {
    return null;
  }
}
function writeBackend(b: Backend): void {
  mkdirSync(dirOf(b.slug), { recursive: true });
  saveJson(backendFile(b.slug), b);
}
function readData(slug: string): Record<string, Record<string, unknown>[]> {
  return loadJson<Record<string, Record<string, unknown>[]>>(dataFile(slug), {});
}
function writeData(slug: string, data: Record<string, Record<string, unknown>[]>): void {
  mkdirSync(dirOf(slug), { recursive: true });
  saveJson(dataFile(slug), data);
}
function readPending(slug: string): Approval[] {
  const p = loadJson<Approval[]>(pendingFile(slug), []);
  return Array.isArray(p) ? p : [];
}
function writePending(slug: string, list: Approval[]): void {
  mkdirSync(dirOf(slug), { recursive: true });
  saveJson(pendingFile(slug), list);
}
function readMeta(slug: string): Meta {
  return loadJson<Meta>(metaFile(slug), {});
}
function writeMeta(slug: string, m: Meta): void {
  mkdirSync(dirOf(slug), { recursive: true });
  saveJson(metaFile(slug), m);
}

/** Registry lookup by id (or slug) → row + backend, or null. */
function findEntry(idOrSlug: string): { row: RegistryRow; backend: Backend } | null {
  const r = readRegistry();
  const row = r.backends.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!row) return null;
  const backend = readBackend(row.slug);
  if (!backend) return null;
  return { row, backend };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "backend";
}
function uniqueSlug(want: string): string {
  const taken = new Set(readRegistry().backends.map((b) => b.slug));
  if (!taken.has(want)) return want;
  for (let n = 2; n < 1000; n++) {
    const cand = `${want}-${n}`;
    if (!taken.has(cand)) return cand;
  }
  return `${want}-${Date.now().toString(36)}`;
}

function validateSchema(collections: unknown): { ok: true; collections: Collection[] } | { ok: false; message: string } {
  if (!Array.isArray(collections)) return { ok: false, message: "collections must be an array" };
  const names = new Set<string>();
  const out: Collection[] = [];
  for (const c of collections as unknown[]) {
    if (!c || typeof c !== "object") return { ok: false, message: "each collection must be an object" };
    const col = c as Record<string, unknown>;
    const name = col.name;
    if (typeof name !== "string" || !COLLECTION_RE.test(name)) {
      return { ok: false, message: `invalid collection name: ${String(name)}` };
    }
    if (names.has(name)) return { ok: false, message: `duplicate collection: ${name}` };
    names.add(name);
    const fieldsRaw = col.fields;
    const fields: Field[] = [];
    if (fieldsRaw !== undefined) {
      if (!Array.isArray(fieldsRaw)) return { ok: false, message: `fields of ${name} must be an array` };
      const fnames = new Set<string>();
      for (const f of fieldsRaw as unknown[]) {
        if (!f || typeof f !== "object") return { ok: false, message: `invalid field in ${name}` };
        const fld = f as Record<string, unknown>;
        if (typeof fld.name !== "string" || !FIELD_RE.test(fld.name)) {
          return { ok: false, message: `invalid field name in ${name}: ${String(fld.name)}` };
        }
        if (fnames.has(fld.name)) return { ok: false, message: `duplicate field ${fld.name} in ${name}` };
        fnames.add(fld.name);
        if (typeof fld.type !== "string" || !FIELD_TYPES.includes(fld.type as FieldType)) {
          return { ok: false, message: `invalid field type for ${name}.${fld.name}: ${String(fld.type)} (expected ${FIELD_TYPES.join("|")})` };
        }
        fields.push({ name: fld.name, type: fld.type as FieldType });
      }
    }
    out.push({ name, fields });
  }
  return { ok: true, collections: out };
}

/** Typed client scaffold — regenerated on every schema write (RE: client.ts). */
function renderClient(b: Backend): string {
  const cols = b.schema.collections;
  const union = cols.length ? cols.map((c) => JSON.stringify(c.name)).join(" | ") : "never";
  const rowTypes = cols
    .map((c) => {
      const props = c.fields.map((f) => `  ${f.name}: ${tsType(f.type)};`).join("\n");
      return `export interface ${cap(c.name)} {\n${props || "  _?: never;"}\n}`;
    })
    .join("\n");
  return `// autogenerated by autumn backends.scaffoldClient — do not edit (regenerated on schema change)
// backend: ${b.name} (${b.slug})

export type CollectionName = ${union};

${rowTypes || "export interface _NoCollections {}"}

export type Row<C extends CollectionName> = C extends "never" ? Record<string, unknown> : never;

export async function query<C extends CollectionName>(collection: C): Promise<Row<C>[]> {
  // Reads <backend>/data.json via the autumn facade: window.autumn.backends.query
  throw new Error("wire this to window.autumn.backends.query({ id: ${JSON.stringify(b.id)}, collection })");
}

export async function mutate<C extends CollectionName>(collection: C, doc: Row<C>): Promise<void> {
  // Writes through the autumn facade — never touch data.json directly.
  throw new Error("wire this to window.autumn.backends (agent-facing mutations go through approvals)");
}
`;
}
function tsType(t: FieldType): string {
  switch (t) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "Record<string, unknown>";
    case "array":
      return "unknown[]";
    case "datetime":
      return "string";
    default:
      return "string";
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function writeClient(b: Backend): void {
  try {
    mkdirSync(dirOf(b.slug), { recursive: true });
    writeFileSync(clientFile(b.slug), renderClient(b), "utf8");
  } catch {
    /* scaffold is best-effort */
  }
}

/** Field-op filters (RE querySql subset): eq/neq/gt/lt/gte/lte/contains/in. */
type FilterOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
const FILTER_OPS: FilterOp[] = ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in"];

function applyFilter(row: Record<string, unknown>, filter: unknown): boolean {
  if (filter == null) return true;
  const conds = Array.isArray(filter) ? filter : [filter];
  for (const c of conds) {
    if (!c || typeof c !== "object") throw new Error("filter condition must be an object {field, op, value}");
    const { field, op, value } = c as Record<string, unknown>;
    if (typeof field !== "string") throw new Error("filter.field must be a string");
    if (typeof op !== "string" || !FILTER_OPS.includes(op as FilterOp)) {
      throw new Error(`filter.op must be one of ${FILTER_OPS.join("/")}`);
    }
    const v = row[field];
    let pass = false;
    switch (op as FilterOp) {
      case "eq":
        pass = v === value;
        break;
      case "neq":
        pass = v !== value;
        break;
      case "gt":
        pass = (v as number) > (value as number);
        break;
      case "lt":
        pass = (v as number) < (value as number);
        break;
      case "gte":
        pass = (v as number) >= (value as number);
        break;
      case "lte":
        pass = (v as number) <= (value as number);
        break;
      case "contains":
        pass = typeof v === "string" && typeof value === "string" && v.includes(value);
        break;
      case "in":
        pass = Array.isArray(value) && value.includes(v);
        break;
    }
    if (!pass) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeBackendsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now, spawner } = deps;

  const rowOf = (b: Backend): RegistryRow & { collections: number; linked: number } => {
    const row = readRegistry().backends.find((r) => r.id === b.id);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      linkedProjects: row?.linkedProjects ?? [],
      collections: b.schema.collections.length,
      linked: row?.linkedProjects.length ?? 0,
    };
  };

  const handlers: RegisteredHandler[] = [
    // ----- registry CRUD -----------------------------------------------------
    {
      kind: "bridge",
      id: "backends.create",
      description:
        "create a local backend; params: {name, description?} -> {id, slug, name, ...} (slugify+scaffold; RE shape create(input) single object)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.name === "string" && NAME_RE.test(obj.name)
          ? { ok: true }
          : { ok: false, message: "name required (letters/digits/space/-/_ , 1-64 chars)" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const name = obj.name as string;
        const description = typeof obj.description === "string" ? obj.description : undefined;
        const slug = uniqueSlug(slugify(name));
        const b: Backend = { id: now().toString(36) + Math.random().toString(36).slice(2, 8), name, slug, createdAt: now(), schema: { collections: [] }, ...(description ? { description } : {}) };
        writeBackend(b);
        writeData(slug, {});
        writePending(slug, []);
        writeMeta(slug, {});
        writeClient(b);
        const r = readRegistry();
        r.backends.push({ id: b.id, slug, name, linkedProjects: [] });
        writeRegistry(r);
        return rowOf(b);
      },
    },
    {
      kind: "bridge",
      id: "backends.list",
      description: "list local backends; params: {} -> rows [{id,slug,name,linkedProjects,collections,linked}] (RE listBackends)",
      handler: () => readRegistry().backends.map((row) => {
        const b = readBackend(row.slug);
        return { ...row, collections: b?.schema.collections.length ?? 0, linked: row.linkedProjects.length };
      }),
    },
    {
      kind: "bridge",
      id: "backends.update",
      description: "rename/describe a backend; params: {id, name?, description?} -> row | not-found (RE updateBackend single object)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const b = entry.backend;
        if (obj.name !== undefined) {
          if (typeof obj.name !== "string" || !NAME_RE.test(obj.name)) return badParams("name must be 1-64 chars");
          b.name = obj.name;
        }
        if (obj.description !== undefined) {
          if (typeof obj.description !== "string") return badParams("description must be a string");
          b.description = obj.description;
        }
        writeBackend(b);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === b.id);
        if (row) row.name = b.name;
        writeRegistry(r);
        return rowOf(b);
      },
    },
    {
      kind: "bridge",
      id: "backends.remove",
      description: "delete a backend; params: {id, confirm:true} -> {removed:true} (confirm required; RE remove(id) — we require confirm per doc 2d)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        if (obj.confirm !== true) return badParams("confirm:true is required to delete a backend");
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        rmSync(dirOf(entry.backend.slug), { recursive: true, force: true });
        const r = readRegistry();
        r.backends = r.backends.filter((x) => x.id !== entry.backend.id);
        writeRegistry(r);
        return { removed: true, id: entry.backend.id };
      },
    },

    // ----- project links -----------------------------------------------------
    {
      kind: "bridge",
      id: "backends.link",
      description: "link a backend to a project; params: {id, projectPath} (RE passes app/framework too — ignored) -> row | bad-params/not-found",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && typeof obj.projectPath === "string"
          ? { ok: true }
          : { ok: false, message: "id and projectPath required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const projectPath = obj.projectPath as string;
        if (!isAbsolute(projectPath)) return badParams("projectPath must be absolute");
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === entry.backend.id)!;
        if (!row.linkedProjects.includes(projectPath)) row.linkedProjects.push(projectPath);
        writeRegistry(r);
        return rowOf(entry.backend);
      },
    },
    {
      kind: "bridge",
      id: "backends.unlink",
      description: "unlink a project; params: {id, projectPath} -> row | not-found (RE unlink single object)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && typeof obj.projectPath === "string"
          ? { ok: true }
          : { ok: false, message: "id and projectPath required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === entry.backend.id)!;
        row.linkedProjects = row.linkedProjects.filter((p) => p !== (obj.projectPath as string));
        writeRegistry(r);
        return rowOf(entry.backend);
      },
    },

    // ----- schema ------------------------------------------------------------
    {
      kind: "bridge",
      id: "backends.schema",
      description:
        "read/write schema; params: {id} -> {collections} | {id, collections} -> {collections, clientWritten:true} (field types string|number|boolean|object|array|datetime; validates; regenerates client.ts)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        if (obj.collections === undefined) return { collections: entry.backend.schema.collections };
        const v = validateSchema(obj.collections);
        if (!v.ok) return badParams(v.message);
        entry.backend.schema = { collections: v.collections };
        writeBackend(entry.backend);
        writeClient(entry.backend); // RE: regenerate client.ts on schema write
        return { collections: entry.backend.schema.collections, clientWritten: true };
      },
    },

    // ----- data plane --------------------------------------------------------
    {
      kind: "bridge",
      id: "backends.query",
      description:
        "query rows; params: {id, collection, filter?, sort?, limit?} -> {rows, total} (field ops eq/neq/gt/lt/gte/lte/contains/in; RE querySql subset, local rows)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && typeof obj.collection === "string"
          ? { ok: true }
          : { ok: false, message: "id and collection required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const collection = obj.collection as string;
        if (!entry.backend.schema.collections.some((c) => c.name === collection)) {
          return notFound(`no collection ${collection} in backend ${entry.backend.name}`);
        }
        const rows = readData(entry.backend.slug)[collection] ?? [];
        let out: Record<string, unknown>[];
        try {
          out = rows.filter((r) => applyFilter(r, obj.filter));
        } catch (e) {
          return badParams((e as Error).message);
        }
        if (obj.sort !== undefined && obj.sort !== null) {
          const s = obj.sort as Record<string, unknown>;
          if (!s || typeof s !== "object" || typeof s.field !== "string") return badParams("sort must be {field, dir?}");
          const dir = s.dir === "desc" ? -1 : 1;
          out = [...out].sort((a, b) => {
            const av = a[s.field as string];
            const bv = b[s.field as string];
            if (av === bv) return 0;
            return (av! > bv! ? 1 : -1) * dir;
          });
        }
        const total = out.length;
        if (typeof obj.limit === "number" && Number.isFinite(obj.limit) && obj.limit >= 0) out = out.slice(0, obj.limit);
        return { rows: out, total };
      },
    },
    {
      kind: "bridge",
      id: "backends.peek",
      description: "inspect a backend; params: {id} -> {collections:[{name,count,fields}], sizeBytes} (RE peek(p))",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const data = readData(entry.backend.slug);
        const collections = entry.backend.schema.collections.map((c) => ({
          name: c.name,
          count: (data[c.name] ?? []).length,
          fields: c.fields,
        }));
        let sizeBytes = 0;
        for (const f of [backendFile(entry.backend.slug), dataFile(entry.backend.slug)]) {
          try {
            sizeBytes += readFileSync(f).byteLength;
          } catch {
            /* missing file = 0 */
          }
        }
        return { collections, sizeBytes };
      },
    },

    // ----- destructive-op approval queue (RE pending/approve/reject) ---------
    {
      kind: "bridge",
      id: "backends.pending",
      description: "list approval-queue entries; params: {id?} -> {approvals:[...]} (RE pending(id) positional)",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id");
        const out: Approval[] = [];
        for (const row of readRegistry().backends) {
          if (id && row.id !== id && row.slug !== id) continue;
          out.push(...readPending(row.slug).filter((a) => a.status === "pending"));
        }
        return { approvals: out };
      },
    },
    {
      kind: "bridge",
      id: "backends.approve",
      description:
        "approve a queued destructive op; params: {approvalId} | approvalId -> executes it for real (drops collection rows+schema) -> {approved:true, applied}",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        return str(obj, pos, "approvalId", "changeId") ? { ok: true } : { ok: false, message: "approvalId required" };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const approvalId = str(obj, pos, "approvalId", "changeId") as string;
        for (const row of readRegistry().backends) {
          const list = readPending(row.slug);
          const a = list.find((x) => x.approvalId === approvalId);
          if (!a) continue;
          if (a.status !== "pending") return badParams(`approval ${approvalId} already ${a.status}`);
          const b = readBackend(row.slug);
          if (!b) return notFound(`backend ${row.slug} disappeared`);
          if (a.op === "dropCollection" && a.collection) {
            // REAL effect: delete rows + drop from schema.
            const data = readData(row.slug);
            delete data[a.collection];
            writeData(row.slug, data);
            b.schema = { collections: b.schema.collections.filter((c) => c.name !== a.collection) };
            writeBackend(b);
            writeClient(b);
          } else if (a.op === "wipeRows" && a.collection) {
            const data = readData(row.slug);
            data[a.collection] = [];
            writeData(row.slug, data);
          }
          a.status = "approved";
          a.requestedAt = now();
          writePending(row.slug, list);
          return { approved: true, applied: { op: a.op, collection: a.collection ?? null, backendId: b.id } };
        }
        return notFound(`no pending approval ${approvalId}`);
      },
    },
    {
      kind: "bridge",
      id: "backends.reject",
      description: "reject a queued destructive op; params: {approvalId, note?} -> {rejected:true} (dropped with note; nothing executed)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        return str(obj, pos, "approvalId", "changeId") ? { ok: true } : { ok: false, message: "approvalId required" };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const approvalId = str(obj, pos, "approvalId", "changeId") as string;
        const note = str(obj, [], "note");
        for (const row of readRegistry().backends) {
          const list = readPending(row.slug);
          const a = list.find((x) => x.approvalId === approvalId);
          if (!a) continue;
          if (a.status !== "pending") return badParams(`approval ${approvalId} already ${a.status}`);
          a.status = "rejected";
          if (note) a.note = note;
          writePending(row.slug, list);
          return { rejected: true, approvalId, ...(note ? { note } : {}) };
        }
        return notFound(`no pending approval ${approvalId}`);
      },
    },

    // ----- agent ask + client scaffold --------------------------------------
    {
      kind: "bridge",
      id: "backends.ask",
      description:
        "ask the agent about this backend; params: {id, question} -> {text, ...} (runs the spawner with the schema as context; error envelope when no harness runs)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && typeof obj.question === "string"
          ? { ok: true }
          : { ok: false, message: "id and question required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        if (!spawner?.runAgent) return { ok: false, error: { code: "handler-error", message: "no agent runner available" } };
        const context = JSON.stringify({ backend: entry.backend.name, schema: entry.backend.schema });
        const result = await spawner.runAgent({
          harness: "claude-code",
          task: `You are querying a local data backend. Schema: ${context}\n\nQuestion: ${obj.question as string}`,
          canvasId: "default",
          nodeId: `backend-${entry.backend.id}`,
        });
        if (result.error) return { ok: false, error: { code: "handler-error", message: result.error } };
        return { text: result.text, simulated: result.simulated ?? false, fellBack: result.fellBack ?? false };
      },
    },
    {
      kind: "bridge",
      id: "backends.scaffoldClient",
      description:
        "write the typed client; params: {id, targetDir?} -> {path, bytes} (writes backendClient.ts into targetDir or the backend dir; RE scaffoldClient(p) writes into the bound project)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const target = typeof obj.targetDir === "string" && obj.targetDir.length > 0 ? obj.targetDir : dirOf(entry.backend.slug);
        if (!isAbsolute(target)) return badParams("targetDir must be absolute");
        mkdirSync(target, { recursive: true });
        const file = join(target, "backendClient.ts");
        const body = renderClient(entry.backend);
        writeFileSync(file, body, "utf8");
        return { path: file, bytes: Buffer.byteLength(body) };
      },
    },

    // ----- orgs (RE listOrgs — target requires an sbp_ Supabase token; autumn is single-local-org) -----
    {
      kind: "bridge",
      id: "backends.listOrgs",
      description:
        "list organizations; params: {} -> {items:[{id:'local', name:'Local (this machine)'}]} (target needs a Supabase access token — autumn is local-first, one org; documented deviation)",
      handler: () => ({ items: [{ id: "local", name: "Local (this machine)" }] }),
    },

    // ----- provisioning (RE provision(input) creates a cloud backend; autumn: template onto a local backend) -----
    {
      kind: "bridge",
      id: "backends.provision",
      description:
        "apply a starter template; params: {id, template:'todo'|'notes'|'blank', resetData?} -> {collections, ...} (RE provision creates a cloud DB; autumn applies a template schema locally — documented deviation)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const template = typeof obj.template === "string" ? obj.template : "blank";
        let collections: Collection[];
        if (template === "todo") {
          collections = [
            { name: "todo", fields: [{ name: "title", type: "string" }, { name: "done", type: "boolean" }] },
          ];
        } else if (template === "notes") {
          collections = [
            { name: "note", fields: [{ name: "title", type: "string" }, { name: "body", type: "string" }, { name: "createdAt", type: "datetime" }] },
          ];
        } else if (template === "blank") {
          collections = [];
        } else {
          return badParams(`unknown template ${template} (expected todo|notes|blank)`);
        }
        entry.backend.schema = { collections };
        writeBackend(entry.backend);
        writeClient(entry.backend);
        if (obj.resetData === true) writeData(entry.backend.slug, {});
        return { id: entry.backend.id, slug: entry.backend.slug, template, collections, reset: obj.resetData === true };
      },
    },

    // ----- local runtime (RE localStart/localStop/localStatus — target runs `supabase start`; autumn runs an in-process registry) -----
    {
      kind: "bridge",
      id: "backends.localStart",
      description: "start the local backend runtime; params: id (string) -> {running:true, startedAt, pid} (in-process registry, real transitions)",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const meta = readMeta(entry.backend.slug);
        if (meta.local?.running) return { running: true, startedAt: meta.local.startedAt, pid: meta.local.pid, alreadyRunning: true };
        const local: LocalState = { running: true, startedAt: now(), pid: process.pid };
        writeMeta(entry.backend.slug, { ...meta, local });
        return { running: true, startedAt: local.startedAt, pid: local.pid };
      },
    },
    {
      kind: "bridge",
      id: "backends.localStop",
      description: "stop the local backend runtime; params: id (string) -> {running:false, stoppedAt}",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const meta = readMeta(entry.backend.slug);
        const local: LocalState = { running: false, stoppedAt: now() };
        writeMeta(entry.backend.slug, { ...meta, local });
        return { running: false, stoppedAt: local.stoppedAt };
      },
    },
    {
      kind: "bridge",
      id: "backends.localStatus",
      description: "local runtime status; params: id (string) -> {running, startedAt?, pid?, stoppedAt?}",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const local = readMeta(entry.backend.slug).local;
        return { running: local?.running ?? false, ...(local?.startedAt ? { startedAt: local.startedAt } : {}), ...(local?.pid ? { pid: local.pid } : {}), ...(local?.stoppedAt ? { stoppedAt: local.stoppedAt } : {}) };
      },
    },

    // ----- sync markers (RE sync({id, direction}) — autumn writes local markers) -----
    {
      kind: "bridge",
      id: "backends.sync",
      description: "write sync markers; params: {id, direction?} -> {synced:true, at, docsCount, schemaVersion} (local marker file; target syncs to Supabase — documented deviation)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" ? { ok: true } : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const data = readData(entry.backend.slug);
        const docsCount = Object.values(data).reduce((n, rows) => n + rows.length, 0);
        const meta = readMeta(entry.backend.slug);
        const next: Meta = { ...meta, syncedAt: now(), schemaVersion: (meta.schemaVersion ?? 0) + 1, docsCount };
        writeMeta(entry.backend.slug, next);
        return { synced: true, at: next.syncedAt, docsCount, schemaVersion: next.schemaVersion, direction: typeof obj.direction === "string" ? obj.direction : "up" };
      },
    },

    // ----- Convex boundary ids (doc 32 §2a — autumn has no Convex dependency) -----
    {
      kind: "bridge",
      id: "backends.convexAuthStatus",
      description: "Convex cloud auth status; params: {} -> not-implemented envelope (autumn has no Convex dependency; doc 32 §2a boundary id)",
      handler: () => ({
        ok: false,
        error: { code: "not-implemented", message: "autumn has no Convex backend — convexAuthStatus is a platform-boundary id (doc 32 §2a)" },
      }),
    },
    {
      kind: "bridge",
      id: "backends.convexLogin",
      description: "Convex cloud login; params: {} -> not-implemented envelope (autumn has no Convex dependency; doc 32 §2a boundary id)",
      handler: () => ({
        ok: false,
        error: { code: "not-implemented", message: "autumn has no Convex backend — convexLogin is a platform-boundary id (doc 32 §2a)" },
      }),
    },
    {
      kind: "bridge",
      id: "backends.convexCreate",
      description: "create a Convex cloud project; params: {} -> not-implemented envelope (autumn has no Convex dependency; doc 32 §2a boundary id)",
      handler: () => ({
        ok: false,
        error: { code: "not-implemented", message: "autumn has no Convex backend — convexCreate is a platform-boundary id (doc 32 §2a)" },
      }),
    },
  ];

  return handlers;
}

/** Test seam: expose the queue for tests that need to enqueue directly. */
export function _enqueueApproval(slug: string, approval: Approval): void {
  const list = readPending(slug);
  list.push(approval);
  writePending(slug, list);
}
export function _backendsDir(): string {
  return backendsDir();
}
