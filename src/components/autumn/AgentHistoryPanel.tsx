// Autumn — Per-agent execution history panel (Task 2-a).
// A slide-out Sheet (right-side, ~480px) that shows every past run for the
// agent currently stored in `agentHistoryFor`. Each entry shows status,
// task summary, duration, response length, and relative time. Entries are
// expandable to reveal the full task text + start/end timestamps.
// History is persisted via the existing AgentLog Prisma table (kind =
// agent_session_stop), so it survives page reloads.

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import type { AgentRunDuration } from "@/lib/autumn/types";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  History,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Bot,
  RefreshCw,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// Shape of a single persisted session-stop entry returned by /api/logs.
interface RunEntry {
  id: string;
  ts: number;
  text: string;
  nodeId?: string;
  meta?: {
    startTs?: number;
    endTs?: number;
    durationMs?: number;
    task?: string;
    responseLength?: number;
    status?: "done" | "error" | string;
  };
}

export function AgentHistoryPanel() {
  const open = useAutumnStore((s) => s.agentHistoryOpen);
  const setOpen = useAutumnStore((s) => s.setAgentHistoryOpen);
  const agentHistoryFor = useAutumnStore((s) => s.agentHistoryFor);
  const canvasId = useAutumnStore((s) => s.canvasId);
  const nodes = useAutumnStore((s) => s.nodes);
  const agentRunDurations = useAutumnStore((s) => s.agentRunDurations);

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resolve the agent node currently being viewed.
  const node = agentHistoryFor
    ? nodes.find((n) => n.id === agentHistoryFor)
    : null;
  const persona =
    node?.kind === "chat"
      ? PERSONA_BY_ID[(node.data as { personaId?: string }).personaId ?? ""]
      : undefined;

  // Get in-memory run durations for this agent
  const liveDurations: AgentRunDuration[] = agentHistoryFor
    ? (agentRunDurations[agentHistoryFor] ?? [])
    : [];
  const completedLiveDurations = liveDurations.filter((d) => d.end !== undefined);
  const avgLiveMs = completedLiveDurations.length > 0
    ? Math.round(completedLiveDurations.reduce((sum, d) => sum + (d.end! - d.start), 0) / completedLiveDurations.length)
    : null;

  const fetchRuns = useCallback(async () => {
    if (!agentHistoryFor) {
      setRuns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url =
        `/api/logs?canvas=${encodeURIComponent(canvasId)}` +
        `&node=${encodeURIComponent(agentHistoryFor)}` +
        `&kind=agent_session_stop&limit=100`;
      const r = await fetch(url, { method: "GET" });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const j = await r.json();
      const entries: RunEntry[] = (j.entries ?? []) as RunEntry[];
      // Sort newest first (entries come back ordered asc by createdAt).
      entries.sort((a, b) => b.ts - a.ts);
      setRuns(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [agentHistoryFor, canvasId]);

  // Fetch when the panel opens or when the target node changes.
  useEffect(() => {
    if (open && agentHistoryFor) {
      void fetchRuns();
    } else if (!open) {
      // Reset state when closing so the next open starts fresh.
      setRuns([]);
      setExpandedId(null);
      setError(null);
    }
  }, [open, agentHistoryFor, fetchRuns]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[480px] bg-card/95 backdrop-blur border-l-violet-500/20 p-0 flex flex-col"
      >
        <SheetHeader className="px-4 py-3 border-b border-border/50">
          <SheetTitle className="flex items-center gap-2 text-base">
            <div
              className="size-6 rounded-md flex items-center justify-center text-white text-[11px] font-bold shadow"
              style={{ background: persona?.color ?? "#71717a" }}
            >
              {persona?.glyph ?? <Bot className="size-3.5" />}
            </div>
            <span className="truncate">
              {persona?.name ?? node?.name ?? "Agent"} · Execution history
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Every past run for this agent — newest first. Persisted across
            reloads.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
          <History className="size-3.5 text-violet-400" />
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </Badge>
          {avgLiveMs !== null && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-violet-500/30 text-violet-400">
              <Timer className="size-2.5 mr-0.5" />
              Avg {formatDuration(avgLiveMs)}
            </Badge>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] gap-1 text-muted-foreground"
            onClick={() => void fetchRuns()}
            disabled={loading || !agentHistoryFor}
            title="Reload history"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {!agentHistoryFor ? (
              <EmptyState
                icon={<Bot className="size-8 text-muted-foreground/30" />}
                title="No agent selected"
                hint="Open the history from an agent's chat header or dropdown menu."
              />
            ) : loading ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <RefreshCw className="size-6 text-muted-foreground/40 animate-spin mb-2" />
                <div className="text-xs text-muted-foreground">Loading…</div>
              </div>
            ) : error ? (
              <EmptyState
                icon={<XCircle className="size-8 text-rose-400/50" />}
                title="Failed to load"
                hint={error}
              />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={<History className="size-8 text-muted-foreground/30" />}
                title="No runs yet"
                hint="Send this agent a task to begin."
              />
            ) : (
              runs.map((r) => {
                const expanded = expandedId === r.id;
                const status = r.meta?.status ?? "done";
                const isError = status === "error";
                const task = r.meta?.task ?? r.text;
                const taskSummary =
                  task.length > 80 ? `${task.slice(0, 77)}…` : task;
                const durationMs = r.meta?.durationMs;
                const responseLength = r.meta?.responseLength;
                const startTs = r.meta?.startTs;
                const endTs = r.meta?.endTs;
                return (
                  <div key={r.id}>
                    <button
                      onClick={() =>
                        setExpandedId(expanded ? null : r.id)
                      }
                      className="w-full text-left rounded-lg p-2.5 border border-border/40 bg-muted/20 hover:bg-accent/30 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={cn(
                            "size-6 shrink-0 rounded-md flex items-center justify-center border",
                            isError
                              ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                          )}
                        >
                          {isError ? (
                            <XCircle className="size-3.5" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "text-[9px] uppercase tracking-wider font-medium",
                                isError
                                  ? "text-rose-400"
                                  : "text-emerald-400",
                              )}
                            >
                              {status}
                            </span>
                            {durationMs !== undefined && (
                              <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/70 font-mono">
                                <Clock className="size-2.5" />
                                {formatDuration(durationMs)}
                              </span>
                            )}
                            {responseLength !== undefined && (
                              <span className="text-[9px] text-muted-foreground/70 font-mono">
                                · {responseLength} chars
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground/50 ml-auto">
                              {formatDistanceToNow(new Date(r.ts), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          <div className="text-xs text-foreground/90 mt-0.5 leading-snug line-clamp-2">
                            {taskSummary || "Untitled task"}
                          </div>
                          {expanded && (
                            <div className="mt-2 space-y-1.5 pt-2 border-t border-border/40">
                              <div className="text-[10px] text-muted-foreground">
                                <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px] mr-1">
                                  Task
                                </span>
                              </div>
                              <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words rounded-md bg-background/40 border border-border/40 p-2 max-h-40 overflow-y-auto autumn-scroll">
                                {task || "—"}
                              </div>
                              <div className="flex flex-col gap-1 pt-1">
                                {startTs !== undefined && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                                    <Play className="size-3 text-emerald-400" />
                                    <span className="font-mono">
                                      {new Date(startTs).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                                {endTs !== undefined && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                                    <Square className="size-3 text-violet-400" />
                                    <span className="font-mono">
                                      {new Date(endTs).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                                {durationMs !== undefined && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                                    <Clock className="size-3 text-violet-300" />
                                    <span className="font-mono">
                                      {durationMs} ms ·{" "}
                                      {formatDuration(durationMs)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center px-6">
      {icon}
      <div className="text-sm text-muted-foreground mt-2">{title}</div>
      <div className="text-[10px] text-muted-foreground/60 mt-1 max-w-[280px]">
        {hint}
      </div>
    </div>
  );
}

// Format a millisecond duration as a human-readable short string.
// <1s  → "Xms"
// <60s → "Xs"
// <1h  → "Xm Ys"
// else → "Xh Ym"
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    const remSec = totalSec % 60;
    return remSec === 0 ? `${totalMin}m` : `${totalMin}m ${remSec}s`;
  }
  const totalHr = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin === 0 ? `${totalHr}h` : `${totalHr}h ${remMin}m`;
}
