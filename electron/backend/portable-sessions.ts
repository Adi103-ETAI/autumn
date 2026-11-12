// autumn — the portable-session layer (Wave 3, doc 35 §5).
//
// The RE (October v1.0.56) makes the OTHER agents' sessions portable: it
// discovers the session transcripts that Claude Code, Codex, Pi, Amp and Grok
// already wrote on this machine, indexes them in a library file, and lets the
// user browse, search and import them.
//
// That is genuinely local — it is just a careful reader of the local session
// stores — so autumn implements it as such.
//
// RE-derived (doc 24 §7 + main-index.js):
//   roots            claude  ~/.claude                 (or $CLAUDE_CONFIG_DIR)
//                    codex   ~/.codex                  (or $CODEX_HOME)
//                    pi      $PI_CODING_AGENT_SESSION_DIR | $PI_CODING_AGENT_DIR/sessions | ~/.pi/agent/sessions
//                    amp     $AMP_THREADS_DIR           | $XDG_DATA_HOME/amp/threads | ~/.local/share/amp/threads
//                    grok    $GROK_HOME/sessions        | ~/.grok/sessions
//   layouts          claude  <root>/projects/<project>/<uuid>.jsonl
//                    codex   <root>/sessions/<y>/<m>/<d>/<uuid>.jsonl
//                    pi      <root>/<dir>/<name>_<id>.jsonl
//                    amp     <root>/T-<id>.json
//                    grok    <root>/<cwdDir>/<sessionId>/{summary.json,chat_history.jsonl}
//   bounds           MIN_BYTES 512 · FILES_PER_HARNESS_CAP 300 · RESULT_CAP 120
//                    SEARCH_FILES_CAP 60 · SEARCH_MAX_BYTES 1.5 MB
//                    HITS_PER_SESSION 3 · HIT_LINE_CAP 300
//   the library      <userData>/session-library.json
//                    {sessions: [{sessionId, sourceId, title, lastActive, ...}]}
//                    (a damaged file is preserved as .corrupt-<ts> and rebuilt)
//   the title        the harness' own summary line, else the first user text,
//                    else "Session in <folder>" / "Untitled session"
//   the cwd          the harness' own session_meta cwd, else the first "cwd"
//   folder facts     for every path: {path, root, name, kind, home, temporary,
//                    driveRoot, system} — "kind" is folder | repository | missing
//
// autumn's search reads the transcript's own JSONL lines (the RE shells out to
// a native `txcript` helper for the same thing); the result shape is the
// RE's: up to HITS_PER_SESSION matching lines per session.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { userDataDir } from "./store";

// ---------------------------------------------------------------------------
// the RE's bounds
// ---------------------------------------------------------------------------

export const PORTABLE_HARNESSES = ["claude_code", "codex", "pi", "amp", "grok"] as const;
export type PortableHarness = (typeof PORTABLE_HARNESSES)[number];

const FILES_PER_HARNESS_CAP = 300;
const RESULT_CAP = 120;
const MIN_BYTES = 512;
const CHUNK_BYTES = 64 * 1024;
const SEARCH_FILES_CAP = 60;
const SEARCH_MAX_BYTES = 1_500_000;
const HITS_PER_SESSION = 3;
const HIT_LINE_CAP = 300;
const MAX_FOLDER_FACTS = 2_000;
const FOLDER_FACT_TIMEOUT_MS = 1_500;

const UUIDISH = /^[A-Za-z0-9._-]+$/;
const CODEX_FILE_UUID = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;
const SAFE_PORTABLE_ID = /^[A-Za-z0-9._-]{1,256}$/;

// ---------------------------------------------------------------------------
// the roots
// ---------------------------------------------------------------------------

export interface PortableRoots {
  claudeRoot: string;
  codexRoot: string;
  piRoot: string;
  ampRoot: string;
  grokRoot: string;
}

/** The RE's `defaultRoots` — where each harness keeps its sessions. */
export function defaultRoots(home: string = homedir()): PortableRoots {
  return {
    claudeRoot: process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codexRoot: process.env.CODEX_HOME || join(home, ".codex"),
    piRoot:
      process.env.PI_CODING_AGENT_SESSION_DIR ||
      (process.env.PI_CODING_AGENT_DIR
        ? join(process.env.PI_CODING_AGENT_DIR, "sessions")
        : join(home, ".pi", "agent", "sessions")),
    ampRoot:
      process.env.AMP_THREADS_DIR ||
      (process.platform !== "win32" && process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, "amp", "threads")
        : join(home, ".local", "share", "amp", "threads")),
    grokRoot: process.env.GROK_HOME ? join(process.env.GROK_HOME, "sessions") : join(home, ".grok", "sessions"),
  };
}

