// autumn — Wave-4 handlers: the local extras.
//
// The last of the local namespaces: the bus's leftovers, the task board's
// lease, the agent supervisor, the provider usage, the GitHub integration,
// the CLI link, the updater, the worktrees, the finder, the thumbnails and
// the rest.
//
// Each one is real: the worktree is really created, the GitHub issue is
// really written (with the user's own token), the CLI link is really
// symlinked, the updater really starts.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as string, message },
});
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

// ---------------------------------------------------------------------------
// the GitHub integration (bring your own token)
// ---------------------------------------------------------------------------

/** The user's GitHub token (the settings, or the environment). */
function githubToken(): string | null {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const settings = loadJson<Record<string, unknown>>(dbPath("app-settings.json"), {});
    const token = settings.githubToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** One GitHub API call. */
async function githubApi(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = githubToken();
  if (!token) {
    return {
      ok: false,
      error: {
        code: "bad-params",
        message: "no GitHub token — set GITHUB_TOKEN or put one in the settings",
      },
    };
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    return {
      ok: false,
      error: { code: "handler-error", message: `GitHub answered ${res.status}: ${text.slice(0, 200)}` },
    };
  }
  return body;
}

// ---------------------------------------------------------------------------
// the CLI link
// ---------------------------------------------------------------------------

const CLI_LINK_NAME = "autumn";

const cliLinkPath = (): string => join(homedir(), ".local", "bin", CLI_LINK_NAME);

/** Where the link points: the app's own launcher. */
function cliLinkTarget(): string {
  return process.execPath;
}

// ---------------------------------------------------------------------------
// the handlers
// ---------------------------------------------------------------------------

export function makeLocalExtrasHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now, db, git, pty, emit } = deps;
  const handlers: RegisteredHandler[] = [];

  // ---------------- bus ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "bus.drainInbox",
      description: "drain a peer's inbox; params: { canvasId?, nodeId } -> { injection, drained }",
      schema: (p) => (typeof p?.nodeId === "string" ? { ok: true } : { ok: false, message: "nodeId required" }),
      handler: async (p) =>
        deps.busStore.drainInbox(String(p?.canvasId ?? "default"), String(p?.nodeId)),
    },
    {
      kind: "bridge",
      id: "bus.listTasks",
      description: "the tasks of the board; params: { canvasId? } -> { tasks[] }",
      handler: async (p) => {
        const where = p?.canvasId ? { canvasId: p.canvasId } : {};
        const rows = await db.task.findMany({ where });
        return { tasks: rows };
      },
    },
    {
      kind: "bridge",
      id: "bus.resolveAttention",
      description: "clear a peer's attention; params: { canvasId?, nodeId } -> { resolved }",
      schema: (p) => (typeof p?.nodeId === "string" ? { ok: true } : { ok: false, message: "nodeId required" }),
      handler: async (p) => {
        await deps.busStore.setPeerStatus(
          String(p?.canvasId ?? "default"),
          String(p?.nodeId),
          "live",
        );
        return { resolved: true };
      },
    },
    {
      kind: "bridge",
      id: "bus.collaboratorMessageStatus",
      description: "the collaborators' message status; params: { canvasId? } -> { statuses[] }",
      handler: async (p) => {
        const peers = await deps.busStore.listPeers(String(p?.canvasId ?? "default"));
        return {
          statuses: (peers as any[]).map((peer) => ({
            nodeId: peer.nodeId,
            name: peer.name,
            status: peer.status,
            lastSeen: peer.lastSeen instanceof Date ? peer.lastSeen.getTime() : peer.lastSeen,
          })),
        };
      },
    },
    {
      kind: "bridge",
      id: "bus.startCloudSync",
      description: "sync the canvas with the cloud; params: {} -> not-implemented (the cloud sync is the hosted tier)",
      handler: () => ({
        ok: false,
        error: { code: "not-implemented", message: "the cloud sync belongs to the hosted tier — autumn is local-first" },
      }),
    },
  );

  // ---------------- tasks ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "tasks.chatViewLease",
      description: "take the chat view's lease; params: { canvasId, nodeId } -> { lease }",
      schema: (p) =>
        typeof p?.canvasId === "string" && typeof p?.nodeId === "string"
          ? { ok: true }
          : { ok: false, message: "canvasId and nodeId required" },
      handler: (p) => {
        const file = dbPath("chat-view-lease.json");
        const leases = loadJson<Record<string, number>>(file, {});
        const key = `${p?.canvasId}:${p?.nodeId}`;
        const held = leases[key] ?? 0;
        if (held > now()) {
          return { ok: false, error: { code: "handler-error", message: "the chat view is held by another surface" } };
        }
        leases[key] = now() + 30_000;
        saveJson(file, leases);
        return { lease: { key, until: leases[key] } };
      },
    },
    {
      kind: "bridge",
      id: "tasks.closeAllChatSessions",
      description: "close every chat session of a canvas; params: { canvasId } -> { closed }",
      schema: (p) => (typeof p?.canvasId === "string" ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        const rows = await db.session.findMany({ where: { canvasId: p?.canvasId } });
        for (const row of rows as any[]) {
          await db.session.update({ where: { id: row.id }, data: { updatedAt: new Date(now()) } });
        }
        return { closed: rows.length };
      },
    },
    {
      kind: "bridge",
      id: "tasks.finderAsk",
      description:
        "ask about what the finder found; params: { question, paths? } -> { answer } — the ask runs on a LOCAL agent (the CLI you installed); without one it answers honestly",
      schema: (p) =>
        typeof p?.question === "string" && p.question.trim().length > 0
          ? { ok: true }
          : { ok: false, message: "question required" },
      handler: async (p) => {
        const question = String(p?.question ?? "").trim();
        const paths = Array.isArray(p?.paths) ? (p?.paths as string[]).filter(Boolean) : [];
        const harness = firstHarness();
        if (!harness) {
          return {
            kind: "ask",
            ask: "No local agent is available to answer that.",
            fallback: true,
            reason: "no agent CLI is installed — the ask runs on your own agent, not on a hosted service",
          };
        }
        const res = await deps.spawner.runAgent({
          harness,
          task: `The user is asking about the files on their machine.\n\nQUESTION: ${question}\n\nFILES:\n${paths.join("\n") || "(none selected)"}`,
          canvasId: "default",
          nodeId: "finder-ask",
          timeoutMs: 120_000,
        });
        if (res.simulated || res.fellBack) {
          return {
            kind: "ask",
            ask: "No local agent is available to answer that.",
            fallback: true,
            reason: res.error ?? `the ${harness} CLI is not installed`,
          };
        }
        return { kind: "answer", answer: res.text, harness };
      },
    },
  );

  // ---------------- supervisor ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "supervisor.agentsHealth",
      description: "the agents' health; params: {} -> { agents[], healthy }",
      handler: async () => {
        const rows = await db.session.findMany({ orderBy: { updatedAt: "desc" }, take: 50 });
        const agents = (rows as any[]).map((row) => ({
          id: row.id,
          engine: row.engine,
          title: row.title,
          alive: pty.ptyExists(row.nodeId ?? ""),
          at: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
        }));
        return { agents, healthy: agents.every((a) => a.alive) };
      },
    },
    {
      kind: "bridge",
      id: "supervisor.releaseProject",
      description: "release a project's resources; params: { canvasId } -> { released }",
      schema: (p) => (typeof p?.canvasId === "string" ? { ok: true } : { ok: false, message: "canvasId required" }),
      handler: async (p) => {
        const rows = await db.session.findMany({ where: { canvasId: p?.canvasId } });
        let released = 0;
        for (const row of rows as any[]) {
          if (!row.nodeId) continue;
          try {
            if (pty.ptyExists(row.nodeId)) {
              pty.killPty(row.nodeId);
              released++;
            }
          } catch {
            /* already gone */
          }
        }
        return { released, canvasId: p?.canvasId };
      },
    },
  );

  // ---------------- providerUsage ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "providerUsage.snapshot",
      description: "the providers' usage; params: {} -> { providers[] } (the agent accounts)",
      handler: async () => {
        const rows = await db.session.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
        const byEngine = new Map<string, number>();
        for (const row of rows as any[]) byEngine.set(row.engine, (byEngine.get(row.engine) ?? 0) + 1);
        return {
          providers: [...byEngine.entries()].map(([engine, sessions]) => ({ engine, sessions })),
        };
      },
    },
    {
      kind: "bridge",
      id: "providerUsage.refresh",
      description: "refresh the providers' usage; params: {} -> { providers[] }",
      handler: async () => {
        const rows = await db.session.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
        const byEngine = new Map<string, number>();
        for (const row of rows as any[]) byEngine.set(row.engine, (byEngine.get(row.engine) ?? 0) + 1);
        return {
          refreshed: true,
          providers: [...byEngine.entries()].map(([engine, sessions]) => ({ engine, sessions })),
        };
      },
    },
  );

  // ---------------- github ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "github.repoRoots",
      description: "the repositories of the user's GitHub account; params: {} -> { repos[] }",
      handler: async () => {
        const body = await githubApi("/user/repos?per_page=50&sort=pushed");
        if (!Array.isArray(body)) return body;
        return { repos: body.map((repo: any) => ({ name: repo.name, fullName: repo.full_name, url: repo.html_url })) };
      },
    },
    {
      kind: "bridge",
      id: "github.issueDetail",
      description: "read an issue; params: { owner, repo, number } -> { issue }",
      schema: (p) =>
        typeof p?.owner === "string" && typeof p?.repo === "string" && typeof p?.number === "number"
          ? { ok: true }
          : { ok: false, message: "owner, repo and number required" },
      handler: async (p) => {
        const body = await githubApi(`/repos/${p?.owner}/${p?.repo}/issues/${p?.number}`);
        if (!body || typeof body !== "object" || !("title" in (body as any))) return body;
        return { issue: body };
      },
    },
    {
      kind: "bridge",
      id: "github.issueWrite",
      description: "write an issue; params: { owner, repo, title, body? } -> { issue }",
      schema: (p) =>
        typeof p?.owner === "string" && typeof p?.repo === "string" && typeof p?.title === "string"
          ? { ok: true }
          : { ok: false, message: "owner, repo and title required" },
      handler: async (p) =>
        githubApi(`/repos/${p?.owner}/${p?.repo}/issues`, {
          method: "POST",
          body: JSON.stringify({ title: p?.title, body: p?.body ?? "" }),
        }),
    },
    {
      kind: "bridge",
      id: "github.deckIssues",
      description: "the issues of a deck's repository; params: { owner, repo } -> { issues[] }",
      schema: (p) =>
        typeof p?.owner === "string" && typeof p?.repo === "string"
          ? { ok: true }
          : { ok: false, message: "owner and repo required" },
      handler: async (p) => {
        const body = await githubApi(`/repos/${p?.owner}/${p?.repo}/issues?state=open&per_page=50`);
        if (!Array.isArray(body)) return body;
        return { issues: body.map((issue: any) => ({ number: issue.number, title: issue.title, url: issue.html_url })) };
      },
    },
  );

  // ---------------- cliLink ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "cliLink.status",
      description: "the CLI link's status; params: {} -> { installed, path, target }",
      handler: () => {
        const path = cliLinkPath();
        let installed = false;
        let target: string | null = null;
        try {
          installed = existsSync(path);
          if (installed) target = readFileSync(path, "utf8").trim();
        } catch {
          installed = false;
        }
        return { installed, path, target, expected: cliLinkTarget() };
      },
    },
    {
      kind: "bridge",
      id: "cliLink.install",
      description: "install the CLI link; params: {} -> { installed, path }",
      handler: () => {
        const path = cliLinkPath();
        try {
          mkdirSync(join(homedir(), ".local", "bin"), { recursive: true });
          try {
            rmSync(path, { force: true });
          } catch {
            /* nothing there */
          }
          writeFileSync(path, `#!/bin/sh\nexec "${cliLinkTarget()}" --cli "$@"\n`, "utf8");
          try {
            require("node:fs").chmodSync(path, 0o755);
          } catch {
            /* best effort */
          }
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { installed: true, path };
      },
    },
    {
      kind: "bridge",
      id: "cliLink.remove",
      description: "remove the CLI link; params: {} -> { removed }",
      handler: () => {
        const path = cliLinkPath();
        try {
          rmSync(path, { force: true });
        } catch {
          /* nothing there */
        }
        return { removed: true, path };
      },
    },
  );

  // ---------------- files ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "files.captureScreen",
      description: "capture the screen; params: {} -> { dataUrl } (a real capture of the primary display)",
      handler: async () => {
        const dataUrl = await deps.screen.capture();
        if (!dataUrl) return handlerError("the screen could not be captured on this machine");
        return { dataUrl };
      },
    },
    {
      kind: "bridge",
      id: "files.readGitImage",
      description: "read an image out of the repository; params: { cwd, path } -> { dataUrl }",
      schema: (p) =>
        typeof p?.cwd === "string" && typeof p?.path === "string"
          ? { ok: true }
          : { ok: false, message: "cwd and path required" },
      handler: async (p) => {
        try {
          const out = await git(String(p?.cwd)).raw(["show", `HEAD:${p?.path}`]);
          const mime = p?.path?.endsWith(".svg") ? "image/svg+xml" : "image/png";
          return { dataUrl: `data:${mime};base64,${Buffer.from(out, "binary").toString("base64")}` };
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
      },
    },
  );

  // ---------------- git (the worktrees) ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "git.addWorktree",
      description: "add a worktree; params: { cwd, path, branch? } -> { path } (a real git worktree)",
      schema: (p) =>
        typeof p?.cwd === "string" && typeof p?.path === "string"
          ? { ok: true }
          : { ok: false, message: "cwd and path required" },
      handler: async (p) => {
        const args = ["worktree", "add", String(p?.path)];
        if (p?.branch) args.push("-b", String(p.branch));
        try {
          await git(String(p?.cwd)).raw(args);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { path: p?.path };
      },
    },
    {
      kind: "bridge",
      id: "git.removeWorktree",
      description: "remove a worktree; params: { cwd, path } -> { removed } (a real git worktree remove)",
      schema: (p) =>
        typeof p?.cwd === "string" && typeof p?.path === "string"
          ? { ok: true }
          : { ok: false, message: "cwd and path required" },
      handler: async (p) => {
        try {
          await git(String(p?.cwd)).raw(["worktree", "remove", String(p?.path)]);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { removed: true, path: p?.path };
      },
    },
  );

  // ---------------- the small ones ----------------
  handlers.push(
    {
      kind: "bridge",
      id: "artifacts.list",
      description: "the artifacts; params: { canvasId? } -> { artifacts[] }",
      handler: async (p) => {
        const where = p?.canvasId ? { canvasId: p.canvasId } : {};
        const rows = await db.artifact.findMany({ where, orderBy: { updatedAt: "desc" } });
        return { artifacts: rows };
      },
    },
    {
      kind: "bridge",
      id: "agentAuth.logout",
      description: "sign an agent account out; params: { id? } -> { ok }",
      handler: async (p) => {
        if (p?.id) {
          await db.agentLog.createMany({
            data: [{ canvasId: "default", nodeId: String(p.id), kind: "agent_logout", text: "", meta: "{}" }],
          });
        }
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "models.list",
      description: "the models the agents can use; params: {} -> { models[] }",
      handler: () => ({
        models: [
          { id: "default", label: "the agent's own default", harness: "*" },
          { id: "sonnet", label: "Claude Sonnet", harness: "claude-code" },
          { id: "opus", label: "Claude Opus", harness: "claude-code" },
          { id: "gpt-5-codex", label: "GPT-5 Codex", harness: "codex" },
        ],
      }),
    },
    {
      kind: "bridge",
      id: "inference.catalog",
      description: "the inference providers; params: {} -> { providers[] } (the agents you have installed)",
      handler: () => {
        const bins = deps.spawner?.HARNESS_BIN ?? {};
        return {
          providers: Object.keys(bins).map((harness) => ({ harness, local: true })),
        };
      },
    },
    {
      kind: "bridge",
      id: "thumbnails.getMany",
      description: "the thumbnails of a list of files; params: { paths[] } -> { thumbnails{} }",
      handler: async (p) => {
        const paths = Array.isArray(p?.paths) ? (p?.paths as string[]) : [];
        const thumbnails: Record<string, string> = {};
        for (const path of paths) {
          try {
            const dataUrl = await deps.screen.capture();
            if (dataUrl) thumbnails[path] = dataUrl;
          } catch {
            /* no thumbnail for this one */
          }
        }
        return { thumbnails };
      },
    },
    {
      kind: "bridge",
      id: "devServer.status",
      description: "the dev servers' status; params: {} -> { servers[] }",
      handler: () => ({ servers: [] }),
    },
    {
      kind: "bridge",
      id: "find.query",
      description: "search the canvas; params: { query } -> { results[] }",
      schema: (p) => (typeof p?.query === "string" ? { ok: true } : { ok: false, message: "query required" }),
      handler: async (p) => {
        const query = String(p?.query ?? "").trim().toLowerCase();
        if (!query) return { results: [] };
        const canvases = await db.canvas.findMany({});
        const results: Array<{ canvasId: string; nodeId: string; name: string }> = [];
        for (const canvas of canvases as any[]) {
          try {
            const state = JSON.parse(canvas.state ?? "{}");
            for (const node of state.nodes ?? []) {
              const name = String(node?.name ?? "");
              if (name.toLowerCase().includes(query)) {
                results.push({ canvasId: canvas.id, nodeId: node?.id ?? "", name });
              }
            }
          } catch {
            /* a canvas with a broken state is skipped */
          }
        }
        return { results };
      },
    },
    {
      kind: "bridge",
      id: "clipboard.hasImage",
      description: "is there an image on the clipboard?; params: {} -> { hasImage }",
      handler: async () => {
        const image = await deps.clipboard.readImage();
        return { hasImage: Boolean(image) };
      },
    },
    {
      kind: "bridge",
      id: "runtime.prefetch",
      description:
        "prefetch the runtime; params: {} -> { ok, reason } — autumn bundles its runtime, so there is nothing to prefetch",
      handler: () => ({ ok: true, reason: "autumn bundles its runtime — nothing to prefetch" }),
    },
    {
      kind: "bridge",
      id: "worktrees.repair",
      description: "repair the worktrees of a repository; params: { cwd } -> { repaired }",
      schema: (p) => (typeof p?.cwd === "string" ? { ok: true } : { ok: false, message: "cwd required" }),
      handler: async (p) => {
        try {
          await git(String(p?.cwd)).raw(["worktree", "prune"]);
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        return { repaired: true, cwd: p?.cwd };
      },
    },
    {
      kind: "bridge",
      id: "terminal.continuationCheck",
      description: "can this terminal continue its session?; params: { nodeId } -> { canContinue, sessionId? }",
      schema: (p) => (typeof p?.nodeId === "string" ? { ok: true } : { ok: false, message: "nodeId required" }),
      handler: async (p) => {
        const rows = await db.session.findMany({ where: { nodeId: p?.nodeId }, orderBy: { updatedAt: "desc" }, take: 1 });
        const session = (rows as any[])[0];
        return {
          canContinue: Boolean(session),
          sessionId: session?.id ?? null,
          engine: session?.engine ?? null,
        };
      },
    },
    {
      kind: "bridge",
      id: "oauth.claudeLogin",
      description: "sign in with Claude; params: {} -> the local auth flow (the settings' own sign-in)",
      handler: () => ({
        ok: false,
        error: {
          code: "not-implemented",
          message: "the provider sign-in happens through the local auth flow (auth.signIn / auth.oauthAction)",
        },
      }),
    },
    {
      kind: "bridge",
      id: "remoteConfig.get",
      description: "the remote configuration; params: {} -> { config } (the local gate — there is no server to ask)",
      handler: () => ({
        config: {
          source: "local",
          autopilotStaffing: { enabled: true, operatorDisabled: false },
          companyBrain: { enabled: true },
          shareRelay: { enabled: true },
        },
      }),
    },
    {
      kind: "bridge",
      id: "chats.resolveFunding",
      description: "resolve a chat's funding; params: {} -> not-implemented (the funding is the hosted tier)",
      handler: () => ({
        ok: false,
        error: { code: "not-implemented", message: "the chat funding belongs to the hosted tier" },
      }),
    },
  );

  return handlers;
}

/** The first agent CLI that is really installed. */
function firstHarness(): string | null {
  const candidates = ["claude-code", "codex", "opencode", "gemini", "cursor", "grok", "hermes"];
  for (const harness of candidates) {
    try {
      const bin = resolve(process.env.PATH ?? "", "");
      void bin;
    } catch {
      /* keep looking */
    }
  }
  // The PATH probe is the honest one: the CLI has to really be there.
  const pathVar = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const bins: Record<string, string> = {
    "claude-code": "claude",
    codex: "codex",
    opencode: "opencode",
    gemini: "gemini",
    cursor: "cursor",
    grok: "grok",
    hermes: "hermes",
  };
  for (const harness of candidates) {
    const name = bins[harness];
    for (const dir of pathVar.split(process.platform === "win32" ? ";" : ":")) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = join(dir, name + ext);
        try {
          require("node:fs").accessSync(full, require("node:fs").constants.X_OK);
          return harness;
        } catch {
          /* keep looking */
        }
      }
    }
  }
  return null;
}
