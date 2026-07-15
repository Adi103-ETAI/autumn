// Autumn — Workspace Stats Dashboard.
// Shows a comprehensive overview of workspace statistics including agent
// performance, bus activity, task completion, and recent activity.

"use client";

import { useAutumnStore, type ActivityEntry } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { ChatNodeData } from "@/lib/autumn/types";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Bot,
  Cable,
  CheckCircle2,
  Clock,
  MessageSquare,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles,
  Play,
  Square,
  ListChecks,
  Plus,
  Trash2,
  Save,
  FolderOpen,
  Eraser,
  CircleDot,
  Copy,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- helpers ----------

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const KIND_META: Partial<
  Record<ActivityEntry["kind"], { icon: LucideIcon; color: string }>
> = {
  commander_plan: { icon: Sparkles, color: "text-amber-400" },
  agent_status: { icon: Bot, color: "text-fuchsia-400" },
  agent_message: { icon: Bot, color: "text-emerald-400" },
  bus_message_peer: { icon: Cable, color: "text-amber-300" },
  task_claim: { icon: ListChecks, color: "text-sky-400" },
  task_complete: { icon: CheckCircle2, color: "text-emerald-400" },
  task_add: { icon: Plus, color: "text-orange-400" },
  node_added: { icon: Plus, color: "text-violet-400" },
  node_removed: { icon: Trash2, color: "text-rose-400" },
  edge_added: { icon: Cable, color: "text-emerald-400" },
  edge_removed: { icon: Trash2, color: "text-rose-400" },
  canvas_saved: { icon: Save, color: "text-amber-300" },
  canvas_loaded: { icon: FolderOpen, color: "text-sky-400" },
  canvas_cleared: { icon: Eraser, color: "text-rose-400" },
  duplicate_node: { icon: Copy, color: "text-amber-300" },
  search: { icon: Search, color: "text-emerald-400" },
  agent_session_start: { icon: Play, color: "text-emerald-400" },
  agent_session_stop: { icon: Square, color: "text-violet-400" },
};

// ---------- component ----------