// ---------------------------------------------------------------------------
// the file discovery (the RE's layouts)
// ---------------------------------------------------------------------------

export interface StoreEntry {
  harness: PortableHarness;
  sessionId: string;
  file: string;
  lastActive: number;
  sizeBytes: number;
}

const safeList = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const claudeIdFromFilename = (name: string): string | null => {
  if (!name.endsWith(".jsonl")) return null;
  const id = name.slice(0, -".jsonl".length);
  return UUIDISH.test(id) ? id : null;
};

const codexIdFromFilename = (name: string): string | null => {
  const m = name.match(CODEX_FILE_UUID);
  return m ? m[1] : null;
};

const piIdFromFilename = (name: string): string | null => {
  if (!name.endsWith(".jsonl")) return null;
  const parts = name.slice(0, -".jsonl".length).split("_");
  const id = parts[parts.length - 1];
  return id && SAFE_PORTABLE_ID.test(id) ? id : null;
};

export function claudeFiles(root: string): StoreEntry[] {
  const out: StoreEntry[] = [];
  const projectsDir = join(root, "projects");
  if (!existsSync(projectsDir)) return out;
  for (const dir of safeList(projectsDir)) {
    for (const f of safeList(join(projectsDir, dir))) {
      const id = claudeIdFromFilename(f);
      if (!id) continue;
      out.push({ harness: "claude_code", sessionId: id, file: join(projectsDir, dir, f), lastActive: 0, sizeBytes: 0 });
    }
  }
  return out;
}

export function codexFiles(root: string): StoreEntry[] {
  const out: StoreEntry[] = [];
  const sessionsDir = join(root, "sessions");
  if (!existsSync(sessionsDir)) return out;
  for (const y of safeList(sessionsDir)) {
    for (const m of safeList(join(sessionsDir, y))) {
      for (const d of safeList(join(sessionsDir, y, m))) {
        for (const f of safeList(join(sessionsDir, y, m, d))) {
          const id = codexIdFromFilename(f);
          if (!id) continue;
          out.push({
            harness: "codex",
            sessionId: id,
            file: join(sessionsDir, y, m, d, f),
            lastActive: 0,
            sizeBytes: 0,
          });
        }
      }
    }
  }
  return out;
}

export function piFiles(root: string): StoreEntry[] {
  const out: StoreEntry[] = [];
  if (!root || !existsSync(root)) return out;
  for (const dir of safeList(root)) {
    const full = join(root, dir);
    for (const f of safeList(full)) {
      const id = piIdFromFilename(f);
      if (!id) continue;
      out.push({ harness: "pi", sessionId: id, file: join(full, f), lastActive: 0, sizeBytes: 0 });
    }
  }
  return out;
}

export function ampFiles(root: string): StoreEntry[] {
  const out: StoreEntry[] = [];
  if (!root || !existsSync(root)) return out;
  for (const f of safeList(root)) {
    if (!f.startsWith("T-") || !f.endsWith(".json")) continue;
    const id = f.slice(0, -".json".length);
    if (!SAFE_PORTABLE_ID.test(id)) continue;
    out.push({ harness: "amp", sessionId: id, file: join(root, f), lastActive: 0, sizeBytes: 0 });
  }
  return out;
}

export function grokFiles(root: string): StoreEntry[] {
  const out: StoreEntry[] = [];
  if (!root || !existsSync(root)) return out;
  for (const cwdDir of safeList(root)) {
    const bucket = join(root, cwdDir);
    for (const sess of safeList(bucket)) {
      if (!SAFE_PORTABLE_ID.test(sess)) continue;
      const dir = join(bucket, sess);
      if (
        !existsSync(join(dir, "summary.json")) &&
        !existsSync(join(dir, "chat_history.jsonl"))
      ) {
        continue;
      }
      out.push({ harness: "grok", sessionId: sess, file: dir, lastActive: 0, sizeBytes: 0 });
    }
  }
  return out;
}

