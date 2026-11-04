// Autumn — Git panel (Wave 1).
// Git status/stage/discard/commit/push for the current folder workspace, plus
// a dev-server start/stop wired to the main-process child process. Everything
// goes through the IPC facade (bridge.ts `api.git` / `api.devServer` / `api.git.*`)
// — the renderer never shells out to git directly. The dev-server pane also
// subscribes to `events.onDevServer` pushes so state transitions from the
// main process are reflected live.

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { api, subscribe, BridgeError } from "@/lib/autumn/bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GitBranch,
  RefreshCw,
  Play,
  Square,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type GitStatus = {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  modified: string[];
  created: string[];
  deleted: string[];
  renamed: string[];
  staged: string[];
  conflicted: string[];
};

/** Workspace folder path for the current canvas, if any. */
function useFolderCwd(): string {
  const canvasId = useAutumnStore((s) => s.canvasId);
  const workspaces = useAutumnStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.id === canvasId && w.kind === "folder");
  return ws?.source ?? "";
}

export function GitPanel() {
  const defaultCwd = useFolderCwd();
  const [cwd, setCwd] = useState(defaultCwd);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [devCmd, setDevCmd] = useState("npm run dev");
  const [devRunning, setDevRunning] = useState(false);
  const [devLogs, setDevLogs] = useState<string[]>([]);

  useEffect(() => {
    setCwd((prev) => (prev ? prev : defaultCwd));
  }, [defaultCwd]);

  const refresh = useCallback(async () => {
    const dir = cwd.trim();
    if (!dir) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.git.status({ cwd: dir }));
    } catch (e) {
      setStatus(null);
      setError(e instanceof BridgeError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live dev-server state transitions from the main process (push surface).
  useEffect(() => {
    const unsubscribe = subscribe<{ key: string; status: string; code?: number | null; message?: string }>(
      "events.onDevServer",
      (payload) => {
        const line =
          payload.status === "starting"
            ? `▶ ${payload.key} starting…`
            : payload.status === "exited"
              ? `■ ${payload.key} exited (code ${payload.code ?? "?"})`
              : `✖ ${payload.key} error: ${payload.message ?? "unknown"}`;
        setDevLogs((prev) => [...prev.slice(-49), line]);
        setDevRunning(payload.status === "starting");
      },
    );
    return unsubscribe;
  }, []);

  const guard = (e: unknown) =>
    toast.error(e instanceof BridgeError ? e.message : String(e));

  const onStage = async (paths?: string[]) => {
    try {
      await api.git.stage({ cwd: cwd.trim(), ...(paths ? { paths } : {}) });
      await refresh();
    } catch (e) {
      guard(e);
    }
  };

  const onDiscard = async (paths: string[]) => {
    try {
      await api.git.discard({ cwd: cwd.trim(), paths });
      await refresh();
    } catch (e) {
      guard(e);
    }
  };

  const onCommitAll = async () => {
    if (!commitMsg.trim()) {
      toast.error("Commit message required");
      return;
    }
    try {
      const res = await api.git.commitAll({ cwd: cwd.trim(), message: commitMsg.trim() });
      setCommitMsg("");
      toast.success(`Committed ${res.commit.slice(0, 7)} on ${res.branch}`);
      await refresh();
    } catch (e) {
      guard(e);
    }
  };

  const onInitRepo = async () => {
    try {
      const res = await api.git.initializeEmpty({ cwd: cwd.trim() });
      toast.success(res.already ? "Repository already initialized" : "Initialized empty repository");
      await refresh();
    } catch (e) {
      guard(e);
    }
  };

  const onPush = async () => {
    try {
      const res = await api.git.push({ cwd: cwd.trim() });
      toast.success(`Pushed to ${res.remote} (${res.branch ?? "default"})`);
    } catch (e) {
      guard(e);
    }
  };

  const onOpenPr = async () => {
    try {
      const res = await api.git.openPr({ cwd: cwd.trim() });
      toast.success(`Opening PR compare: ${res.url}`);
    } catch (e) {
      guard(e);
    }
  };

  const onStartDevServer = async () => {
    const parts = devCmd.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      toast.error("Enter a command (e.g. npm run dev)");
      return;
    }
    try {
      const res = await api.devServer.start({ cwd: cwd.trim(), command: parts[0], args: parts.slice(1) });
      setDevRunning(true);
      setDevLogs((prev) => [...prev, `▶ spawned ${res.key} (pid ${res.pid ?? "?"})`]);
    } catch (e) {
      guard(e);
    }
  };

  const onStopDevServer = async () => {
    try {
      await api.devServer.stop({ cwd: cwd.trim() });
      setDevRunning(false);
    } catch (e) {
      guard(e);
    }
  };

  const dirtyFiles = status
    ? [...new Set([...(status.created ?? []), ...(status.modified ?? []), ...(status.deleted ?? [])])]
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header: cwd + refresh */}
      <div className="p-3 border-b border-border/50 space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-amber-400" />
          <span className="text-xs font-medium">Git</span>
          {status?.current && (
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">{status.current}</Badge>
          )}
          {status?.ahead ? <Badge variant="outline" className="text-[9px] h-4 px-1.5">↑{status.ahead}</Badge> : null}
          {status?.behind ? <Badge variant="outline" className="text-[9px] h-4 px-1.5">↓{status.behind}</Badge> : null}
          <button
            onClick={() => void refresh()}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh status"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <FolderOpen className="size-3 text-muted-foreground shrink-0" />
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            onBlur={() => void refresh()}
            placeholder="/absolute/path/to/repo"
            className="h-7 text-[10px] font-mono"
            spellCheck={false}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {error && (
            <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-rose-300">
                <AlertCircle className="size-3" />
                <span className="font-medium">Git error</span>
              </div>
              <p className="text-[10px] text-rose-300/80 leading-snug break-words">{error}</p>
              {error.includes("not a git repository") && (
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void onInitRepo()}>
                  Initialize empty repository
                </Button>
              )}
            </div>
          )}

          {!error && status && (
            <>
              {/* Changes list */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {dirtyFiles.length === 0 ? "Clean tree" : `Changes (${dirtyFiles.length})`}
                  </span>
                  {dirtyFiles.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button
                        className="text-[9px] text-emerald-400 hover:text-emerald-300"
                        onClick={() => void onStage(dirtyFiles)}
                      >
                        Stage all
                      </button>
                      <span className="text-muted-foreground/40">·</span>
                      <button
                        className="text-[9px] text-rose-400 hover:text-rose-300"
                        onClick={() => void onDiscard(dirtyFiles)}
                      >
                        Discard all
                      </button>
                    </div>
                  )}
                </div>
                {dirtyFiles.length === 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80 py-1.5">
                    <CheckCircle2 className="size-3.5" /> Working tree is clean
                  </div>
                )}
                {dirtyFiles.map((f) => (
                  <div
                    key={f}
                    className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-muted/30"
                  >
                    <span className="font-mono text-[9px] text-foreground/90 truncate flex-1" title={f}>
                      {f}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[9px] text-emerald-400 shrink-0"
                      onClick={() => void onStage([f])}
                    >
                      stage
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[9px] text-rose-400 shrink-0"
                      onClick={() => void onDiscard([f])}
                    >
                      discard
                    </button>
                  </div>
                ))}
                {status.staged.length > 0 && (
                  <div className="text-[9px] text-muted-foreground pt-1">
                    staged: {status.staged.join(", ")}
                  </div>
                )}
              </div>

              {/* Commit + PR */}
              <div className="space-y-1.5 border-t border-border/50 pt-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Commit</span>
                <Input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message…"
                  className="h-7 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onCommitAll();
                  }}
                />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-[10px] flex-1" onClick={() => void onCommitAll()}>
                    Commit all
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => void onPush()}>
                    Push
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => void onOpenPr()} title="Open PR compare URL">
                    <ExternalLink className="size-3" />
                    PR
                  </Button>
                </div>
              </div>

              {/* Dev server */}
              <div className="space-y-1.5 border-t border-border/50 pt-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Dev server</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={devCmd}
                    onChange={(e) => setDevCmd(e.target.value)}
                    placeholder="npm run dev"
                    className="h-7 text-[10px] font-mono flex-1"
                    spellCheck={false}
                  />
                  {devRunning ? (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => void onStopDevServer()}>
                      <Square className="size-3" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => void onStartDevServer()}>
                      <Play className="size-3" /> Start
                    </Button>
                  )}
                </div>
                {devLogs.length > 0 && (
                  <div className="rounded-md bg-black/40 border border-border/50 p-1.5 max-h-28 overflow-y-auto">
                    {devLogs.map((l, i) => (
                      <div key={i} className="font-mono text-[9px] text-emerald-300/80 leading-snug">{l}</div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
