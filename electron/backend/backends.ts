// autumn — Wave-2 handlers: backends (23 dispatchable; doc 32 §2d) — FULL (W2-7).
//
// RE-derived (October out/main/index.js + CanvasView renderer chunk):
//   list()            → array of backend entities
//   create(input)     → {kind, title, …}; kind ∈ supabase|convex|concurred
//   update(input)     → {id, title?, autoApply?, useLocalForDev?, …}
//   remove(id)        → positional id
//   link(input)       → {id, app, projectPath, framework}; bindings keyed by app
//   unlink(input)     → {id, app} (RE: "unlink needs id and app")
//   pending(id)       → ARRAY of pending changes {id, backendId, app, file, sql, status}
//   approve(changeId) / reject(changeId)
//   query({id, sql})  → read-only SQL → {columns, rows}
//   schema(id)        → positional id → {tables, reachable}
//   peek({id, table}) → {columns, rows, error?}
//   ask({id, question})→ {kind: "read"|"change"|"error", sql, result|file, message}
//   scaffoldClient({id, app}) → {written: [rel]}
//   listOrgs(token)   → orgs (RE needs an sbp_ Supabase token)
//   provision(input)  → creates a cloud project (orgId/name/region/dbPass/accessToken)
//   localStart/Stop/Status(id) → the local stack (RE: `supabase start` + Docker)
//   sync({id, direction}) → direction MUST be push|pull (RE throws otherwise)
//   convexAuthStatus / convexLogin / convexCreate → §2a boundary ids
//
// autumn design (doc 32 §2d): a LOCAL-FIRST mini data platform — named
// backends on disk with typed collection schemas, a guarded destructive-op
// queue, and a REAL local runtime (a node:http data service on 127.0.0.1 —
// the local analogue of `supabase start` + PostgREST, without Docker).
//
// Storage layout (all under AUTUMN_USER_DATA_DIR via store.ts):
//   <userData>/backends/index.json           {backends:[{id,slug,name,bindings[],linkedApps[]}]}
//   <userData>/backends/<slug>/backend.json  {id,name,slug,createdAt,description,schema:{collections:[{name,fields:[{name,type}]}]}}
//   <userData>/backends/<slug>/data.json     {<collection>: [docs…]}
//   <userData>/backends/<slug>/pending.json  approval queue (destructive ops)
//   <userData>/backends/<slug>/meta.json     {syncedAt?, schemaVersion?, docsCount?, local?:{running,startedAt,pid,port,url}}
//   <userData>/backends/<slug>/client.ts     scaffolded typed client (regenerated on schema write)
//   <userData>/backends/<slug>/snapshots/    local sync snapshots (sync push/pull)
//
// Deviations from the target (documented, not silent):
//   - cloud backends (supabase/convex/concurred) are a PLATFORM BOUNDARY:
//     `create` with a cloud kind and the 3 convex* ids answer the
//     not-implemented envelope. autumn's own kind is "local".
//   - `query` accepts BOTH the RE read-only SQL ({id, sql}) and autumn's
//     structured form ({id, collection, filter, sort, limit}). The SQL parser
//     is a strict read-only subset (SELECT/WHERE/ORDER BY/LIMIT/OFFSET) —
//     anything else is refused, never "executed".
//   - `pending` answers the RE array shape (the renderer spreads it), each
//     entry carrying the RE fields (id/backendId/app/file/sql/status).
//   - `schema` accepts the positional id; `peek` accepts the RE {id, table}
//     and answers the RE {columns, rows} shape.
//   - `localStart` starts autumn's own local data service (no Docker, no
//     Supabase CLI): a real HTTP server on 127.0.0.1 with a real port, the
//     app-side data API the scaffolded client talks to.
//   - `sync` push/pull are LOCAL (snapshots in the backend dir) — there is no
//     remote to sync with.
//   - `listOrgs` is the single local org.
//
// Guard model: every DESTRUCTIVE change (drop a collection, wipe its rows)
// is queued as an approval and only executed when the user approves it.
// Ordinary row writes happen through the local data service (app side), the
// same way the target's app writes rows through PostgREST.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";

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
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
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
/** RE binding: an app ("web"|"phone") bound to a project path. */
interface Binding {
  app: string;
  projectPath: string;
  framework?: string;
}
interface RegistryRow {
  id: string;
  slug: string;
  name: string;
  description?: string;
  bindings: Binding[];
  linkedApps: string[];
}
interface Registry {
  backends: RegistryRow[];
}
type ApprovalStatus = "pending" | "approved" | "rejected";
type ApprovalOp = "dropCollection" | "wipeRows";
interface Approval {
  /** RE change id — the renderer calls `backends.approve(change.id)`. */
  id: string;
  approvalId: string;
  backendId: string;
  app: string;
  op: ApprovalOp;
  collection?: string;
  /** Human-readable statement of the change (RE shows it in the UI). */
  sql: string;
  /** Pseudo path of the queued change (RE: the migration file). */
  file: string;
  requestedAt: number;
  status: ApprovalStatus;
  note?: string;
}
interface LocalState {
  running: boolean;
  startedAt?: number;
  stoppedAt?: number;
  pid?: number;
  port?: number;
  url?: string;
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
const snapshotsDir = (slug: string) => join(dirOf(slug), "snapshots");

/** Registry with the row shape normalized (old rows had linkedProjects). */
function readRegistry(): Registry {
  const r = loadJson<Registry>(indexFile(), { backends: [] });
  if (!Array.isArray(r.backends)) return { backends: [] };
  return {
    backends: r.backends.map((row) => {
      const bindings = Array.isArray(row.bindings) ? row.bindings : [];
      const legacyRow = row as unknown as { linkedProjects?: string[] };
      const legacy = Array.isArray(legacyRow.linkedProjects) ? legacyRow.linkedProjects : [];
      const merged: Binding[] = bindings.length
        ? bindings
        : legacy.map((projectPath) => ({ app: "web", projectPath }));
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        bindings: merged,
        linkedApps: Array.isArray(row.linkedApps) ? row.linkedApps : [...new Set(merged.map((b) => b.app))],
      };
    }),
  };
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
  if (!idOrSlug) return null;
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

/** Type-check one document against a collection's fields (unknown fields are rejected). */
function validateDoc(col: Collection | undefined, doc: unknown): { ok: true; doc: Record<string, unknown> } | { ok: false; message: string } {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, message: "each document must be an object" };
  }
  const d = doc as Record<string, unknown>;
  if (!col) return { ok: false, message: "unknown collection" };
  for (const [key, value] of Object.entries(d)) {
    if (key === "id") continue;
    const field = col.fields.find((f) => f.name === key);
    if (!field) return { ok: false, message: `unknown field ${col.name}.${key}` };
    const t = typeof value;
    const ok =
      field.type === "string" || field.type === "datetime"
        ? t === "string"
        : field.type === "number"
          ? t === "number" && Number.isFinite(value as number)
          : field.type === "boolean"
            ? t === "boolean"
            : field.type === "object"
              ? t === "object" && value !== null && !Array.isArray(value)
              : Array.isArray(value);
    if (!ok) return { ok: false, message: `field ${col.name}.${key} must be ${field.type}` };
  }
  return { ok: true, doc: d };
}