/** The RE's `walkStore`. */
export function walkStore(roots: PortableRoots, harness: string): StoreEntry[] {
  switch (harness) {
    case "claude_code":
      return claudeFiles(roots.claudeRoot);
    case "codex":
      return codexFiles(roots.codexRoot);
    case "pi":
      return piFiles(roots.piRoot);
    case "amp":
      return ampFiles(roots.ampRoot);
    case "grok":
      return grokFiles(roots.grokRoot);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// the transcript readers (the RE's parsers)
// ---------------------------------------------------------------------------

/** The first 64 KB of a transcript (the RE's `firstChunk`). */
export function firstChunk(file: string): string {
  const fd = require("node:fs").openSync(file, "r");
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    const n = require("node:fs").readSync(fd, buf, 0, CHUNK_BYTES, 0);
    return buf.toString("utf8", 0, n);
  } finally {
    require("node:fs").closeSync(fd);
  }
}

/** The JSON lines of a transcript chunk. */
export function jsonLines(chunk: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const line of chunk.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* not a json line */
    }
  }
  return out;
}

/** The RE's `extractCwd`. */
export function extractCwd(chunk: string): string | null {
  const m = chunk.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

/** The RE's `codexCwdFromChunk`. */
export function codexCwdFromChunk(chunk: string): string | null {
  for (const l of jsonLines(chunk)) {
    if (l.type !== "session_meta") continue;
    const cwd = l.payload?.cwd;
    return typeof cwd === "string" && cwd ? cwd : null;
  }
  return null;
}

/** The RE's `piCwdFromChunk`. */
export function piCwdFromChunk(chunk: string): string | null {
  for (const l of jsonLines(chunk)) {
    if (l.type !== "session") continue;
    return typeof l.cwd === "string" && l.cwd ? l.cwd : null;
  }
  return null;
}

/** The RE's `fileUriToPath`. */
export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let rest = uri.slice("file://".length);
  if (rest && !rest.startsWith("/")) rest = `//${rest}`;
  try {
    rest = decodeURIComponent(rest);
  } catch {
    /* keep the raw value */
  }
  if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  return rest || null;
}

/** The RE's `ampMetaFromChunk`. */
export function ampMetaFromChunk(chunk: string): { cwd: string | null; title: string | null } {
  try {
    const doc = JSON.parse(chunk);
    const uri = doc.env?.initial?.trees?.[0]?.uri;
    return {
      cwd: typeof uri === "string" ? fileUriToPath(uri) : null,
      title: typeof doc.title === "string" && doc.title.trim() ? doc.title.trim().slice(0, 120) : null,
    };
  } catch {
    /* not a whole document */
  }
  const unescape = (s: string): string | null => {
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      return null;
    }
  };
  const msgIdx = chunk.indexOf('"messages"');
  const head = msgIdx === -1 ? chunk : chunk.slice(0, msgIdx);
  const titleMatch = head.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const uriMatch = chunk.match(/"trees"\s*:\s*\[\s*\{\s*"uri"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const cwd = uriMatch ? fileUriToPath(unescape(uriMatch[1]) ?? "") : null;
  const title = titleMatch ? unescape(titleMatch[1]) : null;
  return { cwd, title: title ? title.trim().slice(0, 120) : null };
}

/** The RE's `firstUserText`. */
export function firstUserText(lines: Array<Record<string, any>>, harness: string): string | null {
  for (const l of lines) {
    if (harness === "claude_code") {
      if (l.type !== "user") continue;
      const content = l.message?.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const t = content.find((b: any) => b?.type === "text");
        if (t?.text?.trim()) return t.text;
      }
    } else if (harness === "codex") {
      const payload = l.payload;
      if (l.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") continue;
      const t = payload.content?.find((b: any) => typeof b?.text === "string" && b.text.trim());
      if (t?.text) return t.text;
    } else if (harness === "pi") {
      if (l.type !== "message") continue;
      const message = l.message;
      if (message?.role !== "user") continue;
      const content = message.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const t = content.find((b: any) => typeof b === "string" ? b.trim() : b?.type === "text");
        if (typeof t === "string" && t.trim()) return t;
        if (t?.text?.trim()) return t.text;
      }
    } else if (harness === "amp") {
      const message = l.message ?? l;
      if (message?.role !== "user") continue;
      const content = message.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const t = content.find((b: any) => typeof b === "string" ? b.trim() : b?.type === "text");
        if (typeof t === "string" && t.trim()) return t;
        if (t?.text?.trim()) return t.text;
      }
    }
  }
  return null;
}

