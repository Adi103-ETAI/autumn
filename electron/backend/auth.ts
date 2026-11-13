// autumn — Wave-2 handlers: auth (12 dispatchable + auth.onChanged push; docs/architecture/backend.md-4).
//
// The semantics (the 12
// `auth:*` channels, cross-checked with autumn/01-main-auth-and-ipc.md §1.2/§2
// and evidence/inventories/ipc-full.md `auth:` — 12):
//   signIn(email, password)        positional; throws on failure; returns {id,email}
//   signUp(email, password)        positional; returns {user, needsConfirmation,
//                                  alreadyRegistered?} (already-registered →
//                                  {user:null, needsConfirmation:false, alreadyRegistered:true})
//   signInWithOAuth(provider, attemptId)  awaits full loopback flow; returns the user
//   oauthAction(attemptId, "cancel"|"copy-link")  throws "Invalid sign-in action." on
//                                  bad action / stale attempt; copy-link → clipboard
//   resetPassword(email)           positional; target = Supabase reset link (throws on error)
//   resendConfirmation(email)      positional
//   signOut()                      local scope; returns void
//   forgetSavedSignIn()            clears stored session + verifier + local sign-out
//   status()                       → current user | null (renderer: `account = await status()`)
//   networkRestored()              target: net.isOnline() side-effects, returns void
//   localUser()                    → user | null straight from the session store
//   validate()                     → {status:"valid"|"invalid"|"unreachable", user}
//   onChanged(user)                push; renderer sets state.account = user directly
//                                  (user object, or null on sign-out — NOT an envelope)
//
// Renderer call shapes (index-C29xCgPS.js): signIn(email.trim(), password),
// signUp(email.trim(), password) → destructures {needsConfirmation},
// resetPassword(email.trim()), resendConfirmation(addr), signOut(),
// status() → account object used as .id/.email directly.
//
// DEVIATIONS (documented in docs/architecture/backend.md):
//   - Target auth = Supabase (email/password + OAuth PKCE + encrypted
//     supabase-session.json). autumn is local-first: node:crypto scrypt only —
//     no external provider, works offline, same renderer-visible shapes.
//   - No SMTP: recovery codes are shown ONCE at sign-up; resetPassword phase-1
//     RETURNS the code (local delivery) and logs it — there is no email to send.
//   - No billing: the target's `withPlan()` (plan attached to status/validate)
//     is omitted — autumn has no plans.
//   - networkRestored returns {online} (a real 3s probe) instead of void; the
//     target's void return only triggered cloud-retry side effects we don't have.
//   - OAuth: real GitHub loopback flow ONLY when GITHUB_CLIENT_ID/SECRET are set
//     (env-gated, same BYO pattern as the target's Supabase anon key); otherwise
//     {supported:false, reason} — never faked.

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

// ---------------------------------------------------------------------------
// param normalization — the target's renderer calls positionally; autumn's own
// UI passes objects; the facade packs multi-arg calls as {args:[...]}. Accept all.
// ---------------------------------------------------------------------------

export function paramsOf(params: unknown): { pos: unknown[]; obj: Record<string, unknown> } {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // local-first sessions last 30 days
const RESET_TTL_MS = 15 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  passHash: string; // hex
  salt: string; // hex
  provider?: "github"; // OAuth-linked accounts (real flow when env-configured)
  providerId?: string;
  recoveryHashes: { hash: string; salt: string; usedAt?: number }[];
  createdAt: number;
  lastSignInAt?: number;
}

