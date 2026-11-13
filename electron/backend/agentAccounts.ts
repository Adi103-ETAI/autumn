// autumn — Wave-2 handlers: agentAccounts (11 ids — 6 renderer-used + 5 dormant;
// docs/architecture/backend.md §W2-4). faithful to the `agent-accounts:*` IPC family
// (the contract's acctList/acctBeginAdd/acctProbe/
// acctFinalize/acctCancelPending/acctAbandonLogin/acctReLogin/acctRename/acctRemove/
// acctSystemLogin/acctSetAvatar; channel map in evidence/inventories/ipc-full.md
// and autumn/19-ipc-contract.md §agent-accounts).
//
// The model:
//   storage   <userData>/agent-accounts/<provider>/<uuid>/meta.json
//             (autumn writes its own meta.json; the rest matches)
//   providers ["claude", "codex"] only (listAccounts / ENV_VAR / SCRUB scope)
//   meta      {id, provider, label, addedAt, state:"pending"|"ready",
//             avatar? (integer 20..44), identity?, identityProbedAt?}
//   beginAdd  resolveBin(provider) on PATH else {reason:"cli-missing"}; busy gate
//             (LOGIN_GATE_MS 10min); mkdir profile + seed codex config.toml; write
//             pending meta; beginLogin → {ok, id, attemptId, terminalId:"acct-setup-<attemptId>"}
//             (the REAL login then happens in that terminal — no fake login here)
//   probe     spawn <bin> ["auth","status","--json"] (claude) or ["login","status"]
//             (codex) with profile env (CLAUDE_CONFIG_DIR/CODEX_HOME + credential
//             scrub) and 15s timeout → identity or {loggedIn:false,firstParty:false}
//             firstParty = loggedIn && authMethod==="claude.ai" && apiProvider==="firstParty"
//   finalize  requires ownsLogin(attemptId) + probe firstParty → uniqueLabel →
//             state "ready" → {ok,account}; reasons: unknown-account |
//             login-attempt-ended | not-a-subscription-login | not-logged-in
//   remove    in-use check → {ok:false,reason:"in-use",terminalIds}; logout then
//             delete profile; {ok:true} | {ok:true,warning:"logout-failed"}
//   systemLogin  claude|codex only (else null); system (non-profile) probe; 5min cache
//   setAvatar integer 20..44 (ACCOUNT_AVATAR_MIN/MAX), NOT a data-url
//
// DEVIATIONS (documented):
//   - target trashes profile dirs (electron.shell.trashItem); headless autumn
//     deletes them (no shell trash in tests) — cancelPending/remove note this.
//   - docs/architecture/backend.md's 60s identity cache: probeAccount always re-probes (cacheIdentity
//     is write-through into meta for usage reporting, not a read cache).
//   - autumn terminals don't yet carry accountId (target's terms map does), so
//     remove's in-use list defaults to [] and accepts params.usedBy for callers
//     that know better (terminalsUsingAccount(id)).