export function StatsDashboard() {
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const busHistory = useAutumnStore((s) => s.busHistory);
  const tasks = useAutumnStore((s) => s.tasks);
  const isAgentRunning = useAutumnStore((s) => s.isAgentRunning);
  const activityLog = useAutumnStore((s) => s.activityLog);

  // -- derived data --

  const chatNodes = nodes.filter((n) => n.kind === "chat");

  // Agent breakdown
  const onlineCount = chatNodes.filter((n) => {
    const d = n.data as ChatNodeData;
    return d.status === "working" || d.status === "thinking";
  }).length;
  const runningCount = Object.values(isAgentRunning).filter(Boolean).length;
  const offlineCount = chatNodes.length - onlineCount;

  // Bus messages
  const totalBusMsgs = busHistory.length;
  const sentCount = busHistory.length; // each entry is a sent message
  const receivedCount = busHistory.length; // same entries, from receiver perspective

  // Task completion rate
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Avg response time — compute from activityLog agent_session_start/stop pairs
  const sessionStops = activityLog.filter((e) => e.kind === "agent_session_stop");
  const avgResponseMs = sessionStops.length > 0
    ? sessionStops.reduce((sum, e) => {
        // Try to find a matching start entry for the same node
        const startEntry = activityLog.find(
          (s) =>
            s.kind === "agent_session_start" &&
            s.nodeId === e.nodeId &&
            s.ts < e.ts,
        );
        if (startEntry) return sum + (e.ts - startEntry.ts);
        return sum;
      }, 0) / sessionStops.length
    : 0;

  // Per-agent stats for the performance table
  const agentStats = chatNodes.map((n) => {
    const d = n.data as ChatNodeData;
    const persona = PERSONA_BY_ID[d.personaId ?? ""];
    const msgs = d.messages.length;
    const tasksCompleted = tasks.filter(
      (t) => t.assigneeId === n.id && t.status === "done",
    ).length;
    const handoffsSent = busHistory.filter((p) => p.fromNodeId === n.id).length;
    const handoffsRecv = busHistory.filter((p) => p.toNodeId === n.id).length;
    const lastActive = d.messages.length > 0
      ? d.messages[d.messages.length - 1].ts
      : n.createdAt;
    return {
      id: n.id,
      name: persona?.name ?? n.name,
      persona,
      status: d.status ?? "idle",
      msgs,
      tasksCompleted,
      handoffsSent,
      handoffsRecv,
      lastActive,
    };
  }).sort((a, b) => b.tasksCompleted - a.tasksCompleted);

  // Bus activity heatmap data
  const heatmapAgents = chatNodes.map((n) => {
    const d = n.data as ChatNodeData;
    return {
      id: n.id,
      name: PERSONA_BY_ID[d.personaId ?? ""]?.name ?? n.name,
      persona: PERSONA_BY_ID[d.personaId ?? ""],
    };
  });

  // Build heatmap matrix: from → to count
  const heatmapMatrix = new Map<string, number>();
  let maxHeatVal = 0;
  for (const p of busHistory) {
    const key = `${p.fromNodeId}::${p.toNodeId}`;
    const val = (heatmapMatrix.get(key) ?? 0) + 1;
    heatmapMatrix.set(key, val);
    if (val > maxHeatVal) maxHeatVal = val;
  }

  // Recent activity (last 5)
  const recentActivity = [...activityLog].reverse().slice(0, 5);

  // ---------- render ----------

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border/50 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <BarChart3 className="size-3.5 text-amber-400" />
          <span className="font-medium">Workspace Stats</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto">
            live
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto autumn_scroll p-3 space-y-4">
        {/* a. Overview Cards (2x2 grid) */}
        <div className="grid grid-cols-2 gap-2">
          {/* Total Agents */}
          <OverviewCard
            icon={Bot}
            label="Total Agents"
            value={chatNodes.length}
            accent="emerald"
          >
            <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {onlineCount} online
              </span>
              <span className="flex items-center gap-0.5">
                <span className="size-1.5 rounded-full bg-amber-400" />
                {runningCount} running
              </span>
              <span className="flex items-center gap-0.5">
                <span className="size-1.5 rounded-full bg-zinc-500" />
                {offlineCount} off
              </span>
            </div>
          </OverviewCard>

          {/* Total Bus Messages */}
          <OverviewCard
            icon={Cable}
            label="Bus Messages"
            value={totalBusMsgs}
            accent="amber"
          >
            <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <ArrowUpRight className="size-2" />
                {sentCount} sent
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowDownLeft className="size-2" />
                {receivedCount} recv
              </span>
            </div>
          </OverviewCard>

          {/* Task Completion Rate */}
          <OverviewCard
            icon={CheckCircle2}
            label="Task Completion"
            value={`${completionPct}%`}
            accent="emerald"
          >
            <div className="mt-1.5">
              <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-emerald-400 transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">
                {doneTasks} / {totalTasks} tasks done
              </div>
            </div>
          </OverviewCard>

          {/* Avg Response Time */}
          <OverviewCard
            icon={Clock}
            label="Avg Response"
            value={avgResponseMs > 0 ? formatDuration(avgResponseMs) : "—"}
            accent="violet"
          >
            {sessionStops.length > 0 && (
              <div className="text-[9px] text-muted-foreground mt-1">
                {sessionStops.length} session{sessionStops.length === 1 ? "" : "s"} tracked
              </div>
            )}
          </OverviewCard>
        </div>

        {/* b. Agent Performance Table */}
        {chatNodes.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 backdrop-blur overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
              <Bot className="size-3 text-amber-400" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Agent Performance
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto autumn_scroll">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-3 py-1.5 font-medium">Agent</th>
                    <th className="text-center px-2 py-1.5 font-medium">Status</th>
                    <th className="text-center px-2 py-1.5 font-medium">Msgs</th>
                    <th className="text-center px-2 py-1.5 font-medium">Tasks</th>
                    <th className="text-center px-2 py-1.5 font-medium">Sent</th>
                    <th className="text-center px-2 py-1.5 font-medium">Recv</th>
                    <th className="text-right px-3 py-1.5 font-medium">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {agentStats.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-border/20 hover:bg-muted/40 transition-colors perf-row-hover"
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="size-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                            style={{ background: a.persona?.color ?? "#888" }}
                          >
                            {a.persona?.glyph ?? "?"}
                          </div>
                          <span className="font-medium truncate max-w-[80px]">
                            {a.name}
                          </span>
                        </div>
                      </td>
                      <td className="text-center px-2 py-1.5">
                        <StatusDot status={a.status} />
                      </td>
                      <td className="text-center px-2 py-1.5 tabular-nums">
                        {a.msgs}
                      </td>
                      <td className="text-center px-2 py-1.5 tabular-nums text-emerald-300">
                        {a.tasksCompleted}
                      </td>
                      <td className="text-center px-2 py-1.5 tabular-nums text-sky-300">
                        {a.handoffsSent}
                      </td>
                      <td className="text-center px-2 py-1.5 tabular-nums text-violet-300">
                        {a.handoffsRecv}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground">
                        {relTime(a.lastActive)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* c. Bus Activity Heatmap */}
        {heatmapAgents.length >= 2 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 backdrop-blur overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
              <Cable className="size-3 text-amber-400" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Bus Activity Heatmap
              </span>
            </div>
            <div className="p-3 overflow-x-auto">
              <div className="inline-block">
                {/* Column headers */}
                <div className="flex items-center">
                  <div className="w-16 shrink-0" /> {/* spacer for row labels */}
                  {heatmapAgents.map((a) => (
                    <div
                      key={a.id}
                      className="w-10 shrink-0 text-center text-[8px] text-muted-foreground truncate px-0.5"
                      title={a.name}
                    >
                      <div
                        className="size-3 rounded-sm flex items-center justify-center text-[7px] font-bold text-white mx-auto"
                        style={{ background: a.persona?.color ?? "#888" }}
                      >
                        {a.persona?.glyph ?? "?"}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Rows */}
                {heatmapAgents.map((src) => (
                  <div key={src.id} className="flex items-center">
                    <div
                      className="w-16 shrink-0 flex items-center gap-1 pr-1 text-[8px] text-muted-foreground truncate"
                      title={src.name}
                    >
                      <div
                        className="size-3 rounded-sm flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                        style={{ background: src.persona?.color ?? "#888" }}
                      >
                        {src.persona?.glyph ?? "?"}
                      </div>
                      <span className="truncate">{src.name}</span>
                    </div>
                    {heatmapAgents.map((tgt) => {
                      const count = heatmapMatrix.get(`${src.id}::${tgt.id}`) ?? 0;
                      const intensity =
                        maxHeatVal > 0 ? count / maxHeatVal : 0;
                      return (
                        <div
                          key={tgt.id}
                          className="w-10 shrink-0 h-8 flex items-center justify-center"
                        >
                          <div
                            className={cn(
                              "size-7 rounded-sm flex items-center justify-center text-[8px] font-mono tabular-nums transition-colors heatmap-cell",
                              count > 0
                                ? "text-white"
                                : "text-muted-foreground/30",
                            )}
                            style={{
                              background:
                                count > 0
                                  ? `rgba(245, 158, 11, ${0.15 + intensity * 0.65})`
                                  : "rgba(255,255,255,0.03)",
                              border:
                                count > 0
                                  ? `1px solid rgba(245, 158, 11, ${0.2 + intensity * 0.4})`
                                  : "1px solid rgba(255,255,255,0.05)",
                            }}
                            title={`${src.name} → ${tgt.name}: ${count} messages`}
                          >
                            {count > 0 ? count : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* d. Recent Activity Feed */}
        <div className="rounded-lg border border-border/50 bg-muted/30 backdrop-blur overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
            <CircleDot className="size-3 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Recent Activity
            </span>
            <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto">
              {activityLog.length}
            </Badge>
          </div>
          <div className="max-h-36 overflow-y-auto autumn_scroll">
            {recentActivity.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-muted-foreground/60 italic">
                No activity yet. Send a command to the Commander to get started.
              </div>
            ) : (
              recentActivity.map((e) => {
                const meta = KIND_META[e.kind] ?? {
                  icon: CircleDot,
                  color: "text-muted-foreground",
                };
                const Icon = meta.icon;
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 last:border-0 hover:bg-muted/40 transition-colors activity-entry-hover"
                  >
                    <Icon className={cn("size-3 shrink-0", meta.color)} />
                    <span className="text-[10px] text-foreground/80 truncate flex-1">
                      {e.text}
                    </span>
                    <span className="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
                      {relTime(e.ts)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Empty state when no agents */}
        {chatNodes.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8 px-4">
            <div className="size-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <BarChart3 className="size-5 text-amber-400/70" />
            </div>
            <div className="font-medium text-foreground/80 mb-1">
              No agents on the canvas
            </div>
            <div className="text-[10px] text-muted-foreground/70 leading-relaxed max-w-[220px] mx-auto">
              Add agents to the canvas or ask the Commander to{" "}
              <span className="text-amber-300/80">"add a chat node"</span>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- sub-components ----------

function OverviewCard({
  icon: Icon,
  label,
  value,
  accent,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  accent: "emerald" | "amber" | "violet";
  children?: React.ReactNode;
}) {
  const accentColors = {
    emerald: "bg-emerald-500/5 border-emerald-500/20",
    amber: "bg-amber-500/5 border-amber-500/20",
    violet: "bg-violet-500/5 border-violet-500/20",
  };
  const accentText = {
    emerald: "text-emerald-400",
    amber: "text-amber-300",
    violet: "text-violet-300",
  };

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 backdrop-blur stats-card-hover cursor-default",
        accentColors[accent],
      )}
    >
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1">
        <Icon className="size-2.5" />
        <span>{label}</span>
      </div>
      <div className={cn("text-lg font-semibold leading-none stats-value-enter", accentText[accent])}>
        {value}
      </div>
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    working: "bg-emerald-400",
    thinking: "bg-amber-400",
    done: "bg-zinc-400",
    idle: "bg-zinc-500",
    error: "bg-rose-500",
    waiting: "bg-sky-400",
  };
  const isAnimated = status === "working" || status === "thinking";

  return (
    <span className="inline-flex items-center justify-center">
      <span
        className={cn(
          "size-2 rounded-full",
          colorMap[status] ?? "bg-zinc-500",
          isAnimated && "animate-pulse",
        )}
        title={status}
      />
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