interface AuthSession {
  id: string;
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

interface PendingReset {
  email: string;
  hash: string;
  salt: string;
  expiresAt: number;
}

type User = Omit<AuthUser, "passHash" | "salt" | "recoveryHashes">;

const publicUser = (u: AuthUser): User => {
  const { passHash, salt, recoveryHashes, ...rest } = u;
  void passHash;
  void salt;
  void recoveryHashes;
  return rest;
};

const usersFile = () => dbPath("auth-users.json");
const sessionsFile = () => dbPath("auth-sessions.json");
const resetsFile = () => dbPath("auth-resets.json");

const readUsers = (): AuthUser[] => loadJson<AuthUser[]>(usersFile(), []);
const readSessions = (): AuthSession[] => loadJson<AuthSession[]>(sessionsFile(), []);
const writeSessions = (s: AuthSession[]) => saveJson(sessionsFile(), s);

const hashPassword = (password: string, salt?: string): { hash: string; salt: string } => {
  const s = salt ?? randomBytes(16).toString("hex");
  return { hash: scryptSync(password, s, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString("hex"), salt: s };
};

const safeEqualHex = (a: string, b: string): boolean => {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

/** 8 recovery codes, format XXXX-XXXX (uppercase hex) — shown once, stored hashed. */
function makeRecoveryCodes(): { codes: string[]; stored: { hash: string; salt: string }[] } {
  const codes: string[] = [];
  const stored: { hash: string; salt: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = randomBytes(4).toString("hex").toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    codes.push(code);
    stored.push(hashPassword(code));
  }
  return { codes, stored };
}

/** Sessions sorted newest-first; valid = not expired. */
function validSessions(): AuthSession[] {
  const now = Date.now();
  return readSessions()
    .filter((s) => s.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function userBySession(params: Record<string, unknown>): AuthUser | null {
  const { obj } = paramsOf(params);
  const token = str(obj.sid) ?? str(obj.token);
  const sessions = validSessions();
  const session = token ? sessions.find((s) => s.token === token) : sessions[0];
  if (!session) return null;
  return readUsers().find((u) => u.id === session.userId) ?? null;
}

function createSession(userId: string): AuthSession {
  const now = Date.now();
  const session: AuthSession = {
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  writeSessions([session, ...readSessions().filter((s) => s.expiresAt > now)]);
  return session;
}

// ---------------------------------------------------------------------------
// pending OAuth attempt (real GitHub loopback flow; env-gated)
// ---------------------------------------------------------------------------

interface OAuthAttempt {
  id: string;
  url?: string;
  server?: { close: () => void };
  cancelled?: boolean;
  exchanging?: boolean;
}

let pendingOAuth: OAuthAttempt | null = null;

/** Test seam: clear the pending OAuth attempt between test cases. */
export function _resetAuthState(): void {
  pendingOAuth = null;
}

export function makeAuthHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;

  /** auth.onChanged pushes the USER object (or null) — renderer contract. */
  const push = (user: User | null) => emit("auth.onChanged", user);

  const findUserByEmail = (email: string): AuthUser | undefined =>
    readUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());

  const signInAs = (user: AuthUser): User => {
    user.lastSignInAt = now();
    const users = readUsers();
    const i = users.findIndex((u) => u.id === user.id);
    if (i >= 0) users[i] = user;
    saveJson(usersFile(), users);
    createSession(user.id);
    const pub = publicUser(user);
    push(pub);
    return pub;
  };

  const requireEmailPassword = (params: unknown, extra?: "name"): { email: string; password: string; name?: string } => {
    const { pos, obj } = paramsOf(params);
    const email = str(obj.email) ?? str(pos[0]);
    const password = str(obj.password) ?? str(pos[1]);
    const name = extra ? str(obj.name) ?? str(pos[2]) : undefined;
    if (!email || !EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    if (!password || password.length < MIN_PASSWORD) throw new Error(`Password should be at least ${MIN_PASSWORD} characters.`);
    return { email, password, name };
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "auth.signUp",
      description:
        "create a local account + session (signUp(email,password) positional → {user, needsConfirmation, alreadyRegistered?}; autumn adds recoveryCodes — shown once, no SMTP)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        const email = str(obj.email) ?? str(pos[0]);
        const password = str(obj.password) ?? str(pos[1]);
        if (!email || !password) return { ok: false, message: "email and password required (positional or {email,password})" };
        return { ok: true };
      },
      handler: (params) => {
        const { email, password, name } = requireEmailPassword(params, "name");
        const existing = findUserByEmail(email);
        if (existing) {
          // exact shape for an already-registered email.
          return { user: null, needsConfirmation: false, alreadyRegistered: true };
        }
        const { hash, salt } = hashPassword(password);
        const { codes, stored } = makeRecoveryCodes();
        const user: AuthUser = {
          id: randomUUID(),
          email,
          ...(name ? { name } : {}),
          passHash: hash,
          salt,
          recoveryHashes: stored.map((s) => ({ ...s })),
          createdAt: now(),
        };
        saveJson(usersFile(), [...readUsers(), user]);
        // Local-first: accounts confirm at sign-up (no email service); recovery
        // codes replace the target's emailed confirmation/reset link.
        return { user: signInAs(user), needsConfirmation: false, recoveryCodes: codes };
      },
    },
    {
      kind: "bridge",
      id: "auth.signIn",
      description: "sign in (signIn(email,password) positional → {id,email}; throws on bad credentials)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.email) ?? str(pos[0])) || !(str(obj.password) ?? str(pos[1])))
          return { ok: false, message: "email and password required" };
        return { ok: true };
      },
      handler: (params) => {
        const { email, password } = requireEmailPassword(params);
        const user = findUserByEmail(email);
        if (!user || !safeEqualHex(hashPassword(password, user.salt).hash, user.passHash)) {
          throw new Error("Invalid email or password."); // throws the provider error message
        }
        return signInAs(user);
      },
    },
    {
      kind: "bridge",
      id: "auth.signOut",
      description: "sign out (authSignOut() local scope, void); deletes the current session, emits onChanged(new-current|null)",
      handler: (params) => {
        const { obj } = paramsOf(params);
        const token = str(obj.sid) ?? str(obj.token);
        const sessions = readSessions();
        const current = validSessions()[0];
        const target = token ? sessions.find((s) => s.token === token) : current;
        if (target) writeSessions(sessions.filter((s) => s.id !== target.id));
        push(userBySession({}));
        return null;
      },
    },
    {
      kind: "bridge",
      id: "auth.status",
      description: "current user or null (authStatus() → withPlan(user|null); renderer uses it as `account` directly)",
      handler: (params) => publicUserOrNull(userBySession(params)),
    },
    {
      kind: "bridge",
      id: "auth.localUser",
      description: "user read straight from the session store (authLocalUser(requireReadable) → user|null)",
      handler: () => publicUserOrNull(userBySession({})),
    },
    {
      kind: "bridge",
      id: "auth.validate",
      description:
        "session validation (authValidate() → {status:'valid'|'invalid'|'unreachable', user}; local store never goes unreachable unless unreadable)",
      handler: (params) => {
        try {
          const user = userBySession(params);
          return user ? { status: "valid", user: publicUser(user) } : { status: "invalid", user: null };
        } catch {
          return { status: "unreachable", user: null };
        }
      },
    },
    {
      kind: "bridge",
      id: "auth.resetPassword",
      description:
        "two-phase reset (edge: resetPassword(email) → link sent; autumn local-first: phase 1 {email} issues + RETURNS a code (no SMTP), phase 2 {email, code, password} rotates the password and starts a session)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        const email = str(obj.email) ?? str(pos[0]);
        if (!email) return { ok: false, message: "email required" };
        return { ok: true };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const email = str(obj.email) ?? str(pos[0]);
        if (!email || !EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
        const code = str(obj.code) ?? str(pos[1]);
        const password = str(obj.password) ?? str(pos[2]);

        if (!code || !password) {
          // Phase 1 — issue a reset code. Local delivery: returned to the caller
          // AND persisted hashed for phase 2 (there is no mail server).
          const user = findUserByEmail(email);
          if (!user) throw new Error("No account for that email address.");
          const raw = randomBytes(4).toString("hex").toUpperCase();
          const shown = `${raw.slice(0, 4)}-${raw.slice(4)}`;
          const { hash, salt } = hashPassword(shown);
          const pending: PendingReset = { email, hash, salt, expiresAt: now() + RESET_TTL_MS };
          saveJson(resetsFile(), [...loadJson<PendingReset[]>(resetsFile(), []).filter((r) => r.email !== email), pending]);
          return { delivered: "local", code: shown, expiresAt: pending.expiresAt };
        }

        // Phase 2 — verify the code (against recovery codes OR the pending reset), rotate.
        if (password.length < MIN_PASSWORD) throw new Error(`Password should be at least ${MIN_PASSWORD} characters.`);
        const user = findUserByEmail(email);
        if (!user) throw new Error("No account for that email address.");
        const resets = loadJson<PendingReset[]>(resetsFile(), []);
        const pending = resets.find((r) => r.email.toLowerCase() === email.toLowerCase() && r.expiresAt > now());
        const fromPending = pending && safeEqualHex(hashPassword(code, pending.salt).hash, pending.hash);
        const fromRecovery = user.recoveryHashes.some((r) => !r.usedAt && safeEqualHex(hashPassword(code, r.salt).hash, r.hash));
        if (!fromPending && !fromRecovery) throw new Error("Invalid or expired reset code.");

        const { hash, salt } = hashPassword(password);
        const users = readUsers();
        const i = users.findIndex((u) => u.id === user.id);
        const rotated: AuthUser = {
          ...users[i],
          passHash: hash,
          salt,
          recoveryHashes: users[i].recoveryHashes.map((r) => {
            const used = safeEqualHex(hashPassword(code, r.salt).hash, r.hash);
            return used ? { ...r, usedAt: now() } : r;
          }),
        };
        users[i] = rotated;
        saveJson(usersFile(), users);
        saveJson(resetsFile(), resets.filter((r) => !(r.email.toLowerCase() === email.toLowerCase())));
        writeSessions(readSessions().filter((s) => s.userId !== user.id));
        return { user: signInAs(rotated), delivered: "local" };
      },
    },
    {
      kind: "bridge",
      id: "auth.resendConfirmation",
      description:
        "re-issue confirmation (resendConfirmation(email) → Supabase resend; autumn: honest local-first — accounts confirm at sign-up, no SMTP)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        if (!(str(obj.email) ?? str(pos[0]))) return { ok: false, message: "email required" };
        return { ok: true };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const email = str(obj.email) ?? str(pos[0]);
        if (!email || !EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
        return { delivered: "local", note: "autumn is local-first: accounts are confirmed at sign-up — no email service" };
      },
    },
    {
      kind: "bridge",
      id: "auth.forgetSavedSignIn",
      description:
        "forget the saved sign-in (authForgetSavedSignIn — clears session storage + verifier + local sign-out); emits onChanged(null)",
      handler: () => {
        writeSessions([]);
        saveJson(resetsFile(), []);
        push(null);
        return null;
      },
    },
    {
      kind: "bridge",
      id: "auth.networkRestored",
      description:
        "network probe after connectivity returns (authNetworkRestored() — net.isOnline + cloud retry side effects, void; autumn returns {online} from a real 3s probe)",
      handler: async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch("https://github.com", { method: "HEAD", signal: ctrl.signal }).catch(() => null);
          clearTimeout(t);
          return { online: res ? res.ok || res.status > 0 : false };
        } catch {
          return { online: false };
        }
      },
    },
    {
      kind: "bridge",
      id: "auth.signInWithOAuth",
      description:
        "OAuth sign-in (authSignInWithOAuth(provider, attemptId) — full loopback flow, resolves to the user). autumn: real GitHub flow ONLY when GITHUB_CLIENT_ID/SECRET are set, else {supported:false}",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        const provider = str(obj.provider) ?? str(pos[0]);
        if (!provider) return { ok: false, message: "provider required" };
        return { ok: true };
      },
      handler: async (params) => {
        const { pos, obj } = paramsOf(params);
        const provider = str(obj.provider) ?? str(pos[0]);
        const attemptId = str(obj.attemptId) ?? str(pos[1]) ?? randomUUID();
        if (provider !== "github") return { supported: false, reason: `${provider ?? "provider"} OAuth is not configured for autumn` };
        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        if (!clientId || !clientSecret) return { supported: false, reason: "GitHub OAuth not configured" };
        return runGithubOAuth({ attemptId, clientId, clientSecret, emit: push, deps });
      },
    },
    {
      kind: "bridge",
      id: "auth.oauthAction",
      description:
        "act on a pending OAuth attempt (oauthAction(attemptId, 'cancel'|'copy-link'); throws 'Invalid sign-in action.' otherwise)",
      schema: (p) => {
        const { pos, obj } = paramsOf(p);
        const attemptId = str(obj.attemptId) ?? str(pos[0]);
        const action = str(obj.action) ?? str(pos[1]);
        if (!attemptId || !action) return { ok: false, message: "attemptId and action required" };
        if (action !== "cancel" && action !== "copy-link") return { ok: false, message: "Invalid sign-in action." };
        return { ok: true };
      },
      handler: (params) => {
        const { pos, obj } = paramsOf(params);
        const attemptId = str(obj.attemptId) ?? str(pos[0]);
        const action = str(obj.action) ?? str(pos[1]);
        if (!attemptId || (action !== "cancel" && action !== "copy-link")) throw new Error("Invalid sign-in action.");
        if (!pendingOAuth || pendingOAuth.id !== attemptId) throw new Error("This sign-in attempt is no longer waiting. Try again.");
        if (action === "copy-link") {
          if (!pendingOAuth.url) throw new Error("The sign-in link is not ready yet. Try again in a moment.");
          deps.clipboard.writeText(pendingOAuth.url);
          return null;
        }
        if (pendingOAuth.exchanging) throw new Error("Sign-in is still completing — wait a moment.");
        pendingOAuth.cancelled = true;
        pendingOAuth.server?.close();
        pendingOAuth = null;
        return null;
      },
    },
  ];

  return handlers;
}