import { accessSync, constants as FS, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { userDataDir } from "./store";

// ---------------------------------------------------------------------------
// param normalization (same contract as auth.ts — positional | object | {args})
// ---------------------------------------------------------------------------

function paramsOf(params: unknown): { pos: unknown[]; obj: Record<string, unknown> } {
  if (Array.isArray(params)) return { pos: params, obj: {} };
  if (typeof params === "string") return { pos: [params], obj: {} };
  if (params && typeof params === "object") {
    const o = params as Record<string, unknown>;
    if (Array.isArray(o.args)) {
      const { args, ...rest } = o;
      return { pos: args, obj: rest };
    }
    return { pos: [], obj: o };
  }
  return { pos: [], obj: {} };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const PROVIDERS = ["claude", "codex"] as const;
type Provider = (typeof PROVIDERS)[number];
const isProvider = (v: unknown): v is Provider => typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

const ENV_VAR: Record<Provider, string> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };
const SCRUB: Record<Provider, string[]> = {
  claude: [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
  ],
  codex: ["OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"],
};
const ACCOUNT_AVATAR_MIN = 20;
const ACCOUNT_AVATAR_MAX = 44;
const ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const META_FILE = "meta.json"; // autumn's own name for the profile metadata file
const LOGIN_GATE_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 20_000;
const SYSTEM_LOGIN_TTL_MS = 5 * 60 * 1000;
const NO_IDENTITY = { loggedIn: false, firstParty: false } as const;

interface AccountMeta {
  id: string;
  provider: Provider;
  label: string;
  addedAt: number;
  state: "pending" | "ready";
  avatar?: number;
  identity?: { loggedIn: boolean; firstParty: boolean; email?: string; name?: string; orgName?: string; subscriptionType?: string };
  identityProbedAt?: number;
}

// module-level attempt/login state (latestAttempt / loginInFlight maps)
const latestAttempt = new Map<string, string>();
const loginInFlight = new Map<Provider, { id: string; attemptId: string; startedAt: number; isAdd: boolean }>();
const cancelling = new Set<string>();
const systemLogins = new Map<Provider, { identity: NonNullable<AccountMeta["identity"]> | null; at: number }>();

/** Test seam: clear in-process attempt state between test cases. */
export function _resetAgentAccountsState(): void {
  latestAttempt.clear();
  loginInFlight.clear();
  cancelling.clear();
  systemLogins.clear();
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

const rootDir = () => join(userDataDir(), "agent-accounts");
const providerDir = (p: Provider) => join(rootDir(), p);
const profileDir = (p: Provider, id: string) => join(providerDir(p), id);

function readMeta(provider: Provider, id: string): AccountMeta | null {
  try {
    const raw = readFileSync(join(profileDir(provider, id), META_FILE), "utf8");
    const meta = JSON.parse(raw) as AccountMeta;
    if (!meta || meta.id !== id || meta.provider !== provider) return null;
    if (meta.state !== "pending" && meta.state !== "ready") return null;
    return meta;
  } catch {
    return null;
  }
}

function writeMeta(meta: AccountMeta): void {
  const dir = profileDir(meta.provider, meta.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf8");
}

function listAccounts(): AccountMeta[] {
  const out: AccountMeta[] = [];
  for (const provider of PROVIDERS) {
    let entries: string[];
    try {
      entries = readdirSync(providerDir(provider));
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!ID_RE.test(id)) continue;
      const meta = readMeta(provider, id);
      if (meta) out.push(meta);
    }
  }
  return out.sort((a, b) => a.addedAt - b.addedAt);
}

function findAccount(id: string): AccountMeta | null {
  if (!ID_RE.test(id)) return null;
  for (const provider of PROVIDERS) {
    const meta = readMeta(provider, id);
    if (meta) return meta;
  }
  return null;
}

function validAccountAvatar(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= ACCOUNT_AVATAR_MIN && v <= ACCOUNT_AVATAR_MAX;
}

function sanitizeIdentity(value: unknown): AccountMeta["identity"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const identity: NonNullable<AccountMeta["identity"]> = {
    loggedIn: raw.loggedIn === true,
    firstParty: raw.firstParty === true,
  };
  for (const key of ["email", "name", "orgName", "subscriptionType"] as const) {
    const text = raw[key];
    if (typeof text === "string" && text.trim()) identity[key] = text.trim();
  }
  return identity;
}

function uniqueLabel(provider: Provider, wanted: string, selfId: string): string {
  const taken = new Set(
    listAccounts()
      .filter((a) => a.provider === provider && a.id !== selfId)
      .map((a) => a.label.trim().toLowerCase()),
  );
  const base = wanted.trim() || (provider === "codex" ? "Codex account" : "Claude account");
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const cand = `${base} (${n})`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return `${base} (${selfId.slice(0, 4)})`;
}

// ---------------------------------------------------------------------------
// PATH resolution + process runs (deps.spawn — fakeable in tests)
// ---------------------------------------------------------------------------

function resolveBin(name: string): string | null {
  const pathVar = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const candidates: string[] =
    process.platform === "win32"
      ? [name, ...exts.map((e) => name + e.toLowerCase()), ...exts.map((e) => name + e)]
      : [name];
  const mode = process.platform === "win32" ? FS.F_OK : FS.X_OK;
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const cand of candidates) {
      const p = join(dir, cand);
      try {
        accessSync(p, mode);
        return p;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function runProc(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, out, err });
    };
    let proc;
    try {
      // (passes windowsHide:true — the SpawnDep surface doesn't expose it.)
      proc = deps_spawn(cmd, args, { env: opts.env });
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      done(-1);
      return;
    }
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      out = (out + String(chunk)).slice(-65536);
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      err = (err + String(chunk)).slice(-16384);
    });
    proc.on("exit", (code) => done(code));
    proc.on("error", () => done(-1));
    if (opts.timeoutMs != null) {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
        done(-1);
      }, opts.timeoutMs);
    }
  });
}