// ---------------------------------------------------------------------------
// read-only SQL subset (RE `query({id, sql})`)
// ---------------------------------------------------------------------------

type FilterOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "like" | "in";
const FILTER_OPS: FilterOp[] = ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "like", "in"];

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
      case "like":
        pass = typeof v === "string" && typeof value === "string" && v.toLowerCase().includes(value.toLowerCase());
        break;
      case "in":
        pass = Array.isArray(value) && value.includes(v);
        break;
    }
    if (!pass) return false;
  }
  return true;
}

type SqlPlan = {
  table: string;
  select: string[];
  where: Array<{ field: string; op: FilterOp; value: unknown }>;
  order?: { field: string; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
};

/** Strict read-only SELECT parser — anything else is refused, never executed. */
export function parseSelect(sql: string): { ok: true; plan: SqlPlan } | { ok: false; message: string } {
  const text = String(sql ?? "").trim();
  if (!text) return { ok: false, message: "empty query" };
  if (!/^select\b/i.test(text)) {
    return { ok: false, message: "Only a single read-only statement is allowed here." };
  }
  if (/;\s*\S/.test(text)) {
    return { ok: false, message: "Only a single read-only statement is allowed here." };
  }
  const m = /^select\s+([\s\S]+?)\s+from\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*([\s\S]*)$/i.exec(text);
  if (!m) return { ok: false, message: "Could not read that query — expected SELECT <columns> FROM <collection>." };
  const selectRaw = m[1].trim();
  const table = m[2];
  const rest = m[3].trim();

  const select = selectRaw === "*" ? ["*"] : selectRaw.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (!select.length) return { ok: false, message: "Could not read that query — no columns selected." };

  const where: SqlPlan["where"] = [];
  let order: SqlPlan["order"];
  let limit: number | undefined;
  let offset: number | undefined;

  // WHERE … (AND …)*
  const whereMatch = /\bwhere\b\s+([\s\S]+?)(?=\border\s+by\b|\blimit\b|\boffset\b|$)/i.exec(rest);
  if (whereMatch) {
    const clause = whereMatch[1].trim();
    const parts = clause.split(/\s+and\s+/i);
    for (const part of parts) {
      const cm = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(=|==|!=|<>|>=|<=|>|<|\blike\b|\bin\b)\s*([\s\S]+)$/i.exec(part.trim());
      if (!cm) return { ok: false, message: `Could not read that condition: ${part.trim()}` };
      const field = cm[1];
      const opText = cm[2].toLowerCase();
      const op: FilterOp =
        opText === "=" || opText === "==" ? "eq"
        : opText === "!=" || opText === "<>" ? "neq"
        : opText === ">" ? "gt"
        : opText === "<" ? "lt"
        : opText === ">=" ? "gte"
        : opText === "<=" ? "lte"
        : opText === "like" ? "like"
        : "in";
      const value = parseSqlValue(cm[3].trim());
      if (value === undefined) return { ok: false, message: `Could not read the value: ${cm[3].trim()}` };
      where.push({ field, op, value });
    }
  }

  const orderMatch = /\border\s+by\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(asc|desc)?/i.exec(rest);
  if (orderMatch) order = { field: orderMatch[1], dir: (orderMatch[2]?.toLowerCase() === "desc" ? "desc" : "asc") };

  const limitMatch = /\blimit\s+(\d+)/i.exec(rest);
  if (limitMatch) limit = Number(limitMatch[1]);
  const offsetMatch = /\boffset\s+(\d+)/i.exec(rest);
  if (offsetMatch) offset = Number(offsetMatch[1]);

  return { ok: true, plan: { table, select, where, ...(order ? { order } : {}), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) } };
}

function parseSqlValue(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^'[\s\S]*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^"[\s\S]*"$/.test(s)) return s.slice(1, -1);
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => parseSqlValue(v));
  }
  return undefined;
}

/** Render a plan back to readable SQL (shown in the UI next to the rows). */
function renderSql(plan: SqlPlan): string {
  const cols = plan.select.join(", ");
  let out = `SELECT ${cols} FROM "${plan.table}"`;
  if (plan.where.length) {
    out += ` WHERE ${plan.where.map((w) => `"${w.field}" ${sqlOp(w.op)} ${sqlValue(w.value)}`).join(" AND ")}`;
  }
  if (plan.order) out += ` ORDER BY "${plan.order.field}" ${plan.order.dir.toUpperCase()}`;
  if (plan.limit !== undefined) out += ` LIMIT ${plan.limit}`;
  if (plan.offset !== undefined) out += ` OFFSET ${plan.offset}`;
  return out;
}
const sqlOp = (op: FilterOp) =>
  op === "eq" ? "=" : op === "neq" ? "!=" : op === "gt" ? ">" : op === "lt" ? "<" : op === "gte" ? ">=" : op === "lte" ? "<=" : op === "like" ? "LIKE" : "IN";
const sqlValue = (v: unknown) =>
  typeof v === "number" || typeof v === "boolean" ? String(v)
    : Array.isArray(v) ? `(${v.map((x) => `'${String(x)}'`).join(", ")})`
    : `'${String(v).replace(/'/g, "''")}'`;

/** Run a plan against the backend's local rows. */
function runPlan(rows: Record<string, unknown>[], plan: SqlPlan): { columns: string[]; values: unknown[][]; objects: Record<string, unknown>[] } {
  let out = rows;
  if (plan.where.length) out = out.filter((r) => applyFilter(r, plan.where));
  if (plan.order) {
    const { field, dir } = plan.order;
    out = [...out].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      return (av! > bv! ? 1 : -1) * (dir === "desc" ? -1 : 1);
    });
  }
  const total = out.length;
  const offset = plan.offset ?? 0;
  const limited = plan.limit !== undefined ? out.slice(offset, offset + plan.limit) : out.slice(offset);
  const columns = plan.select[0] === "*"
    ? [...new Set(limited.flatMap((r) => Object.keys(r)))]
    : plan.select;
  const values = limited.map((r) => columns.map((c) => r[c] ?? null));
  const objects = limited.map((r) => {
    if (plan.select[0] === "*") return r;
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c] = r[c] ?? null;
    return o;
  });
  void total;
  return { columns, values, objects };
}

// ---------------------------------------------------------------------------
// natural-language planner (autumn's `ask` — deterministic, no LLM needed)
// ---------------------------------------------------------------------------

const DESTRUCTIVE_RE = /\b(delete|drop|wipe|remove|purge|clear|truncate)\b/i;

