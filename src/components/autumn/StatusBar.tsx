// Autumn — Status bar (sticky footer).
// Shows live stats, recent action, persona roster, version, and shortcuts.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONAS, PERSONA_BY_ID } from "@/lib/autumn/personas";
import {
  GitBranch,
  Cpu,
  Zap,
  CircleDot,
  Clock,
  Command as CommandIcon,
  Wifi,
  Search,
  Keyboard,
  Radio,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Format a timestamp as a relative time string (e.g. "2m ago") */
function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function StatusBar() {
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const tasks = useAutumnStore((s) => s.tasks);
  const pulses = useAutumnStore((s) => s.pulses);
  const recent = useAutumnStore((s) => s.recentActions);
  const isThinking = useAutumnStore((s) => s.isCommanderThinking);
  const running = useAutumnStore((s) => s.isAgentRunning);
  const canvasId = useAutumnStore((s) => s.canvasId);
  const lastSavedAt = useAutumnStore((s) => s.lastSavedAt);
  const selectedNodeIds = useAutumnStore((s) => s.selectedNodeIds);
  const setShowCommandPalette = useAutumnStore((s) => s.setShowCommandPalette);
  const setShowActivityLog = useAutumnStore((s) => s.setShowActivityLog);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const setShortcutHelpOpen = useAutumnStore((s) => s.setShortcutHelpOpen);
  const busHistory = useAutumnStore((s) => s.busHistory);

  const agentCount = nodes.filter((n) => n.kind === "chat").length;
  const runningCount = Object.values(running).filter(Boolean).length;
  const taskDone = tasks.filter((t) => t.status === "done").length;
  const lastAction = recent[recent.length - 1];

  // Names of currently running agents.
  const runningAgentNames = nodes
    .filter((n) => n.kind === "chat" && running[n.id])
    .map((n) => ({
      name: n.name,
      color: PERSONA_BY_ID[(n.data as { personaId?: string }).personaId ?? ""]?.color,
    }));

  return (
    <footer className="h-7 shrink-0 border-t border-border/50 bg-sidebar/60 backdrop-blur-md flex items-center px-3 gap-2.5 text-[10px] text-muted-foreground mt-auto overflow-hidden">
      <button
        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        onClick={() => setShowActivityLog(true)}
        title="Open activity timeline"
      >
        <CircleDot className="size-3 text-emerald-400 status-online-pulse" />
        <span>autumn v0.1.0</span>
      </button>
      {/* Thinking spinner in status bar */}
      {isThinking && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <span className="flex items-center gap-1 text-amber-400">
            <Loader2 className="size-2.5 status-thinking-spinner" />
            <span>commander</span>
          </span>
        </>
      )}
      <div className="h-3 w-px bg-border/60" />
      <div className="flex items-center gap-1.5">
        <Cpu className="size-3" />
        <span>{agentCount} agents</span>
        {runningCount > 0 && (
          <span className="text-amber-400 ml-1 flex items-center gap-1">
            <Zap className="size-2.5 animate-pulse" />
            {runningCount} running
          </span>
        )}
      </div>
      <div className="h-3 w-px bg-border/60" />
      <div className="flex items-center gap-1.5">
        <GitBranch className="size-3" />
        <span>{edges.filter((e) => e.kind === "bus").length} bus</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{tasks.length} tasks</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{taskDone} done</span>
      </div>
      {busHistory.length > 0 && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="hidden sm:flex items-center gap-1.5 text-amber-300/80">
            <Radio className="size-2.5" />
            <span>{busHistory.length} bus msg{busHistory.length === 1 ? "" : "s"}</span>
          </div>
        </>
      )}
      {pulses.length > 0 && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>
              {pulses.length} live
            </span>
          </div>
        </>
      )}
      {selectedNodeIds.length > 0 && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-1.5 text-sky-300">
            <span className="size-1.5 rounded-full bg-sky-400" />
            <span>
              {selectedNodeIds.length} selected
            </span>
          </div>
        </>
      )}
      {lastSavedAt && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="hidden md:flex items-center gap-1 text-muted-foreground/60">
            <Wifi className="size-2.5 text-emerald-400" />
            <span className="font-mono text-[9px]">{canvasId.slice(0, 12)}</span>
            <span className="text-muted-foreground/40">·</span>
            <Clock className="size-2 text-muted-foreground/40" />
            <span className="text-[9px]">{relativeTime(lastSavedAt)}</span>
          </div>
        </>
      )}

      {/* Running agent names */}
      {runningAgentNames.length > 0 && (
        <>
          <div className="h-3 w-px bg-border/60 hidden lg:block" />
          <div className="hidden lg:flex items-center gap-1.5 max-w-[260px]">
            {runningAgentNames.slice(0, 3).map((a, i) => (
              <span
                key={i}
                className="flex items-center gap-0.5 text-[9px] rounded-full px-1.5 py-0.5"
                style={{
                  background: a.color ? `${a.color}20` : undefined,
                  color: a.color ?? undefined,
                }}
              >
                <span
                  className="size-1 rounded-full animate-pulse"
                  style={{ background: a.color }}
                />
                {a.name}
              </span>
            ))}
            {runningAgentNames.length > 3 && (
              <span className="text-[9px] text-muted-foreground/60">
                +{runningAgentNames.length - 3}
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Persona roster */}
      <div className="hidden md:flex items-center gap-0.5">
        {PERSONAS.slice(0, 7).map((p) => {
          const online = nodes.some(
            (n) =>
              n.kind === "chat" &&
              (n.data as { personaId?: string }).personaId === p.id,
          );
          const isRunning = nodes.some(
            (n) =>
              n.kind === "chat" &&
              (n.data as { personaId?: string }).personaId === p.id &&
              running[n.id],
          );
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-0.5 px-1 py-0.5 rounded-md transition-all",
                online ? "opacity-100" : "opacity-30",
              )}
              style={{
                background: online ? `${p.color}15` : "transparent",
              }}
              title={
                online
                  ? isRunning
                    ? `${p.name} running`
                    : `${p.name} online`
                  : `${p.name} (offline)`
              }
            >
              <div
                className={cn(
                  "size-3 rounded-sm flex items-center justify-center text-[8px] font-bold text-white",
                  isRunning && "animate-pulse",
                )}
                style={{
                  background: p.color,
                  boxShadow: isRunning ? `0 0 6px ${p.color}` : undefined,
                }}
              >
                {p.glyph}
              </div>
            </div>
          );
        })}
      </div>

      {/* Command palette hint */}
      <button
        className="hidden md:flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={() => setShowCommandPalette(true)}
        title="Open command palette"
      >
        <CommandIcon className="size-2.5" />
        <kbd className="font-mono">⌘K</kbd>
      </button>
      <button
        className="hidden md:flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={() => setShowNodeSearch(true)}
        title="Search canvas nodes"
      >
        <Search className="size-2.5" />
        <kbd className="font-mono">⌘F</kbd>
      </button>
      <button
        className="hidden md:flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={() => setShortcutHelpOpen(true)}
        title="Keyboard shortcuts"
      >
        <Keyboard className="size-2.5" />
        <kbd className="font-mono">?</kbd>
      </button>

      {lastAction && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="truncate max-w-[180px] font-mono text-[9px] text-muted-foreground/70 hidden sm:block">
            {isThinking ? "commander planning…" : lastAction}
          </div>
        </>
      )}
    </footer>
  );
}
