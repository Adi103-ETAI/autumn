// autumn — Wave-1 handlers: git (10) + worktrees (9) = 19 renderer-used ids
// (docs/architecture/backend.md).
//
// Backing is REAL git via the injected `deps.git(cwd)` (simple-git bound to a
// base dir) plus raw `git worktree` porcelain commands through `git.raw(...)`.
// `git.autoLand` is the auto-merge automation — autumn has no
// equivalent, so it is an honest not-implemented envelope (docs/architecture/backend.md), never a
// fabricated success. Registered by index.ts; do not edit shared files
// (w1-deps.ts, index.ts, handlers.ts, registry, manifest). Contract: every id
// must exist in electron/ipc/manifest.json bridge namespaces. Envelope rules:
// plain payload on success (registry wraps {ok:true,result}), or deliberate
// { ok:false, error } envelopes — bad-params (validation), not-found (not a
// repo / missing worktree / no origin remote), handler-error (git failure).
//
// Param convention: every id takes `cwd` — the absolute path of the repo to
// operate on (worktrees ids may instead/also take the worktree `path`,
// documented per handler). Not-a-repo for an existing absolute `cwd` is
// reported as not-found; absolute-path violations are bad-params.

import { basename, dirname, isAbsolute, join } from "node:path";

import type { SimpleGit } from "simple-git";
import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

/** Deliberate bad-input envelope (docs/architecture/backend.md). */
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});

/** Validate the mandatory `cwd` (absolute path of the repo). */
const validCwd = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && isAbsolute(v) && !v.includes("\0");

/** Wrap any git failure in an honest handler-error envelope (docs/architecture/backend.md). */
const gitCall = async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
};

const errMessage = (r: { ok: false; message: string }) => r.message.split("\n")[0].slice(0, 300);

/** Resolve the git toplevel of `cwd`, or null on failure. */
async function toplevel(gitBound: (cwd: string) => SimpleGit, cwd: string): Promise<string | null> {
  const res = await gitCall(() => gitBound(cwd).raw(["rev-parse", "--show-toplevel"]));
  if (!res.ok) return null;
  const out = String(res.value ?? "").trim();
  return out.length > 0 ? out : null;
}

/** Parse `git worktree list --porcelain` into structured entries (real parse). */
function parseWorktreePorcelain(out: string) {
  const items: Array<{ path: string; head: string; branch: string | null; bare: boolean; detached: boolean; prunable: boolean }> = [];
  let cur: { path?: string; head?: string; branch?: string | null; bare?: boolean; detached?: boolean; prunable?: boolean } = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur.path) items.push(cur as never);
      cur = { path: line.slice(9).trim() };
    } else if (line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "").trim();
    else if (line === "branch" || line.startsWith("branch ")) cur.branch = cur.branch ?? null;
    else if (line === "bare") cur.bare = true;
    else if (line === "detached") cur.detached = true;
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  if (cur.path) items.push(cur as never);
  return items.map((i) => ({
    path: i.path!,
    head: i.head ?? "",
    branch: i.branch ?? null,
    bare: i.bare === true,
    detached: i.detached === true,
    prunable: i.prunable === true,
  }));
}