function publicUserOrNull(u: AuthUser | null): User | null {
  return u ? publicUser(u) : null;
}

// ---------------------------------------------------------------------------
// Real GitHub OAuth (env-gated): loopback server + code exchange. Only ever
// runs when GITHUB_CLIENT_ID/SECRET are set; never faked otherwise.
// ---------------------------------------------------------------------------

async function runGithubOAuth(opts: {
  attemptId: string;
  clientId: string;
  clientSecret: string;
  emit: (u: User | null) => void;
  deps: W1Deps;
}): Promise<User | { supported: false; reason: string }> {
  const { createServer } = await import("node:http");
  const { attemptId, clientId, clientSecret, emit, deps } = opts;
  const PORT = 54547; // same loopback port family the target uses (GH_PORT)
  const redirect = `http://127.0.0.1:${PORT}/callback`;

  const url =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(attemptId)}`;

  const attempt: OAuthAttempt = { id: attemptId, url };
  pendingOAuth = attempt;

  const user = await new Promise<User>((resolve, reject) => {
    const finish = (fn: () => void) => {
      try {
        attempt.server?.close();
      } catch {
        /* already closed */
      }
      if (pendingOAuth?.id === attemptId) pendingOAuth = null;
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("GitHub sign-in timed out."))), 300_000); // GH_TIMEOUT_MS

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      if (!code || state !== attemptId) {
        res.writeHead(400, { "content-type": "text/plain" }).end(" autumn: invalid OAuth callback.");
        finish(() => {
          clearTimeout(timer);
          reject(new Error("GitHub sign-in returned an invalid callback."));
        });
        return;
      }
      attempt.exchanging = true;
      res.writeHead(200, { "content-type": "text/plain" }).end(" autumn: sign-in complete — you can close this tab.");
      void (async () => {
        try {
          const tokRes = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
          });
          const tok = (await tokRes.json()) as { access_token?: string };
          if (!tok.access_token) throw new Error("GitHub token exchange failed.");
          const meRes = await fetch("https://api.github.com/user", {
            headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json" },
          });
          const me = (await meRes.json()) as { id?: number; login?: string; email?: string | null; name?: string | null };
          if (!me.login) throw new Error("GitHub user lookup failed.");
          finish(() => {
            clearTimeout(timer);
            resolve(githubUser(me, deps, emit));
          });
        } catch (e) {
          finish(() => {
            clearTimeout(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
          });
        }
      })();
    });

    server.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (pendingOAuth?.id === attemptId) pendingOAuth = null;
      reject(new Error(e.code === "EADDRINUSE" ? `OAuth callback port ${PORT} is busy — close the other app and retry.` : String(e.message)));
    });
    server.listen(PORT, "127.0.0.1", () => {
      attempt.server = server;
      void deps.shell.openExternal(url).catch(() => undefined);
    });
  });

  return user;
}

/** Link (or create) a local account from GitHub identity, then start a session. */
function githubUser(me: { id?: number; login?: string; email?: string | null; name?: string | null }, deps: W1Deps, emit: (u: User | null) => void): User {
  const users = loadJson<AuthUser[]>(dbPath("auth-users.json"), []);
  const providerId = String(me.id ?? me.login ?? "");
  const email = (me.email ?? `${me.login ?? providerId}@github.local`).toLowerCase();
  let user = users.find((u) => u.provider === "github" && u.providerId === providerId);
  if (!user) {
    user = {
      id: randomUUID(),
      email,
      ...(me.name ? { name: me.name } : {}),
      passHash: "",
      salt: "",
      provider: "github",
      providerId,
      recoveryHashes: [],
      createdAt: deps.now(),
    };
    users.push(user);
    saveJson(dbPath("auth-users.json"), users);
  }
  user.lastSignInAt = deps.now();
  const i = users.findIndex((u) => u.id === user!.id);
  users[i] = user;
  saveJson(dbPath("auth-users.json"), users);
  const now = deps.now();
  const session = {
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    userId: user.id,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  };
  const all = loadJson<ReturnType<typeof readSessions>>(dbPath("auth-sessions.json"), []);
  saveJson(dbPath("auth-sessions.json"), [session, ...all.filter((s) => s.expiresAt > now)]);
  const pub = publicUser(user);
  emit(pub);
  return pub;
}