/** spawn implementation injected at handler build (set by makeAgentAccountsHandlers). */
let deps_spawn: W1Deps["spawn"]["spawn"] = () => {
  throw new Error("agentAccounts: spawn dep not configured");
};

function profileEnv(provider: Provider, dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [ENV_VAR[provider]]: dir };
  for (const key of SCRUB[provider]) delete env[key];
  return env;
}

function parseClaudeStatus(out: string): NonNullable<AccountMeta["identity"]> {
  try {
    const s = JSON.parse(out) as Record<string, unknown>;
    const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
    return {
      loggedIn: s.loggedIn === true,
      ...(text(s.email) ? { email: s.email as string } : {}),
      ...(text(s.orgName) ? { orgName: s.orgName as string } : {}),
      ...(text(s.subscriptionType) ? { subscriptionType: s.subscriptionType as string } : {}),
      // "logged in" alone is NOT enough — only a first-party claude.ai login counts.
      firstParty: s.loggedIn === true && s.authMethod === "claude.ai" && s.apiProvider === "firstParty",
    };
  } catch {
    return { ...NO_IDENTITY };
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function codexIdentityFromAuthFile(dir: string): { email?: string; name?: string } {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")) as Record<string, any>;
    if (typeof raw.auth_mode === "string" && raw.auth_mode !== "chatgpt") return {};
    const token = raw.tokens?.id_token;
    if (typeof token !== "string") return {};
    const claims = decodeJwtPayload(token);
    if (!claims) return {};
    const email = typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim() : undefined;
    const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : undefined;
    return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
  } catch {
    return {};
  }
}

function seedProfile(provider: Provider, dir: string): void {
  if (provider !== "codex") return;
  const cfg = join(dir, "config.toml");
  try {
    readFileSync(cfg, "utf8");
  } catch {
    writeFileSync(cfg, 'cli_auth_credentials_store = "file"\n', "utf8");
  }
}

function ownsAttempt(id: string, attemptId: unknown): boolean {
  return typeof attemptId === "string" && ID_RE.test(attemptId) && latestAttempt.get(id) === attemptId;
}

function ownsLogin(account: AccountMeta, attemptId: unknown): boolean {
  const entry = loginInFlight.get(account.provider);
  return entry?.id === account.id && entry.attemptId === attemptId && ownsAttempt(account.id, attemptId);
}

function loginBusy(provider: Provider): boolean {
  const entry = loginInFlight.get(provider);
  if (!entry) return false;
  const stale = Date.now() - entry.startedAt > LOGIN_GATE_MS;
  const account = findAccount(entry.id);
  const finished = entry.isAdd && account?.state === "ready";
  return !stale && !finished;
}

function releaseLogin(provider: Provider, id: string, attemptId: unknown): void {
  const entry = loginInFlight.get(provider);
  if (entry?.id === id && entry.attemptId === attemptId) loginInFlight.delete(provider);
}

const setupTerminalId = (attemptId: string) => `acct-setup-${attemptId}`; //

function beginLogin(account: AccountMeta, isAdd: boolean): { ok: true; id: string; attemptId: string; terminalId: string } {
  const attemptId = randomUUID();
  latestAttempt.set(account.id, attemptId);
  loginInFlight.set(account.provider, { id: account.id, attemptId, startedAt: Date.now(), isAdd });
  return { ok: true, id: account.id, attemptId, terminalId: setupTerminalId(attemptId) };
}

async function logoutProfile(provider: Provider, dir: string): Promise<boolean> {
  const bin = resolveBin(provider);
  if (!bin) return false;
  const args = provider === "claude" ? ["auth", "logout"] : ["logout"];
  try {
    const r = await runProc(bin, args, { env: profileEnv(provider, dir), timeoutMs: LOGOUT_TIMEOUT_MS });
    return r.code === 0;
  } catch {
    return false;
  }
}

async function probeAccount(id: string): Promise<NonNullable<AccountMeta["identity"]>> {
  const account = findAccount(id);
  if (!account) return { ...NO_IDENTITY };
  const bin = resolveBin(account.provider);
  if (!bin) return { ...NO_IDENTITY };
  const dir = profileDir(account.provider, account.id);
  let identity: AccountMeta["identity"];
  if (account.provider === "claude") {
    const r = await runProc(bin, ["auth", "status", "--json"], { env: profileEnv(account.provider, dir), timeoutMs: PROBE_TIMEOUT_MS });
    if (r.code !== 0) return { ...NO_IDENTITY };
    identity = parseClaudeStatus(r.out);
  } else {
    const r = await runProc(bin, ["login", "status"], { env: profileEnv(account.provider, dir), timeoutMs: PROBE_TIMEOUT_MS });
    const ok = r.code === 0;
    identity = { loggedIn: ok, firstParty: ok, ...codexIdentityFromAuthFile(dir) };
  }
  if (identity?.loggedIn) cacheIdentity(id, identity);
  return identity ?? { ...NO_IDENTITY };
}

function cacheIdentity(id: string, identity: NonNullable<AccountMeta["identity"]>): void {
  const current = findAccount(id);
  if (!current || cancelling.has(id)) return;
  writeMeta({ ...current, identity, identityProbedAt: Date.now() });
}

async function probeSystemLogin(provider: Provider, refresh: boolean): Promise<NonNullable<AccountMeta["identity"]> | null> {
  const cached = systemLogins.get(provider);
  if (!refresh && cached && Date.now() - cached.at < SYSTEM_LOGIN_TTL_MS) return cached.identity;
  const bin = resolveBin(provider);
  let identity: NonNullable<AccountMeta["identity"]> | null = null;
  if (bin) {
    if (provider === "claude") {
      const r = await runProc(bin, ["auth", "status", "--json"], { env: { ...process.env }, timeoutMs: PROBE_TIMEOUT_MS });
      if (r.code === 0) identity = parseClaudeStatus(r.out);
    } else {
      const r = await runProc(bin, ["login", "status"], { env: { ...process.env }, timeoutMs: PROBE_TIMEOUT_MS });
      identity = r.code === 0 ? { loggedIn: true, firstParty: true } : null;
    }
  }
  systemLogins.set(provider, { identity, at: Date.now() });
  return identity;
}

/** Test seam — override PATH-based probing with canned probe results. */
export const _internals = { resolveBin, parseClaudeStatus, listAccounts, findAccount, profileDir };

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeAgentAccountsHandlers(deps: W1Deps): RegisteredHandler[] {
  deps_spawn = deps.spawn.spawn;
  const { now } = deps;

  const idOf = (params: unknown): { id?: string; rest: unknown[]; obj: Record<string, unknown> } => {
    const { pos, obj } = paramsOf(params);
    return { id: str(obj.id) ?? str(pos[0]), rest: pos, obj };
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "agentAccounts.list",
      description: "managed account rows (listAccounts: claude+codex provider dirs, sorted by addedAt)",
      handler: () => listAccounts().map((m) => ({ ...m })),
    },
    {
      kind: "bridge",
      id: "agentAccounts.beginAdd",
      description:
        "start adding an account (beginAdd(provider) → {ok,id,attemptId,terminalId:'acct-setup-<id>'}; real login continues in that terminal; reasons cli-missing | login-in-progress)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.provider) ?? str(pos[0]))) return { ok: false, message: "provider required (claude|codex)" };
        return { ok: true };
      },
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const provider = str(obj.provider) ?? str(pos[0]);
        if (!isProvider(provider)) return { ok: false, reason: "unknown-provider", provider: provider ?? null };
        if (!resolveBin(provider)) return { ok: false, reason: "cli-missing", provider };
        if (loginBusy(provider)) return { ok: false, reason: "login-in-progress", provider };
        const id = randomUUID();
        const dir = profileDir(provider, id);
        mkdirSync(dir, { recursive: true });
        seedProfile(provider, dir);
        const account: AccountMeta = { id, provider, label: "", addedAt: now(), state: "pending" };
        writeMeta(account);
        return beginLogin(account, true);
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.probe",
      description:
        "probe account identity (probe(id) → spawn `claude auth status --json` / `codex login status` with profile env, 15s timeout; unknown/missing bin → {loggedIn:false,firstParty:false})",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.id) ?? str(pos[0]))) return { ok: false, message: "id required" };
        return { ok: true };
      },
      handler: async (params) => probeAccount(idOf(params).id as string),
    },
    {
      kind: "bridge",
      id: "agentAccounts.finalize",
      description:
        "finish adding (finalize(id, attemptId, label) positional → probe + firstParty required → unique label, state 'ready'; {ok,account} | {ok:false,reason})",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.id) ?? str(pos[0]))) return { ok: false, message: "id required" };
        return { ok: true };
      },
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj.id) ?? str(pos[0]);
        const attemptId = str(obj.attemptId) ?? str(pos[1]);
        const label = str(obj.label) ?? str(pos[2]) ?? "";
        const account = id ? findAccount(id) : null;
        if (!account || cancelling.has(id as string)) return { ok: false, reason: "unknown-account" };
        if (!ownsLogin(account, attemptId)) return { ok: false, reason: "login-attempt-ended" };
        const identity = await probeAccount(id as string);
        if (!identity.firstParty) {
          return { ok: false, reason: identity.loggedIn ? "not-a-subscription-login" : "not-logged-in" };
        }
        const current = findAccount(id as string);
        if (!current || cancelling.has(id as string)) return { ok: false, reason: "unknown-account" };
        if (!ownsLogin(current, attemptId)) return { ok: false, reason: "login-attempt-ended" };
        const next: AccountMeta = { ...current, label: uniqueLabel(current.provider, label, current.id), state: "ready", ...(current.identity ? { identity: current.identity } : {}) };
        writeMeta(next);
        releaseLogin(current.provider, current.id, attemptId);
        latestAttempt.delete(current.id);
        return { ok: true, account: next };
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.cancelPending",
      description:
        "cancel a pending add (runCancelPending: logout profile → delete dir → release attempt; state pending + attempt ownership required)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj.id) ?? str(pos[0]);
        const attemptId = str(obj.attemptId) ?? str(pos[1]);
        const account = id ? findAccount(id) : null;
        if (!account || account.state !== "pending" || cancelling.has(id as string) || !ownsAttempt(id as string, attemptId)) {
          return null;
        }
        cancelling.add(id as string);
        try {
          const dir = profileDir(account.provider, account.id);
          await logoutProfile(account.provider, dir);
          rmSync(dir, { recursive: true, force: true }); // target: shell.trashItem (documented deviation)
        } finally {
          releaseLogin(account.provider, account.id, attemptId);
          latestAttempt.delete(account.id);
          cancelling.delete(account.id);
        }
        return null;
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.abandonLogin",
      description: "release a login attempt without touching the account (abandonLogin(id, attemptId))",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = str(obj.id) ?? str(pos[0]);
        const attemptId = str(obj.attemptId) ?? str(pos[1]);
        const account = id ? findAccount(id) : null;
        if (account) releaseLogin(account.provider, account.id, attemptId);
        return null;
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.reLogin",
      description: "re-open a login attempt for an existing account (beginReLogin(id) → beginLogin(false); cli-missing when the CLI is gone)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.id) ?? str(pos[0]))) return { ok: false, message: "id required" };
        return { ok: true };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = (str(obj.id) ?? str(pos[0])) as string;
        const account = findAccount(id);
        if (!account) return { ok: false, reason: "unknown-account" };
        if (!resolveBin(account.provider)) return { ok: false, reason: "cli-missing", provider: account.provider };
        if (cancelling.has(id) || loginBusy(account.provider)) return { ok: false, reason: "login-in-progress", provider: account.provider };
        return beginLogin(account, false);
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.rename",
      description: "rename with per-provider unique label (rename(id, label) → {ok,account} | {ok:false,reason:'unknown-account'})",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.id) ?? str(pos[0]))) return { ok: false, message: "id required" };
        return { ok: true };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = (str(obj.id) ?? str(pos[0])) as string;
        const label = str(obj.label) ?? str(pos[1]) ?? "";
        const account = findAccount(id);
        if (!account) return { ok: false, reason: "unknown-account" };
        const next: AccountMeta = { ...account, label: uniqueLabel(account.provider, label, account.id) };
        writeMeta(next);
        return { ok: true, account: next };
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.remove",
      description:
        "remove an account (removeAccount(id, terminalsUsingAccount(id)) — in-use guard, logout, delete profile; unknown id → {ok:true} idempotent)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const id = (str(obj.id) ?? str(pos[0])) as string;
        const usedBy = Array.isArray(obj.usedBy) ? (obj.usedBy as string[]) : []; // terminalsUsingAccount(id)
        const account = findAccount(id);
        if (!account) return { ok: true };
        if (usedBy.length > 0) return { ok: false, reason: "in-use", terminalIds: usedBy };
        if (loginInFlight.get(account.provider)?.id === id) loginInFlight.delete(account.provider);
        latestAttempt.delete(id);
        const dir = profileDir(account.provider, account.id);
        const loggedOut = await logoutProfile(account.provider, dir);
        try {
          rmSync(dir, { recursive: true, force: true }); // target: shell.trashItem (documented deviation)
        } catch (e) {
          return { ok: true, warning: `delete-failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        return loggedOut ? { ok: true } : { ok: true, warning: "logout-failed" };
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.systemLogin",
      description:
        "probe the SYSTEM (non-profile) CLI login (systemLogin(provider, refresh) — claude|codex only, others → null; 5min cache, refresh bypasses)",
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const provider = str(obj.provider) ?? str(pos[0]);
        const refresh = (obj.refresh ?? pos[1]) === true;
        if (!isProvider(provider)) return null; // returns null for non claude/codex
        return probeSystemLogin(provider, refresh);
      },
    },
    {
      kind: "bridge",
      id: "agentAccounts.setAvatar",
      description: "set the avatar index (setAccountAvatar(id, avatar) — integer 20..44 only, stored in meta; {ok,account} | {ok:false,reason})",
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const id = (str(obj.id) ?? str(pos[0])) as string;
        const avatar = (typeof obj.avatar === "number" ? obj.avatar : pos[1]) as unknown;
        const account = findAccount(id);
        if (!account) return { ok: false, reason: "unknown-account" };
        if (!validAccountAvatar(avatar)) return { ok: false, reason: "invalid-avatar" };
        const next: AccountMeta = { ...account, avatar: avatar as number };
        writeMeta(next);
        return { ok: true, account: next };
      },
    },
  ];

  return handlers;
}