export function makeGitHandlers(deps: W1Deps): RegisteredHandler[] {
  const { git, shell } = deps;

  /** Shared repo probe: absolute cwd + actually a git repository. */
  const repoOr = async (
    p: Record<string, any>,
  ): Promise<{ ok: true; cwd: string } | { ok: false; envelope: any }> => {
    if (!validCwd(p?.cwd)) {
      return { ok: false, envelope: badParams("cwd required (absolute path)") };
    }
    const r = await gitCall(() => git(p.cwd).checkIsRepo());
    if (!r.ok || r.value !== true) {
      return { ok: false, envelope: notFound(`not a git repository: ${p.cwd}`) };
    }
    return { ok: true, cwd: p.cwd };
  };

  /** Resolve "owner/repo" + branch info from the origin remote (best effort). */
  const remoteInfo = async (cwd: string) => {
    const r = await gitCall(() => git(cwd).remote(["get-url", "origin"]));
    if (!r.ok) return null;
    const url = String(r.value ?? "").trim();
    const m =
      url.match(/^(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/) ??
      url.match(/^(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/([^/\s]+)$/);
    if (!m) return url ? { host: "unknown", owner: "", repo: "", url } : null;
    return { host: m[1], owner: m[2], repo: m[3], url };
  };

  const handlers: RegisteredHandler[] = [
    // ---------------- git ----------------
    {
      kind: "bridge",
      id: "git.status",
      description:
        'full working-tree status; params: { cwd: absolute repo path } -> { current, tracking, ahead, behind, isClean, created[], deleted[], modified[], renamed[], staged[], conflicted[] }',
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const g = git(r.cwd);
        const s = await gitCall(() => g.status());
        if (!s.ok) return handlerError(errMessage(s));
        const v = s.value;
        return {
          current: v.current,
          tracking: v.tracking,
          ahead: v.ahead,
          behind: v.behind,
          isClean: v.isClean(),
          created: v.created,
          deleted: v.deleted,
          modified: v.modified,
          renamed: v.renamed.map((x) => x.to ?? `${x.from}->${x.to}`),
          staged: v.staged,
          conflicted: v.conflicted,
        };
      },
    },
    {
      kind: "bridge",
      id: "git.changes",
      description:
        "working-tree change summary; params: { cwd } -> { files: [{path, index, working_dir}], staged: string[], unstaged: string[], insertions, deletions, changed }",
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const g = git(r.cwd);
        const s = await gitCall(() => g.status());
        if (!s.ok) return handlerError(errMessage(s));
        const d = await gitCall(() => g.diffSummary(["HEAD"]));
        const v = s.value;
        const files = v.files.map((f) => ({ path: f.path, index: f.index, working_dir: f.working_dir }));
        return {
          files,
          staged: v.staged,
          unstaged: [...new Set([...v.modified, ...v.created, ...v.deleted])],
          insertions: d.ok ? d.value.insertions : 0,
          deletions: d.ok ? d.value.deletions : 0,
          changed: files.length,
        };
      },
    },
    {
      kind: "bridge",
      id: "git.taskChanges",
      description:
        "changes attributed to a task (working tree vs HEAD); params: { cwd, task?: string|number } -> { task, files, insertions, deletions, changed }",
      schema: (p) =>
        validCwd(p?.cwd) &&
        (p?.task === undefined || typeof p.task === "string" || typeof p.task === "number")
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute path); task, if given, a string|number" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const g = git(r.cwd);
        const d = await gitCall(() => g.diffSummary(["HEAD"]));
        const files = d.ok ? d.value.files.map((f) => f.file) : [];
        return {
          task: p.task ?? null,
          files,
          insertions: d.ok ? d.value.insertions : 0,
          deletions: d.ok ? d.value.deletions : 0,
          changed: files.length,
        };
      },
    },
    {
      kind: "bridge",
      id: "git.stage",
      description:
        "stage paths; params: { cwd, paths?: string[] } (missing/empty paths stages everything) -> { ok: true, staged: string[] | 'all' }",
      schema: (p) =>
        validCwd(p?.cwd) &&
        (p?.paths === undefined ||
          (Array.isArray(p.paths) && p.paths.every((x: unknown) => typeof x === "string" && x.length > 0)))
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute path); paths, if given, a non-empty string array" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const paths: string[] | undefined = Array.isArray(p.paths) ? p.paths : undefined;
        const target = paths && paths.length > 0 ? paths : ["."];
        const res = await gitCall(() => git(r.cwd).add(target));
        if (!res.ok) return handlerError(errMessage(res));
        return { ok: true, staged: paths && paths.length > 0 ? paths : "all" };
      },
    },
    {
      kind: "bridge",
      id: "git.discard",
      description:
        "discard working-tree changes for paths; params: { cwd, paths: string[] } (non-empty) -> { ok: true } ; tracked staged deletions are restored from the index via checkout",
      schema: (p) =>
        validCwd(p?.cwd) && Array.isArray(p?.paths) && p.paths.length > 0 && p.paths.every((x: unknown) => typeof x === "string" && x.length > 0)
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and a non-empty paths array are required" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const paths = p.paths as string[];
        // git restore --source=HEAD --staged --worktree -- <paths>: discards
        // BOTH staged and unstaged changes (checkout -- alone restores from
        // the index and leaves staged content alone). Untracked files untouched.
        const res = await gitCall(() =>
          git(r.cwd).raw(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]));
        if (!res.ok) return handlerError(errMessage(res));
        return { ok: true };
      },
    },
    {
      kind: "bridge",
      id: "git.commitAll",
      description:
        "stage everything and commit; params: { cwd, message: non-empty string } -> { ok: true, commit, summary, branch } | handler-error when there is nothing to commit",
      schema: (p) =>
        validCwd(p?.cwd) && typeof p?.message === "string" && p.message.trim().length > 0
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and a non-empty message are required" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const g = git(r.cwd);
        const s = await gitCall(() => g.status());
        if (!s.ok) return handlerError(errMessage(s));
        if (s.value.isClean()) {
          // Nothing to commit: honest failure, NOT a fabricated empty commit.
          return handlerError("nothing to commit (working tree clean)");
        }
        const add = await gitCall(() => g.add(["."]));
        if (!add.ok) return handlerError(errMessage(add));
        const c = await gitCall(() => g.commit(String(p.message).slice(0, 2000)));
        if (!c.ok) return handlerError(errMessage(c));
        return {
          ok: true,
          commit: c.value.commit,
          summary: c.value.summary,
          branch: c.value.branch,
        };
      },
    },
    {
      kind: "bridge",
      id: "git.push",
      description:
        "push to a remote; params: { cwd, remote?: string, branch?: string } -> { ok: true, remote, branch } | handler-error on rejected/unreachable push",
      schema: (p) =>
        validCwd(p?.cwd) &&
        (p?.remote === undefined || typeof p.remote === "string") &&
        (p?.branch === undefined || typeof p.branch === "string")
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute); remote/branch must be strings when given" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const remote = (p.remote as string | undefined) ?? "origin";
        let branch = (p.branch as string | undefined) ?? undefined;
        if (!branch) {
          // push.default=simple pushes nothing without an upstream, so resolve
          // HEAD explicitly and set it upstream (-u) on the first push.
          const cur = await gitCall(() => git(r.cwd).revparse(["--abbrev-ref", "HEAD"]));
          if (!cur.ok) return handlerError(errMessage(cur));
          branch = String(cur.value).trim();
        }
        const res = await gitCall(() =>
          git(r.cwd).push(remote, branch, ["-u"]),
        );
        if (!res.ok) return handlerError(errMessage(res));
        return { ok: true, remote, branch: branch ?? res.value.branch ?? null };
      },
    },
    {
      kind: "bridge",
      id: "git.initializeEmpty",
      description:
        "initialise an empty git repository at cwd; params: { cwd: absolute path } -> { ok: true, initialized: true|false, already } (idempotent: an existing repo reports already:true, initialized:false)",
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: async (p) => {
        const cwd = p.cwd as string;
        if (!isAbsolute(cwd)) return badParams("cwd must be an absolute path");
        const existing = await gitCall(() => git(cwd).checkIsRepo());
        if (existing.ok && existing.value === true) {
          return { ok: true, initialized: false, already: true };
        }
        const res = await gitCall(() => git(cwd).init());
        if (!res.ok) return handlerError(errMessage(res));
        return { ok: true, initialized: true, already: false };
      },
    },
    {
      kind: "bridge",
      id: "git.openPr",
      description:
        "open the PR compare URL for the current branch in the browser; params: { cwd, base?: string, title?: string } -> { ok: true, url } | not-found when the repo has no usable origin remote",
      schema: (p) =>
        validCwd(p?.cwd) && (p?.base === undefined || typeof p.base === "string")
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute); base must be a string when given" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const info = await remoteInfo(r.cwd);
        const branch = await gitCall(() => git(r.cwd).revparse(["--abbrev-ref", "HEAD"]));
        if (!branch.ok) return handlerError(errMessage(branch));
        const head = String(branch.value).trim();
        // GitHub compare URL: https://github.com/owner/repo/compare/base...head
        if (!info || !info.owner || info.host !== "github.com") {
          // Not a GitHub origin (or none): the honest, actually-useful thing is
          // a not-found with the reason, never a guessed URL that 404s.
          return notFound(
            info ? `origin remote is not a GitHub repository (${info.host ?? "unknown"})` : "no origin remote configured",
          );
        }
        const base = (p.base as string | undefined) ?? "main";
        const url = `https://github.com/${info.owner}/${info.repo}/compare/${base}...${encodeURIComponent(head)}`;
        try {
          await shell.openExternal(url);
        } catch (e) {
          return handlerError(`failed to open ${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return { ok: true, url, head, base };
      },
    },
    {
      kind: "bridge",
      id: "git.prFacts",
      description:
        "PR facts for the current branch (no network); params: { cwd, base?: string } -> { owner, repo, host, head, base, compareUrl, github: true|false } | { supported:false } when there is no origin remote",
      schema: (p) =>
        validCwd(p?.cwd) && (p?.base === undefined || typeof p.base === "string")
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute); base must be a string when given" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const info = await remoteInfo(r.cwd);
        const branch = await gitCall(() => git(r.cwd).revparse(["--abbrev-ref", "HEAD"]));
        if (!branch.ok) return handlerError(errMessage(branch));
        const head = String(branch.value).trim();
        if (!info) {
          // No remote at all: a well-formed "no facts" result, not an error (docs/architecture/backend.md).
          return { supported: false, reason: "no origin remote configured", head, base: (p.base as string | undefined) ?? "main" };
        }
        const base = (p.base as string | undefined) ?? "main";
        const github = info.host === "github.com" && !!info.owner && !!info.repo;
        return {
          supported: true,
          owner: info.owner || null,
          repo: info.repo || null,
          host: info.host,
          head,
          base,
          compareUrl: github ? `https://github.com/${info.owner}/${info.repo}/compare/${base}...${encodeURIComponent(head)}` : null,
          github,
        };
      },
    },

    // ---------------- worktrees ----------------
    {
      kind: "bridge",
      id: "worktrees.list",
      description:
        "list worktrees (porcelain parse); params: { cwd } -> { items: [{ path, head, branch|null, bare, detached, prunable }] }",
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const res = await gitCall(() => git(r.cwd).raw(["worktree", "list", "--porcelain"]));
        if (!res.ok) return handlerError(errMessage(res));
        return { items: parseWorktreePorcelain(String(res.value ?? "")) };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.prepare",
      description:
        "create a worktree; params: { cwd, path: absolute, ref?: string (default HEAD) } -> { ok: true, path, ref } | bad-params (relative path) / handler-error (git rejected)",
      schema: (p) =>
        validCwd(p?.cwd) && typeof p?.path === "string" && isAbsolute(p.path) && !p.path.includes("\0") &&
        (p?.ref === undefined || (typeof p.ref === "string" && p.ref.length > 0))
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and an absolute path are required; ref must be a non-empty string when given" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const path = p.path as string;
        const ref = (p.ref as string | undefined) ?? "HEAD";
        const res = await gitCall(() => git(r.cwd).raw(["worktree", "add", path, ref]));
        if (!res.ok) return handlerError(errMessage(res));
        return { ok: true, path, ref };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.resolve",
      description:
        "resolve which worktree contains cwd; params: { cwd } -> { inWorktree: true, path, branch, head } | { inWorktree: false }",
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const res = await gitCall(() => git(r.cwd).raw(["worktree", "list", "--porcelain"]));
        if (!res.ok) return handlerError(errMessage(res));
        const items = parseWorktreePorcelain(String(res.value ?? ""));
        const target = (p.cwd as string).replace(/\/+$/, "");
        const match = items
          .slice()
          .sort((a, b) => b.path.length - a.path.length)
          .find((i) => target === i.path || target.startsWith(i.path + "/"));
        if (!match) return { inWorktree: false };
        return { inWorktree: true, path: match.path, branch: match.branch, head: match.head };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.derive",
      description:
        "derive the conventional worktree path for a name; params: { cwd, name: non-empty string } -> { path, name } (pure derivation — nothing is created); name must be slug-safe",
      schema: (p) =>
        validCwd(p?.cwd) && typeof p?.name === "string" && p.name.length > 0 && p.name.length <= 80 && !/[\\/:*?"<>|\0]/.test(p.name)
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and a file-safe name (max 80 chars, no path separators) are required" },
      handler: async (p) => {
        if (!validCwd(p?.cwd) || typeof p?.name !== "string" || p.name.length === 0 || /[\\/:*?"<>|\0]/.test(p.name)) {
          return badParams("cwd (absolute) and a file-safe name are required");
        }
        const cwd = p.cwd as string;
        const name = p.name.trim();
        // <parent>/<repo>-<name> — the same layout the target uses for derived forks.
        const path = join(dirname(cwd), `${basename(cwd)}-${name}`);
        return { path, name };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.preview",
      description:
        "preview a worktree's state; params: { cwd, path? (defaults to resolved worktree for cwd) } -> { path, branch, head, dirty, changed }",
      schema: (p) =>
        validCwd(p?.cwd) && (p?.path === undefined || (typeof p.path === "string" && isAbsolute(p.path)))
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute); path, if given, must be absolute" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const path = (p.path as string | undefined) ?? await toplevel(git, r.cwd);
        if (!path) return handlerError("could not resolve worktree path");
        const st = await gitCall(() => git(path).status());
        if (!st.ok) return notFound(`not a worktree: ${path}`);
        return {
          path,
          branch: st.value.current,
          head: st.value.tracking ?? null,
          dirty: !st.value.isClean(),
          changed: st.value.files.length,
        };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.matchFolder",
      description:
        "match a folder to a worktree; params: { cwd, folder: absolute } -> { match: true, path, branch, head } | { match: false }",
      schema: (p) =>
        validCwd(p?.cwd) && typeof p?.folder === "string" && isAbsolute(p.folder) && !p.folder.includes("\0")
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and an absolute folder path are required" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const folder = (p.folder as string).replace(/\/+$/, "");
        const res = await gitCall(() => git(r.cwd).raw(["worktree", "list", "--porcelain"]));
        if (!res.ok) return handlerError(errMessage(res));
        const items = parseWorktreePorcelain(String(res.value ?? ""));
        const match = items.find((i) => i.path === folder || folder.startsWith(i.path + "/"));
        if (!match) return { match: false };
        return { match: true, path: match.path, branch: match.branch, head: match.head };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.reconcileRemoval",
      description:
        "reconcile a removed worktree: drop it and prune; params: { cwd, path: absolute, force?: boolean } -> { ok: true, removed: true }",
      schema: (p) =>
        validCwd(p?.cwd) && typeof p?.path === "string" && isAbsolute(p.path) && (p?.force === undefined || typeof p.force === "boolean")
          ? { ok: true }
          : { ok: false, message: "cwd (absolute) and an absolute path are required; force must be boolean when given" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const path = p.path as string;
        const args = ["worktree", "remove"];
        if (p.force === true) args.push("--force");
        args.push(path);
        const res = await gitCall(() => git(r.cwd).raw(args));
        if (!res.ok) return handlerError(errMessage(res));
        await gitCall(() => git(r.cwd).raw(["worktree", "prune"])); // best-effort prune after removal
        return { ok: true, removed: true };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.drop",
      description:
        "drop a worktree (remove + prune); params: { cwd, path?: absolute (defaults to the toplevel of cwd) } -> { ok: true, removed: true, path }",
      schema: (p) =>
        validCwd(p?.cwd) && (p?.path === undefined || (typeof p.path === "string" && isAbsolute(p.path)))
          ? { ok: true }
          : { ok: false, message: "cwd required (absolute); path, if given, must be absolute" },
      handler: async (p) => {
        const r = await repoOr(p);
        if (!r.ok) return r.envelope;
        const path = (p.path as string | undefined) ?? await toplevel(git, r.cwd);
        if (!path) return handlerError("could not resolve worktree path");
        const res = await gitCall(() => git(r.cwd).raw(["worktree", "remove", "--force", path]));
        if (!res.ok) return handlerError(errMessage(res));
        await gitCall(() => git(r.cwd).raw(["worktree", "prune"]));
        return { ok: true, removed: true, path };
      },
    },
    {
      kind: "bridge",
      id: "worktrees.autoLand",
      description:
        "auto-land a worktree onto the base branch (target automation); params: { cwd } -> not-implemented envelope — autumn has no auto-land pipeline, so nothing is merged or pushed",
      schema: (p) => (validCwd(p?.cwd) ? { ok: true } : { ok: false, message: "cwd required (absolute path)" }),
      handler: (p) => {
        if (!validCwd(p?.cwd)) return badParams("cwd required (absolute path)");
        // The upstream app ships an auto-land automation that rebases/merges the
        // worktree and deletes it. Autumn deliberately does not implement that
        // pipeline (it needs a merge policy + CI gating) — a not-implemented
        // envelope, never a fabricated "landed" state.
        return {
          ok: false,
          error: {
            code: "not-implemented",
            message: "autoLand requires an auto-merge pipeline (rebase policy + CI gating), which autumn does not have — merge manually with git",
          },
        };
      },
    },
  ];

  return handlers;
}