/** Turn a plain question into a plan (or a destructive request). */
export function planFromQuestion(
  question: string,
  collections: Collection[],
): { kind: "read"; plan: SqlPlan } | { kind: "change"; op: ApprovalOp; collection?: string } | { kind: "unknown" } {
  const q = String(question ?? "");
  if (!q.trim()) return { kind: "unknown" };

  // Collection match (allow a trailing plural "s" to match the singular name).
  const matched = collections.find((c) => {
    const lower = q.toLowerCase();
    return lower.includes(c.name.toLowerCase()) || lower.includes(`${c.name.toLowerCase()}s`);
  });

  // Destructive intent → a guarded change, never an execution.
  if (DESTRUCTIVE_RE.test(q)) {
    const op: ApprovalOp = /\b(drop|truncate)\b/i.test(q) && matched ? "dropCollection" : "wipeRows";
    return { kind: "change", op, ...(matched ? { collection: matched.name } : {}) };
  }
  if (!matched) return { kind: "unknown" };

  const where: SqlPlan["where"] = [];
  for (const f of matched.fields) {
    const name = f.name.toLowerCase();
    const patterns: Array<[RegExp, FilterOp]> = [
      [new RegExp(`${name}\\s*(?:is\\s+not|!=|not)\\s+['"]?([^'"]+?)['"]?(?:\\s|$|,|\\.)`, "i"), "neq"],
      [new RegExp(`${name}\\s*(?:at least|>=|no less than)\\s+(-?\\d+(?:\\.\\d+)?)`, "i"), "gte"],
      [new RegExp(`${name}\\s*(?:at most|<=|no more than)\\s+(-?\\d+(?:\\.\\d+)?)`, "i"), "lte"],
      [new RegExp(`${name}\\s*(?:over|above|greater than|>)\\s+(-?\\d+(?:\\.\\d+)?)`, "i"), "gt"],
      [new RegExp(`${name}\\s*(?:under|below|less than|<)\\s+(-?\\d+(?:\\.\\d+)?)`, "i"), "lt"],
      [new RegExp(`${name}\\s*(?:contains|includes|like)\\s+['"]?([^'"]+?)['"]?(?:\\s|$|,|\\.)`, "i"), "contains"],
      [new RegExp(`${name}\\s*(?:is|equals|=|==)\\s+['"]?([^'"]+?)['"]?(?:\\s|$|,|\\.)`, "i"), "eq"],
    ];
    for (const [re, op] of patterns) {
      const m = re.exec(q);
      if (!m) continue;
      const raw = m[1];
      const value =
        op === "eq" || op === "neq" || op === "contains"
          ? raw.trim()
          : Number(raw);
      where.push({ field: f.name, op, value });
      break;
    }
  }
  const limitMatch = /\b(?:top|first|last)\s+(\d+)\b/i.exec(q);
  return {
    kind: "read",
    plan: {
      table: matched.name,
      select: ["*"],
      where,
      limit: limitMatch ? Number(limitMatch[1]) : 100,
    },
  };
}

// ---------------------------------------------------------------------------
// typed client scaffold
// ---------------------------------------------------------------------------

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

/**
 * The scaffolded client — a REAL working client for the app side of a
 * backend: it prefers the IPC facade (window.autumn.backends — the autumn
 * rule: the renderer never talks HTTP to the backend) and falls back to the
 * local data service when it runs outside the renderer (scripts, agents).
 */
function renderClient(b: Backend, localUrl: string | null): string {
  const cols = b.schema.collections;
  const union = cols.length ? cols.map((c) => JSON.stringify(c.name)).join(" | ") : "never";
  const rowTypes = cols
    .map((c) => {
      const props = c.fields.map((f) => `  ${f.name}${f.type === "boolean" || f.type === "number" ? "?" : ""}: ${tsType(f.type)};`).join("\n");
      return `export interface ${cap(c.name)} {\n  id?: string;\n${props || "  _?: never;"}\n}`;
    })
    .join("\n");
  return `// autogenerated by autumn backends.scaffoldClient — do not edit (regenerated on schema change)
// backend: ${b.name} (${b.slug})

export const backendId = ${JSON.stringify(b.id)};
export const backendSlug = ${JSON.stringify(b.slug)};
/** The local data service URL (autumn.backends.localStart) — null when it is not running. */
export const localUrl = ${localUrl ? JSON.stringify(localUrl) : "null"};

export type CollectionName = ${union};

${rowTypes || "export interface _NoCollections {}"}

export type Row<C extends CollectionName> = C extends "never" ? Record<string, unknown> : Record<string, unknown>;
export type Filter = { field: string; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "like" | "in"; value: unknown };

type AutumnBridge = {
  backends: {
    query(p: { id: string; collection: string; filter?: Filter | Filter[]; sort?: { field: string; dir?: "asc" | "desc" }; limit?: number }): Promise<{ rows: Row<string>[]; total: number }>;
  };
};

function bridge(): AutumnBridge | null {
  const g = globalThis as unknown as { autumn?: AutumnBridge };
  return g.autumn ?? null;
}

/** Read rows — through the IPC facade when running inside the renderer. */
export async function query<C extends CollectionName>(collection: C, filter?: Filter | Filter[]): Promise<Row<C>[]> {
  const api = bridge();
  if (api) {
    const res = await api.backends.query({ id: backendId, collection, filter });
    return res.rows as Row<C>[];
  }
  if (!localUrl) throw new Error("autumn: no IPC bridge and no local data service running (autumn.backends.localStart)");
  const qs = filter
    ? "?" + (Array.isArray(filter) ? filter : [filter])
        .map((f) => \`\${encodeURIComponent(f.field)}=\${encodeURIComponent(String(f.op))}.\${encodeURIComponent(String(f.value))}\`)
        .join("&")
    : "";
  const res = await fetch(\`\${localUrl}/\${encodeURIComponent(collection)}\${qs}\`);
  if (!res.ok) throw new Error(\`autumn: backend query failed (\${res.status})\`);
  const body = (await res.json()) as { rows: Row<C>[] };
  return body.rows;
}

/** Insert a row — through the local data service (row writes are app-side). */
export async function insert<C extends CollectionName>(collection: C, doc: Row<C>): Promise<Row<C>> {
  if (!localUrl) throw new Error("autumn: no local data service running (autumn.backends.localStart)");
  const res = await fetch(\`\${localUrl}/\${encodeURIComponent(collection)}\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(\`autumn: insert failed (\${res.status})\`);
  const body = (await res.json()) as { rows: Row<C>[] };
  return body.rows[0];
}

/** Update a row by id. */
export async function update<C extends CollectionName>(collection: C, id: string, patch: Partial<Row<C>>): Promise<Row<C> | null> {
  if (!localUrl) throw new Error("autumn: no local data service running (autumn.backends.localStart)");
  const res = await fetch(\`\${localUrl}/\${encodeURIComponent(collection)}?id=eq.\${encodeURIComponent(id)}\`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(\`autumn: update failed (\${res.status})\`);
  const body = (await res.json()) as { rows: Row<C>[] };
  return body.rows[0] ?? null;
}

/** Delete a row by id. */
export async function remove<C extends CollectionName>(collection: C, id: string): Promise<boolean> {
  if (!localUrl) throw new Error("autumn: no local data service running (autumn.backends.localStart)");
  const res = await fetch(\`\${localUrl}/\${encodeURIComponent(collection)}?id=eq.\${encodeURIComponent(id)}\`, { method: "DELETE" });
  if (!res.ok) throw new Error(\`autumn: delete failed (\${res.status})\`);
  const body = (await res.json()) as { deleted: number };
  return body.deleted > 0;
}

/** The collection names of this backend. */
export async function collections(): Promise<CollectionName[]> {
  const api = bridge();
  if (api) {
    const res = await api.backends.query({ id: backendId, collection: "__none__" }).catch(() => null);
    void res;
  }
  return ${union === "never" ? "[]" : `[${cols.map((c) => JSON.stringify(c.name)).join(", ")}]`};
}
`;
}

