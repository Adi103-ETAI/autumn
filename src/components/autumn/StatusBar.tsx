// Autumn — Status bar (sticky footer).
// Shows live stats, recent action, persona roster, and version.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONAS } from "@/lib/autumn/personas";
import {
  GitBranch,
  Cpu,
  Zap,
  CircleDot,
} from "lucide-react";

export function StatusBar() {
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const tasks = useAutumnStore((s) => s.tasks);
  const pulses = useAutumnStore((s) => s.pulses);
  const recent = useAutumnStore((s) => s.recentActions);
  const isThinking = useAutumnStore((s) => s.isCommanderThinking);
  const running = useAutumnStore((s) => s.isAgentRunning);

  const agentCount = nodes.filter((n) => n.kind === "chat").length;
  const runningCount = Object.values(running).filter(Boolean).length;
  const taskDone = tasks.filter((t) => t.status === "done").length;
  const lastAction = recent[recent.length - 1];

  return (
    <footer className="h-7 shrink-0 border-t border-border/50 bg-sidebar/60 backdrop-blur-md flex items-center px-3 gap-3 text-[10px] text-muted-foreground mt-auto">
      <div className="flex items-center gap-1.5">
        <CircleDot className="size-3 text-emerald-400" />
        <span>autumn v0.1.0</span>
      </div>
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
      {pulses.length > 0 && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{pulses.length} bus msg{pulses.length === 1 ? "" : "s"}</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Persona roster */}
      <div className="hidden md:flex items-center gap-1">
        {PERSONAS.slice(0, 7).map((p) => {
          const online = nodes.some(
            (n) =>
              n.kind === "chat" &&
              (n.data as { personaId?: string }).personaId === p.id,
          );
          return (
            <div
              key={p.id}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md"
              style={{
                background: online ? `${p.color}15` : "transparent",
                opacity: online ? 1 : 0.4,
              }}
              title={online ? `${p.name} online` : `${p.name} (offline)`}
            >
              <div
                className="size-3 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
                style={{ background: p.color }}
              >
                {p.glyph}
              </div>
              <span className="text-[9px]">{p.name}</span>
            </div>
          );
        })}
      </div>

      {lastAction && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="truncate max-w-[200px] font-mono text-[9px] text-muted-foreground/70">
            {isThinking ? "commander planning…" : lastAction}
          </div>
        </>
      )}
    </footer>
  );
}