/** The RE's `titleFromChunk`. */
export function titleFromChunk(chunk: string, harness: string): string | null {
  const lines = jsonLines(chunk);
  if (harness === "claude_code") {
    const summary = lines.find((l) => l.type === "summary" && typeof l.summary === "string");
    if (summary?.summary?.trim()) return summary.summary.trim().slice(0, 120);
  }
  if (harness === "pi") {
    const info = lines.find((l) => l.type === "session_info" && typeof l.name === "string");
    if (info?.name?.trim()) return info.name.trim().slice(0, 120);
  }
  const user = firstUserText(lines, harness);
  return user ? user.trim().slice(0, 120) : null;
}

/** The RE's `fallbackTitle`. */
export function fallbackTitle(cwd: string | null): string {
  const base = cwd?.split(/[\\/]/).filter(Boolean).pop();
  return base ? `Session in ${base}` : "Untitled session";
}

/** The RE's `readGrokSummary`. */
function readGrokSummary(dir: string): { cwd: string | null; title: string | null } {
  try {
    const s = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    const cwd = typeof s?.info?.cwd === "string" ? s.info.cwd : null;
    const title = typeof s?.info?.title === "string" ? s.info.title.trim().slice(0, 120) : null;
    return { cwd, title };
  } catch {
    return { cwd: null, title: null };
  }
}