function writeClient(b: Backend, localUrl: string | null): void {
  try {
    mkdirSync(dirOf(b.slug), { recursive: true });
    writeFileSync(clientFile(b.slug), renderClient(b, localUrl), "utf8");
  } catch {
    /* scaffold is best-effort */
  }
}

// ---------------------------------------------------------------------------
// local data service (the local runtime — RE: `supabase start`)
// ---------------------------------------------------------------------------

type LocalServer = { server: Server; port: number; url: string; startedAt: number };

/** Probe a local service (used to tell a live runtime from a stale marker). */
function probe(url: string, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const req = httpRequest(`${url}/health`, { method: "GET" }, (res) => {
        res.resume();
        done(res.statusCode === 200);
      });
      req.on("error", () => done(false));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done(false);
      });
      req.end();
    } catch {
      done(false);
    }
  });
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeBackendsHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now, spawner } = deps;

  /** Live local data services, keyed by backend id. */
  const servers = new Map<string, LocalServer>();

  const entityOf = (row: RegistryRow, b: Backend): Record<string, unknown> => {
    const meta = readMeta(b.slug);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      title: b.name, // RE field name (the target calls the display name "title")
      kind: "local",
      status: "ready",
      description: b.description ?? "",
      createdAt: b.createdAt,
      linkedApps: row.linkedApps,
      linkedProjects: row.bindings.map((x) => x.projectPath),
      collections: b.schema.collections.length,
      linked: row.bindings.length,
      hasLocal: meta.local?.running === true,
      hasDbPassword: false,
      dbPassword: "",
    };
  };

  const rowOf = (entry: { row: RegistryRow; backend: Backend }) => entityOf(entry.row, entry.backend);

  // ----- local data service --------------------------------------------------

  function startServer(entry: { row: RegistryRow; backend: Backend }): Promise<LocalServer> {
    const b = entry.backend;
    const server = createServer((req, res) => {
      handleLocalRequest(req, res, b).catch((e) => {
        try {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
        } catch {
          /* socket gone */
        }
      });
    });
    return new Promise((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const local: LocalServer = { server, port, url: `http://127.0.0.1:${port}`, startedAt: now() };
        servers.set(b.id, local);
        resolve(local);
      });
    });
  }

  async function handleLocalRequest(req: any, res: any, b: Backend): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (segments.length === 0 || (segments.length === 1 && segments[0] === "health")) {
      send(200, { ok: true, backend: { id: b.id, name: b.name, slug: b.slug }, collections: b.schema.collections.map((c) => c.name) });
      return;
    }

    const collection = segments[0];
    const col = b.schema.collections.find((c) => c.name === collection);
    if (!col) {
      send(404, { error: `unknown collection ${collection}` });
      return;
    }
    const data = readData(b.slug);
    const rows = data[collection] ?? [];

    if (req.method === "GET") {
      const filters: Array<{ field: string; op: FilterOp; value: unknown }> = [];
      for (const [key, raw] of url.searchParams.entries()) {
        if (key === "limit" || key === "offset" || key === "select" || key === "order") continue;
        const dot = raw.indexOf(".");
        if (dot < 0) continue;
        const opText = raw.slice(0, dot).toLowerCase();
        const value = raw.slice(dot + 1);
        const op: FilterOp =
          opText === "eq" ? "eq" : opText === "neq" ? "neq" : opText === "gt" ? "gt" : opText === "lt" ? "lt"
          : opText === "gte" ? "gte" : opText === "lte" ? "lte" : opText === "like" ? "like" : opText === "contains" ? "contains"
          : opText === "in" ? "in" : "eq";
        filters.push({ field: key, op, value: /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value });
      }
      let out = rows;
      if (filters.length) out = out.filter((r) => applyFilter(r, filters));
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      const limit = limitRaw === null ? NaN : Number(limitRaw);
      const offset = offsetRaw === null ? NaN : Number(offsetRaw);
      if (Number.isFinite(offset) && offset > 0) out = out.slice(offset);
      if (Number.isFinite(limit) && limit >= 0) out = out.slice(0, limit);
      const select = url.searchParams.get("select");
      if (select) {
        const cols = select.split(",").map((s) => s.trim()).filter(Boolean);
        out = out.map((r) => {
          const o: Record<string, unknown> = {};
          for (const c of cols) o[c] = r[c] ?? null;
          return o;
        });
      }
      send(200, { rows: out, total: rows.length });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const incoming = Array.isArray(body) ? body : [body];
      const data2 = readData(b.slug);
      const list = data2[collection] ?? [];
      const inserted: Record<string, unknown>[] = [];
      for (const doc of incoming) {
        const v = validateDoc(col, doc);
        if (!v.ok) {
          send(400, { error: v.message });
          return;
        }
        const row = { ...v.doc, id: typeof v.doc.id === "string" ? v.doc.id : randomUUID() };
        list.push(row);
        inserted.push(row);
      }
      data2[collection] = list;
      writeData(b.slug, data2);
      send(201, { rows: inserted, total: list.length });
      return;
    }

    if (req.method === "PATCH" || req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id || !id.startsWith("eq.")) {
        send(400, { error: "only ?id=eq.<id> is supported" });
        return;
      }
      const target = id.slice(3);
      const data2 = readData(b.slug);
      const list = data2[collection] ?? [];
      const index = list.findIndex((r) => r.id === target);
      if (index < 0) {
        send(404, { error: `no row ${target} in ${collection}` });
        return;
      }
      if (req.method === "DELETE") {
        const [removed] = list.splice(index, 1);
        data2[collection] = list;
        writeData(b.slug, data2);
        send(200, { deleted: 1, rows: [removed] });
        return;
      }
      const body = await readJsonBody(req);
      const v = validateDoc(col, { ...list[index], ...(body as Record<string, unknown>) });
      if (!v.ok) {
        send(400, { error: v.message });
        return;
      }
      const merged = { ...list[index], ...v.doc };
      list[index] = merged;
      data2[collection] = list;
      writeData(b.slug, data2);
      send(200, { rows: [merged], total: list.length });
      return;
    }

    send(405, { error: `method ${req.method} not allowed` });
  }

  function readJsonBody(req: any): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk: Buffer | string) => {
        raw += String(chunk);
        if (raw.length > 5_000_000) reject(new Error("request body too large"));
      });
      req.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`invalid JSON body: ${String((e as Error)?.message ?? e)}`));
        }
      });
      req.on("error", reject);
    });
  }

  const handlers: RegisteredHandler[] = [
    // ----- registry CRUD -----------------------------------------------------
    {
      kind: "bridge",
      id: "backends.create",
      description:
        "create a local backend; params: {name|title, description?, kind?} — kind 'local' (default) creates a local backend; cloud kinds (supabase/convex/concurred) are a platform-boundary → not-implemented envelope; returns {id, slug, name, title, kind, linkedApps, …} (RE create(input) single object)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        const name = obj.name ?? obj.title;
        return typeof name === "string" && NAME_RE.test(name)
          ? { ok: true }
          : { ok: false, message: "name required (letters/digits/space/-/_ , 1-64 chars)" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const name = obj.name ?? obj.title;
        if (typeof name !== "string" || !NAME_RE.test(name)) {
          return badParams("name required (letters/digits/space/-/_ , 1-64 chars)");
        }
        const kind = typeof obj.kind === "string" ? obj.kind : "local";
        if (kind !== "local" && kind !== "autumn") {
          return {
            ok: false,
            error: {
              code: "not-implemented",
              message: `autumn has no ${kind} cloud backends — cloud kinds are a platform boundary (doc 32 §2a)`,
            },
          };
        }
        const description = typeof obj.description === "string" ? obj.description : undefined;
        const slug = uniqueSlug(slugify(name));
        const b: Backend = {
          id: randomUUID(),
          name,
          slug,
          createdAt: now(),
          schema: { collections: [] },
          ...(description ? { description } : {}),
        };
        writeBackend(b);
        writeData(slug, {});
        writePending(slug, []);
        writeMeta(slug, {});
        writeClient(b, null);
        const r = readRegistry();
        r.backends.push({ id: b.id, slug, name, ...(description ? { description } : {}), bindings: [], linkedApps: [] });
        writeRegistry(r);
        return entityOf(r.backends[r.backends.length - 1], b);
      },
    },
    {
      kind: "bridge",
      id: "backends.list",
      description:
        "list backends; params: {} -> rows [{id,slug,name,title,kind,status,linkedApps,linkedProjects,collections,linked,hasLocal}] (RE listBackends)",
      handler: () => {
        const r = readRegistry();
        return r.backends.map((row) => {
          const b = readBackend(row.slug);
          return b ? entityOf(row, b) : { ...row, title: row.name, kind: "local", status: "error", collections: 0, linked: row.bindings.length, linkedApps: row.linkedApps, linkedProjects: row.bindings.map((x) => x.projectPath), hasLocal: false };
        });
      },
    },
    {
      kind: "bridge",
      id: "backends.update",
      description:
        "update a backend; params: {id, name?|title?, description?} -> row | not-found (RE updateBackend single object; title is the RE field name)",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return typeof obj.id === "string" || typeof pos[0] === "string"
          ? { ok: true }
          : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = (typeof obj.id === "string" ? obj.id : typeof pos[0] === "string" ? pos[0] : "") as string;
        const entry = findEntry(id);
        if (!entry) return notFound(`no backend ${id}`);
        const b = entry.backend;
        const newName = obj.name ?? obj.title;
        if (newName !== undefined) {
          if (typeof newName !== "string" || !NAME_RE.test(newName)) return badParams("name must be 1-64 chars");
          b.name = newName;
        }
        if (obj.description !== undefined) {
          if (typeof obj.description !== "string") return badParams("description must be a string");
          b.description = obj.description;
        }
        writeBackend(b);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === b.id);
        if (row) {
          row.name = b.name;
          row.description = b.description;
        }
        writeRegistry(r);
        return rowOf({ row: row ?? entry.row, backend: b });
      },
    },
    {
      kind: "bridge",
      id: "backends.remove",
      description:
        "delete a backend; params: {id, confirm:true} | id (positional, RE shape) -> {removed:true} (confirm:true required — destructive, doc 32 §2d)",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return typeof obj.id === "string" || typeof pos[0] === "string"
          ? { ok: true }
          : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = (typeof obj.id === "string" ? obj.id : typeof pos[0] === "string" ? pos[0] : "") as string;
        if (obj.confirm !== true) return badParams("confirm:true is required to delete a backend");
        const entry = findEntry(id);
        if (!entry) return notFound(`no backend ${id}`);
        const local = servers.get(entry.backend.id);
        if (local) {
          try {
            local.server.close();
          } catch {
            /* already closed */
          }
          servers.delete(entry.backend.id);
        }
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
      description:
        "link a backend to an app; params: {id, app, projectPath, framework?} (RE shape — bindings are keyed by app) -> row | bad-params/not-found",
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
        const app = typeof obj.app === "string" && obj.app.length > 0 ? obj.app : "web";
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === entry.backend.id)!;
        const existing = row.bindings.find((b) => b.app === app);
        if (existing) {
          existing.projectPath = projectPath;
          if (typeof obj.framework === "string") existing.framework = obj.framework;
        } else {
          row.bindings.push({
            app,
            projectPath,
            ...(typeof obj.framework === "string" ? { framework: obj.framework } : {}),
          });
        }
        row.linkedApps = [...new Set(row.bindings.map((b) => b.app))];
        writeRegistry(r);
        return rowOf({ row, backend: entry.backend });
      },
    },
    {
      kind: "bridge",
      id: "backends.unlink",
      description:
        "unlink an app; params: {id, app} (RE shape) or {id, projectPath} -> row | not-found (RE: \"unlink needs id and app\")",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && (typeof obj.app === "string" || typeof obj.projectPath === "string")
          ? { ok: true }
          : { ok: false, message: "id and app (or projectPath) required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const r = readRegistry();
        const row = r.backends.find((x) => x.id === entry.backend.id)!;
        if (typeof obj.app === "string") {
          row.bindings = row.bindings.filter((b) => b.app !== obj.app);
        } else if (typeof obj.projectPath === "string") {
          row.bindings = row.bindings.filter((b) => b.projectPath !== obj.projectPath);
        }
        row.linkedApps = [...new Set(row.bindings.map((b) => b.app))];
        writeRegistry(r);
        return rowOf({ row, backend: entry.backend });
      },
    },

    // ----- schema ------------------------------------------------------------
    {
      kind: "bridge",
      id: "backends.schema",
      description:
        "read/write the schema; params: id (RE positional) or {id} -> {collections, tables, reachable}; {id, collections} writes it (field types string|number|boolean|object|array|datetime, validated) and regenerates client.ts",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return typeof obj.id === "string" || typeof pos[0] === "string"
          ? { ok: true }
          : { ok: false, message: "id required" };
      },
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const id = (typeof obj.id === "string" ? obj.id : typeof pos[0] === "string" ? pos[0] : "") as string;
        const entry = findEntry(id);
        if (!entry) return notFound(`no backend ${id}`);
        if (obj.collections === undefined) {
          return {
            collections: entry.backend.schema.collections,
            tables: entry.backend.schema.collections.map((c) => c.name),
            reachable: true,
          };
        }
        const v = validateSchema(obj.collections);
        if (!v.ok) return badParams(v.message);
        entry.backend.schema = { collections: v.collections };
        writeBackend(entry.backend);
        writeClient(entry.backend, servers.get(entry.backend.id)?.url ?? null);
        return {
          collections: entry.backend.schema.collections,
          tables: entry.backend.schema.collections.map((c) => c.name),
          reachable: true,
          clientWritten: true,
        };
      },
    },

    // ----- data plane --------------------------------------------------------
    {
      kind: "bridge",
      id: "backends.query",
      description:
        "query rows; params: {id, sql} (RE read-only SQL subset — SELECT/WHERE/ORDER BY/LIMIT/OFFSET) or {id, collection, filter?, sort?, limit?} -> {columns, rows, objects, total, sql} (structured form: field ops eq/neq/gt/lt/gte/lte/contains/like/in)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        if (typeof obj.id !== "string") return { ok: false, message: "id required" };
        if (typeof obj.sql === "string" && obj.sql.trim()) return { ok: true };
        if (typeof obj.collection === "string" && obj.collection.length > 0) return { ok: true };
        return { ok: false, message: "sql or collection required" };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const data = readData(entry.backend.slug);

        // ----- RE form: read-only SQL ---------------------------------------
        if (typeof obj.sql === "string" && obj.sql.trim()) {
          const parsed = parseSelect(obj.sql);
          if (!parsed.ok) return badParams(parsed.message);
          const plan = parsed.plan;
          const col = entry.backend.schema.collections.find((c) => c.name === plan.table);
          if (!col) return notFound(`no collection ${plan.table} in backend ${entry.backend.name}`);
          const result = runPlan(data[plan.table] ?? [], plan);
          return {
            columns: result.columns,
            rows: result.objects,
            values: result.values,
            objects: result.objects,
            total: result.objects.length,
            sql: renderSql(plan),
          };
        }

        // ----- autumn form: structured ---------------------------------------
        const collection = obj.collection as string;
        const col = entry.backend.schema.collections.find((c) => c.name === collection);
        if (!col) return notFound(`no collection ${collection} in backend ${entry.backend.name}`);
        const rows = data[collection] ?? [];
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
        const columns = [...new Set(out.flatMap((r) => Object.keys(r)))];
        return {
          columns,
          rows: out,
          objects: out,
          values: out.map((r) => columns.map((c) => r[c] ?? null)),
          total,
        };
      },
    },
    {
      kind: "bridge",
      id: "backends.peek",
      description:
        "inspect a backend; params: {id, table?} -> {columns, rows, collections, sizeBytes} (RE peek({id, table}) shape: the table's columns + rows; without a table: every collection's count + fields)",
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
        if (typeof obj.table === "string" && obj.table.length > 0) {
          const col = entry.backend.schema.collections.find((c) => c.name === obj.table);
          if (!col) return notFound(`no table ${obj.table} in backend ${entry.backend.name}`);
          const rows = data[col.name] ?? [];
          const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          return {
            columns,
            rows: rows.map((r) => columns.map((c) => r[c] ?? null)),
            objects: rows,
            table: col.name,
            collections,
            sizeBytes,
          };
        }
        return { columns: [], rows: [], collections, sizeBytes };
      },
    },

    // ----- destructive-op approval queue (RE pending/approve/reject) ---------
    {
      kind: "bridge",
      id: "backends.pending",
      description:
        "list queued destructive changes; params: {id?} | id (RE positional) -> ARRAY of {id, backendId, app, file, sql, status, op, collection} (the RE renderer spreads this array)",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id");
        const out: Approval[] = [];
        for (const row of readRegistry().backends) {
          if (id && row.id !== id && row.slug !== id) continue;
          out.push(...readPending(row.slug).filter((a) => a.status === "pending"));
        }
        return out;
      },
    },
    {
      kind: "bridge",
      id: "backends.approve",
      description:
        "approve a queued destructive change; params: changeId (RE positional) | {approvalId|id} -> executes it for real (drops the collection's rows + schema, or wipes its rows) -> {approved:true, id, status:'applied', applied}",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        return str(obj, pos, "approvalId", "changeId", "id") ? { ok: true } : { ok: false, message: "changeId required" };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const changeId = str(obj, pos, "approvalId", "changeId", "id") as string;
        for (const row of readRegistry().backends) {
          const list = readPending(row.slug);
          const a = list.find((x) => x.id === changeId || x.approvalId === changeId);
          if (!a) continue;
          if (a.status !== "pending") return badParams(`change ${changeId} is already ${a.status}`);
          const b = readBackend(row.slug);
          if (!b) return notFound(`backend ${row.slug} disappeared`);
          if (a.op === "dropCollection" && a.collection) {
            const data = readData(row.slug);
            delete data[a.collection];
            writeData(row.slug, data);
            b.schema = { collections: b.schema.collections.filter((c) => c.name !== a.collection) };
            writeBackend(b);
            writeClient(b, servers.get(b.id)?.url ?? null);
          } else if (a.op === "wipeRows" && a.collection) {
            const data = readData(row.slug);
            data[a.collection] = [];
            writeData(row.slug, data);
          }
          a.status = "approved";
          list.splice(list.indexOf(a), 1, a);
          writePending(row.slug, list);
          return {
            approved: true,
            id: a.id,
            status: "applied",
            applied: { op: a.op, collection: a.collection ?? null, backendId: b.id },
          };
        }
        return notFound(`no pending change ${changeId}`);
      },
    },
    {
      kind: "bridge",
      id: "backends.reject",
      description:
        "reject a queued destructive change; params: changeId (RE positional) | {approvalId|id, note?} -> {rejected:true, id, note?} (nothing is executed)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        return str(obj, pos, "approvalId", "changeId", "id") ? { ok: true } : { ok: false, message: "changeId required" };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const changeId = str(obj, pos, "approvalId", "changeId", "id") as string;
        const note = str(obj, [], "note");
        for (const row of readRegistry().backends) {
          const list = readPending(row.slug);
          const a = list.find((x) => x.id === changeId || x.approvalId === changeId);
          if (!a) continue;
          if (a.status !== "pending") return badParams(`change ${changeId} is already ${a.status}`);
          a.status = "rejected";
          if (note) a.note = note;
          writePending(row.slug, list);
          return { rejected: true, id: a.id, approvalId: a.approvalId, ...(note ? { note } : {}) };
        }
        return notFound(`no pending change ${changeId}`);
      },
    },

    // ----- agent ask + client scaffold --------------------------------------
    {
      kind: "bridge",
      id: "backends.ask",
      description:
        "ask a question about the backend; params: {id, question, sql?} -> {kind:'read'|'change'|'answer'|'error', sql, result, message} (a deterministic local planner answers from the real rows; a destructive request is QUEUED as a change, never executed; falls back to the agent runner when the planner cannot answer)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.id === "string" && (typeof obj.question === "string" || typeof obj.sql === "string")
          ? { ok: true }
          : { ok: false, message: "id and question required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const collections = entry.backend.schema.collections;
        const data = readData(entry.backend.slug);

        // An explicit SQL question is planned and run locally (read-only).
        const question = typeof obj.question === "string" ? obj.question : "";
        const parsedSql = obj.sql ? parseSelect(obj.sql as string) : null;
        if (obj.sql && (!parsedSql || !parsedSql.ok)) {
          return { kind: "error", sql: String(obj.sql), message: parsedSql && !parsedSql.ok ? parsedSql.message : "Could not read that query." };
        }
        // Either the explicit SQL plan, or the deterministic question planner.
        const planned =
          parsedSql && parsedSql.ok
            ? ({ kind: "read", plan: parsedSql.plan } as const)
            : planFromQuestion(question, collections);

        if (planned.kind === "change") {
          // Destructive → queue it for the user, never execute.
          const collection = planned.collection;
          const approvalId = `chg-${randomUUID().slice(0, 8)}`;
          const sql = collection
            ? planned.op === "dropCollection"
              ? `DROP TABLE "${collection}";`
              : `DELETE FROM "${collection}";`
            : "DROP ALL TABLES;";
          const row = readRegistry().backends.find((x) => x.id === entry.backend.id)!;
          const approval: Approval = {
            id: `${entry.backend.id}|${row.linkedApps[0] ?? "web"}|${approvalId}`,
            approvalId,
            backendId: entry.backend.id,
            app: row.linkedApps[0] ?? "web",
            op: planned.op,
            ...(collection ? { collection } : {}),
            sql,
            file: `backends/${entry.backend.slug}/pending/${approvalId}.json`,
            requestedAt: now(),
            status: "pending",
          };
          const list = readPending(entry.backend.slug);
          list.push(approval);
          writePending(entry.backend.slug, list);
          return {
            kind: "change",
            sql,
            id: approval.id,
            approvalId,
            file: approval.file,
            message: "This change needs your approval before it runs.",
          };
        }

        if (planned.kind === "read") {
          const readPlan = planned.plan;
          const col = collections.find((c) => c.name === readPlan.table);
          if (!col) {
            return { kind: "error", sql: "", message: `No collection named ${readPlan.table}.` };
          }
          const result = runPlan(data[readPlan.table] ?? [], readPlan);
          return {
            kind: "read",
            sql: renderSql(readPlan),
            result: { columns: result.columns, rows: result.values, objects: result.objects, total: result.objects.length },
            message: `${result.objects.length} row${result.objects.length === 1 ? "" : "s"} in ${col.name}.`,
          };
        }

        // The planner could not answer → fall back to the agent runner.
        if (!spawner?.runAgent) {
          return { kind: "error", sql: "", message: "Couldn’t turn that into a query — try rephrasing." };
        }
        const context = JSON.stringify({ backend: entry.backend.name, schema: entry.backend.schema });
        const result = await spawner.runAgent({
          harness: "claude-code",
          task: `You are querying a local data backend. Schema: ${context}\n\nQuestion: ${question}`,
          canvasId: "default",
          nodeId: `backend-${entry.backend.id}`,
        });
        if (result.error) return handlerError(result.error);
        return {
          kind: "answer",
          sql: "",
          text: result.text,
          simulated: result.simulated ?? false,
          fellBack: result.fellBack ?? false,
          message: result.text,
        };
      },
    },
    {
      kind: "bridge",
      id: "backends.scaffoldClient",
      description:
        "write the typed client; params: {id, targetDir?, app?} -> {path, bytes, written} (a REAL client: IPC facade first, local data service second — RE scaffoldClient writes into the bound project)",
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
        const body = renderClient(entry.backend, servers.get(entry.backend.id)?.url ?? null);
        writeFileSync(file, body, "utf8");
        return { path: file, bytes: Buffer.byteLength(body), written: [file] };
      },
    },

    // ----- orgs (RE listOrgs — the target needs an sbp_ Supabase token; autumn is local-first, one org) -----
    {
      kind: "bridge",
      id: "backends.listOrgs",
      description:
        "list organizations; params: {} -> {items:[{id:'local', name:'Local (this machine)'}]} (target needs a Supabase access token — autumn is local-first, one org; documented deviation)",
      handler: () => ({ items: [{ id: "local", name: "Local (this machine)" }] }),
    },

    // ----- provisioning (RE provision creates a cloud project; autumn applies a template locally) -----
    {
      kind: "bridge",
      id: "backends.provision",
      description:
        "apply a starter template; params: {id, template:'todo'|'notes'|'blank', resetData?, rows?} -> {collections, rows?} (RE provision creates a cloud DB — autumn applies a template schema + optional starter rows locally; documented deviation)",
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
        writeClient(entry.backend, servers.get(entry.backend.id)?.url ?? null);
        if (obj.resetData === true) writeData(entry.backend.slug, {});

        // Optional starter rows (validated against the template schema).
        let seeded = 0;
        if (obj.rows && typeof obj.rows === "object") {
          const rowsIn = obj.rows as Record<string, unknown[]>;
          const data = readData(entry.backend.slug);
          for (const [name, docs] of Object.entries(rowsIn)) {
            const col = collections.find((c) => c.name === name);
            if (!col) return badParams(`unknown collection in rows: ${name}`);
            if (!Array.isArray(docs)) return badParams(`rows.${name} must be an array`);
            const list = data[name] ?? [];
            for (const doc of docs) {
              const v = validateDoc(col, doc);
              if (!v.ok) return badParams(v.message);
              list.push({ ...v.doc, id: typeof v.doc.id === "string" ? v.doc.id : randomUUID() });
              seeded++;
            }
            data[name] = list;
          }
          writeData(entry.backend.slug, data);
        }
        return { id: entry.backend.id, slug: entry.backend.slug, template, collections, rows: seeded, reset: obj.resetData === true };
      },
    },

    // ----- local runtime (RE: `supabase start`; autumn: its own local data service) -----
    {
      kind: "bridge",
      id: "backends.localStart",
      description:
        "start the local data service; params: id (positional) -> {running:true, port, url, startedAt} (a REAL http service on 127.0.0.1 — the local analogue of `supabase start`; no Docker needed)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const meta = readMeta(entry.backend.slug);
        const live = servers.get(entry.backend.id);
        if (live) {
          return { running: true, alreadyRunning: true, port: live.port, url: live.url, startedAt: live.startedAt, pid: process.pid };
        }
        // A stale marker (the app restarted) is only trusted if the service answers.
        if (meta.local?.running && meta.local.url && (await probe(meta.local.url))) {
          return { running: true, alreadyRunning: true, port: meta.local.port, url: meta.local.url, startedAt: meta.local.startedAt, pid: meta.local.pid };
        }
        try {
          const local = await startServer(entry);
          writeMeta(entry.backend.slug, {
            ...meta,
            local: { running: true, startedAt: local.startedAt, pid: process.pid, port: local.port, url: local.url },
          });
          writeClient(entry.backend, local.url);
          return { running: true, startedAt: local.startedAt, pid: process.pid, port: local.port, url: local.url };
        } catch (e) {
          return handlerError(`could not start the local data service: ${String((e as Error)?.message ?? e)}`);
        }
      },
    },
    {
      kind: "bridge",
      id: "backends.localStop",
      description:
        "stop the local data service; params: id (positional) -> {running:false, stoppedAt} (idempotent)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const local = servers.get(entry.backend.id);
        if (local) {
          await new Promise<void>((resolve) => {
            try {
              local.server.close(() => resolve());
            } catch {
              resolve();
            }
          });
          servers.delete(entry.backend.id);
        }
        const meta = readMeta(entry.backend.slug);
        const stoppedAt = now();
        writeMeta(entry.backend.slug, { ...meta, local: { running: false, stoppedAt } });
        writeClient(entry.backend, null);
        return { running: false, stoppedAt };
      },
    },
    {
      kind: "bridge",
      id: "backends.localStatus",
      description:
        "local data service status; params: id (positional) -> {running, port?, url?, startedAt?} (a stale marker is reported as not running — only a live service counts)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj, pos, "id") as string;
        const entry = findEntry(id ?? "");
        if (!entry) return notFound(`no backend ${String(id)}`);
        const local = servers.get(entry.backend.id);
        if (local) {
          return { running: true, port: local.port, url: local.url, startedAt: local.startedAt, pid: process.pid };
        }
        const meta = readMeta(entry.backend.slug).local;
        if (meta?.running && meta.url && (await probe(meta.url))) {
          return { running: true, port: meta.port, url: meta.url, startedAt: meta.startedAt, pid: meta.pid };
        }
        return { running: false };
      },
    },

    // ----- sync (RE syncs schema with a remote Supabase; autumn syncs local snapshots) -----
    {
      kind: "bridge",
      id: "backends.sync",
      description:
        "sync the backend; params: {id, direction:'push'|'pull'} (RE requires push|pull) -> {synced:true, at, docsCount, schemaVersion, direction} (autumn syncs LOCAL snapshots — there is no remote)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        if (typeof obj.id !== "string") return { ok: false, message: "id required" };
        if (obj.direction !== undefined && obj.direction !== "push" && obj.direction !== "pull") {
          return { ok: false, message: "Sync direction must be push or pull." };
        }
        return { ok: true };
      },
      handler: (params) => {
        const { obj } = paramsOf(params);
        if (obj.direction !== undefined && obj.direction !== "push" && obj.direction !== "pull") {
          return badParams("Sync direction must be push or pull.");
        }
        const entry = findEntry(obj.id as string);
        if (!entry) return notFound(`no backend ${String(obj.id)}`);
        const direction = obj.direction === "pull" ? "pull" : "push";
        const slug = entry.backend.slug;
        const data = readData(slug);
        const docsCount = Object.values(data).reduce((n, rows) => n + rows.length, 0);
        const meta = readMeta(slug);
        const dir = snapshotsDir(slug);
        mkdirSync(dir, { recursive: true });

        if (direction === "push") {
          const stamp = now().toString(36);
          const file = join(dir, `${stamp}.json`);
          saveJson(file, { schema: entry.backend.schema, data, docsCount, at: now() });
          const next: Meta = { ...meta, syncedAt: now(), schemaVersion: (meta.schemaVersion ?? 0) + 1, docsCount };
          writeMeta(slug, next);
          return { synced: true, at: next.syncedAt, docsCount, schemaVersion: next.schemaVersion, direction, snapshot: file };
        }

        // pull: restore the newest local snapshot (if any).
        let newest: string | null = null;
        try {
          const files = require("node:fs").readdirSync(dir) as string[];
          const snaps = files.filter((f) => f.endsWith(".json")).sort();
          newest = snaps.length ? join(dir, snaps[snaps.length - 1]) : null;
        } catch {
          newest = null;
        }
        if (!newest) return { synced: false, direction, docsCount, schemaVersion: meta.schemaVersion ?? 0, message: "No local snapshot to pull." };
        const snap = loadJson<{ schema?: BackendSchema; data?: Record<string, Record<string, unknown>[]> }>(newest, {});
        if (snap.schema) {
          entry.backend.schema = snap.schema;
          writeBackend(entry.backend);
        }
        if (snap.data) writeData(slug, snap.data);
        const next: Meta = { ...meta, syncedAt: now(), schemaVersion: (meta.schemaVersion ?? 0) + 1, docsCount };
        writeMeta(slug, next);
        return { synced: true, at: next.syncedAt, docsCount, schemaVersion: next.schemaVersion, direction, snapshot: newest };
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

/** Test seam: enqueue a change directly (the production path is backends.ask). */
export function _enqueueApproval(slug: string, approval: Partial<Approval> & { op: ApprovalOp }): void {
  const list = readPending(slug);
  const id = approval.id ?? approval.approvalId ?? `chg-${randomUUID().slice(0, 8)}`;
  list.push({
    id,
    approvalId: approval.approvalId ?? id,
    backendId: approval.backendId ?? "",
    app: approval.app ?? "web",
    op: approval.op,
    ...(approval.collection ? { collection: approval.collection } : {}),
    sql: approval.sql ?? `DELETE FROM "${approval.collection ?? "unknown"}";`,
    file: approval.file ?? `backends/${slug}/pending/${id}.json`,
    requestedAt: approval.requestedAt ?? Date.now(),
    status: approval.status ?? "pending",
    ...(approval.note ? { note: approval.note } : {}),
  });
  writePending(slug, list);
}
export function _backendsDir(): string {
  return backendsDir();
}