/** The RE's `sourcePrimaryPath`. */
export function sourcePrimaryPath(harness: string, ref: string): string {
  if (harness !== "grok") return ref;
  const log = join(ref, "chat_history.jsonl");
  return existsSync(log) ? log : join(ref, "summary.json");
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

export interface PortableSession {
  harness: PortableHarness;
  sessionId: string;
  cwd: string | null;
  cwdExists: boolean;
  lastActive: number;
  sizeBytes: number;
  title: string;
  tracked: boolean;
}

const statEntry = (entry: StoreEntry): { mtimeMs: number; size: number } | null => {
  try {
    const st = statSync(sourcePrimaryPath(entry.harness, entry.file));
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
};

const toSession = (entry: StoreEntry, knownIds: Set<string>): PortableSession | null => {
  let cwd: string | null = null;
  let title: string | null = null;
  if (entry.harness === "grok") {
    const s = readGrokSummary(entry.file);
    cwd = s.cwd;
    title = s.title;
  } else {
    let chunk: string;
    try {
      chunk = firstChunk(entry.file);
    } catch {
      return null;
    }
    if (entry.harness === "amp") {
      const m = ampMetaFromChunk(chunk);
      cwd = m.cwd;
      title = m.title;
    } else {
      cwd =
        entry.harness === "codex"
          ? codexCwdFromChunk(chunk)
          : entry.harness === "pi"
            ? piCwdFromChunk(chunk)
            : extractCwd(chunk);
      title = titleFromChunk(chunk, entry.harness);
    }
  }
  return {
    harness: entry.harness,
    sessionId: entry.sessionId,
    cwd,
    cwdExists: !!cwd && existsSync(cwd),
    lastActive: entry.lastActive,
    sizeBytes: entry.sizeBytes,
    title: title ?? fallbackTitle(cwd),
    tracked: knownIds.has(entry.sessionId),
  };
};

/** The RE's `discoverPortableSessions`. */
export function discoverPortableSessions(
  roots: PortableRoots = defaultRoots(),
  knownIds: Set<string> = new Set(),
): PortableSession[] {
  const results: PortableSession[] = [];
  const groups = [
    claudeFiles(roots.claudeRoot),
    codexFiles(roots.codexRoot),
    piFiles(roots.piRoot),
    ampFiles(roots.ampRoot),
    grokFiles(roots.grokRoot),
  ];
  for (const files of groups) {
    const fresh: StoreEntry[] = [];
    for (const c of files) {
      const st = statEntry(c);
      if (!st || st.size < MIN_BYTES) continue;
      c.lastActive = st.mtimeMs;
      c.sizeBytes = st.size;
      fresh.push(c);
    }
    fresh.sort((a, b) => b.lastActive - a.lastActive);
    for (const c of fresh.slice(0, FILES_PER_HARNESS_CAP)) {
      const s = toSession(c, knownIds);
      if (s) results.push(s);
      if (results.length >= RESULT_CAP * 2) break;
    }
  }
  results.sort((a, b) => b.lastActive - a.lastActive);
  return results.slice(0, RESULT_CAP);
}

/** The matching lines of a transcript (the RE's `txcript` search). */
export function searchTranscriptLines(text: string, pattern: string): string[] {
  const needle = pattern.trim().toLowerCase();
  if (!needle) return [];
  const hits: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (line.toLowerCase().includes(needle)) hits.push(line);
    if (hits.length >= HITS_PER_SESSION * 4) break;
  }
  return hits;
}

/** The RE's `searchPortableSessions` — the metadata hits AND the content hits. */
export async function searchPortableSessions(
  pattern: string,
  roots: PortableRoots = defaultRoots(),
  knownIds: Set<string> = new Set(),
): Promise<Array<PortableSession & { hits: string[] }>> {
  const q = pattern.trim().toLowerCase();
  const all = discoverPortableSessions(roots, knownIds);
  if (!q) return all.map((s) => ({ ...s, hits: [] }));
  const metaHit = (s: PortableSession): boolean =>
    s.title.toLowerCase().includes(q) ||
    (s.cwd ?? "").toLowerCase().includes(q) ||
    s.sessionId.toLowerCase().includes(q);
  const refById = new Map<string, string>();
  for (const h of PORTABLE_HARNESSES) {
    for (const c of walkStore(roots, h)) refById.set(`${h}:${c.sessionId}`, c.file);
  }
  const out: Array<PortableSession & { hits: string[] }> = [];
  let opened = 0;
  for (const s of all) {
    let hits: string[] = [];
    if (opened < SEARCH_FILES_CAP && s.sizeBytes <= SEARCH_MAX_BYTES) {
      const ref = refById.get(`${s.harness}:${s.sessionId}`);
      if (ref) {
        opened++;
        try {
          const text = readFileSync(sourcePrimaryPath(s.harness, ref), "utf8");
          hits = searchTranscriptLines(text, pattern)
            .slice(0, HITS_PER_SESSION)
            .map((line) => (line.length > HIT_LINE_CAP ? `${line.slice(0, HIT_LINE_CAP)} …` : line));
        } catch {
          hits = [];
        }
      }
    }
    if (hits.length || metaHit(s)) out.push({ ...s, hits });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the library file (the RE's `session-library.json`)
// ---------------------------------------------------------------------------

export interface LibraryEntry {
  sessionId: string;
  sourceId: string;
  title: string;
  lastActive: number;
  harness: string;
  cwd?: string | null;
  sizeBytes?: number;
}

export interface LibraryFile {
  sessions: LibraryEntry[];
}

export const libraryPath = (): string => join(userDataDir(), "session-library.json");

let libraryWarning: string | null = null;

/** The RE's `readSessionLibrary` — a damaged file is preserved, not ignored. */
export function readSessionLibrary(): LibraryEntry[] {
  libraryWarning = null;
  if (!existsSync(libraryPath())) return [];
  const raw = readFileSync(libraryPath(), "utf8");
  try {
    const data = JSON.parse(raw) as Partial<LibraryFile>;
    if (
      !Array.isArray(data.sessions) ||
      data.sessions.some(
        (row) =>
          !row ||
          typeof row.sessionId !== "string" ||
          typeof row.sourceId !== "string" ||
          typeof row.title !== "string" ||
          typeof row.lastActive !== "number",
      )
    ) {
      throw new Error("Invalid library metadata");
    }
    return data.sessions;
  } catch {
    try {
      require("node:fs").renameSync(libraryPath(), `${libraryPath()}.corrupt-${Date.now()}`);
    } catch {
      /* the file is already gone */
    }
    libraryWarning =
      "The saved import index was damaged and has been preserved for diagnosis. Scan again to rebuild it from your original sessions.";
    return [];
  }
}

/** The warning the last `readSessionLibrary` produced (the RE's). */
export function libraryWarningText(): string | null {
  return libraryWarning;
}

/** Write the library index (atomically). */
export function writeSessionLibrary(sessions: LibraryEntry[]): void {
  const file = libraryPath();
  require("node:fs").mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  require("node:fs").writeFileSync(tmp, JSON.stringify({ sessions }, null, 2), "utf8");
  require("node:fs").renameSync(tmp, file);
}

/** The RE's `libraryEntryKey`. */
export const libraryEntryKey = (entry: LibraryEntry): string =>
  `${entry.sourceId} ${entry.harness} ${entry.sessionId}`;

// ---------------------------------------------------------------------------
// the folder facts (the RE's `folderFacts`)
// ---------------------------------------------------------------------------

export interface FolderFact {
  path: string;
  root: string;
  name: string;
  kind: "folder" | "repository" | "missing";
  home: boolean;
  temporary: boolean;
  driveRoot: boolean;
  system: boolean;
}

export interface FolderFactRoots {
  home: string;
  generated: string[];
  system: string[];
}

/** The RE's `folderFactRoots`. */
export function folderFactRoots(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  tmp: string = tmpdir(),
  userData: string = userDataDir(),
): FolderFactRoots {
  const generated = [tmp, userData];
  if (platform !== "win32") {
    generated.push("/tmp", "/var/tmp", "/private/tmp", "/var/folders", "/private/var/folders");
  }
  if (platform === "linux" && env.XDG_RUNTIME_DIR) generated.push(env.XDG_RUNTIME_DIR);
  const system = platform === "win32" ? [env.WINDIR, env.SystemRoot].filter((v): v is string => !!v) : [];
  return { home, generated, system };
}

const isUncPath = (p: string): boolean => /^\\\\\?\\UNC\\/.test(p) || /^[\\/]{2}[^\\/?.]/.test(p);
const isDriveRoot = (p: string): boolean => /^[A-Za-z]:[\\/]?$/.test(p);
const canonical = (p: string): string => {
  const out = resolve(p);
  try {
    return require("node:fs").realpathSync(out);
  } catch {
    return out;
  }
};
const samePath = (a: string, b: string): boolean =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const insideRoot = (p: string, root: string): boolean => {
  const norm = (x: string) => (process.platform === "win32" ? x.toLowerCase() : x).replace(/[\\/]+$/, "");
  return norm(p).startsWith(`${norm(root)}${sep}`);
};

/** The RE's `folderFacts` — what kind of folder each path is. */
export function folderFacts(paths: unknown, roots: FolderFactRoots): FolderFact[] {
  if (!Array.isArray(paths)) return [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths.slice(0, MAX_FOLDER_FACTS)) {
    if (typeof raw !== "string" || !raw || raw.length > 4096 || seen.has(raw)) continue;
    if (!isUncPath(raw) && !isAbsolute(raw)) continue;
    seen.add(raw);
    unique.push(raw);
  }
  const home = canonical(roots.home);
  const generated = roots.generated.filter(Boolean).map(canonical);
  const system = (roots.system ?? []).filter(Boolean).map(canonical);
  const out: FolderFact[] = [];
  for (const raw of unique) {
    const flags = { home: false, temporary: false, driveRoot: false, system: false };
    if (isUncPath(raw)) {
      out.push({ path: raw, root: raw, name: basename(raw) || raw, kind: "missing", ...flags });
      continue;
    }
    const p = canonical(raw);
    flags.home = samePath(p, home);
    flags.driveRoot = isDriveRoot(p);
    flags.system = !flags.home && system.some((root) => insideRoot(p, root));
    flags.temporary = !flags.home && generated.some((root) => insideRoot(p, root));
    let exists = false;
    try {
      statSync(p);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      out.push({ path: raw, root: p, name: basename(p) || p, kind: "missing", ...flags });
      continue;
    }
    // The repository root of the folder (the RE walks up to the .git).
    let repo: string | null = null;
    let current = p;
    for (let depth = 0; depth < 64; depth++) {
      if (samePath(current, home) || isDriveRoot(current)) break;
      const dotGit = resolve(current, ".git");
      try {
        const st = statSync(dotGit);
        if (st.isDirectory()) {
          repo = current;
          break;
        }
        // A worktree: the .git is a file pointing at the main checkout.
        const text = readFileSync(dotGit, "utf8").slice(0, 4096);
        const match = /^gitdir:\s*(.+)$/m.exec(text);
        if (match) {
          const gitdir = resolve(current, match[1].trim());
          const marker = `${sep}.git${sep}worktrees${sep}`;
          const at = gitdir.lastIndexOf(marker);
          if (at !== -1) repo = gitdir.slice(0, at + `${sep}.git`.length).replace(/[\\/]?\.git$/, "") || current;
          break;
        }
      } catch {
        /* not a repository here */
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const root = repo ?? p;
    out.push({
      path: raw,
      root,
      name: basename(root) || root,
      kind: repo ? "repository" : "folder",
      ...flags,
    });
  }
  return out;
}
