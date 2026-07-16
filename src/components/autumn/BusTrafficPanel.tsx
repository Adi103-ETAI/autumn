// Autumn — Bus Traffic panel.
// Shows live AutumnBus /hook/* traffic: message_peer packets, session events,
// pre-prompt injections. Like a developer-tools view of the bus.
// Uses `busHistory` (persistent) instead of `pulses` (transient edge animation)
// so that traffic stays visible after the 3.5s animation clears.

"use client";

import { useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { BusPulse } from "@/lib/autumn/types";
import {
  Radio,
  Trash2,
  ArrowRight,
  Users,
  Cable,
  ChevronDown,
  ChevronUp,
  X,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BusTrafficPanel() {
  const busHistory = useAutumnStore((s) => s.busHistory);
  const edges = useAutumnStore((s) => s.edges);
  const nodes = useAutumnStore((s) => s.nodes);
  const clearBusHistory = useAutumnStore((s) => s.clearBusHistory);
  const removeBusHistoryEntry = useAutumnStore((s) => s.removeBusHistoryEntry);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const nodeName = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id.slice(0, 8);
    return n.name;
  };

  const busEdges = edges.filter((e) => e.kind === "bus");

  // Per-edge message counts.
  const edgeCounts = new Map<string, number>();
  for (const p of busHistory) {
    edgeCounts.set(p.edgeId, (edgeCounts.get(p.edgeId) ?? 0) + 1);
  }

  // Per-peer sent/received counts.
  const sent = new Map<string, number>();
  const recv = new Map<string, number>();
  for (const p of busHistory) {
    sent.set(p.fromNodeId, (sent.get(p.fromNodeId) ?? 0) + 1);
    recv.set(p.toNodeId, (recv.get(p.toNodeId) ?? 0) + 1);
  }
  const totalMsgs = busHistory.length;

  return (
    <div className="flex flex-col h-full">
      {/* Bus overview */}
      <div className="p-3 border-b border-border/50 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Cable className="size-3.5 text-violet-400" />
          <span className="font-medium">AutumnBus</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto">
            <span className="size-1 rounded-full bg-emerald-400 mr-1 animate-pulse" />
            live
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Cable className="size-2.5" />
              Edges
            </div>
            <div className="text-sm font-semibold">{busEdges.length}</div>
          </div>
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Users className="size-2.5" />
              Peers
            </div>
            <div className="text-sm font-semibold">
              {nodes.filter((n) => n.kind === "chat").length}
            </div>
          </div>
          <div className="rounded-md bg-violet-500/5 border border-violet-500/20 px-2 py-1.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Radio className="size-2.5" />
              Msgs
            </div>
            <div className="text-sm font-semibold text-violet-300">{totalMsgs}</div>
          </div>
        </div>
      </div>

      {/* Bus edges with message counts */}
      <div className="p-3 border-b border-border/50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          Bus edges
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto autumn-scroll">
          {busEdges.length === 0 ? (
            <div className="text-[10px] text-muted-foreground/60 italic">
              No bus edges yet. Connect two agents.
            </div>
          ) : (
            busEdges.map((e) => {
              const count = edgeCounts.get(e.id) ?? 0;
              return (
                <div
                  key={e.id}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] rounded-md px-2 py-1 transition-colors",
                    count > 0
                      ? "bg-violet-500/10 border border-violet-500/20"
                      : "bg-muted/20",
                  )}
                >
                  <span className="font-medium text-violet-300/90">
                    {nodeName(e.source)}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span className="font-medium text-violet-300/90">
                    {nodeName(e.target)}
                  </span>
                  {count > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[9px] h-4 px-1 border-violet-500/40 text-violet-300"
                    >
                      {count} msg{count === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Live traffic */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          Traffic log
          {totalMsgs > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              {totalMsgs}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] gap-1 text-muted-foreground"
          onClick={clearBusHistory}
          disabled={totalMsgs === 0}
        >
          <Trash2 className="size-3" />
          Clear
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto autumn-scroll p-3 space-y-2">
        {busHistory.length === 0 ? (
          <BusEmptyState />
        ) : (
          [...busHistory].reverse().map((p) => (
            <BusTrafficCard
              key={p.id}
              pulse={p}
              nodeName={nodeName}
              expanded={expandedId === p.id}
              onToggle={() =>
                setExpandedId(expandedId === p.id ? null : p.id)
              }
              onRemove={() => removeBusHistoryEntry(p.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BusEmptyState() {
  return (
    <div className="text-center text-xs text-muted-foreground py-10 px-4 empty-cta rounded-lg">
      <div className="size-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-3">
        <Inbox className="size-5 text-violet-400/70" />
      </div>
      <div className="font-medium text-foreground/80 mb-1">No bus traffic yet</div>
      <div className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Connect two agents with a bus edge and send one of them a task.
        The handoff <code className="text-violet-300/80">message_peer</code> packet
        will appear here.
      </div>
    </div>
  );
}

function BusTrafficCard({
  pulse,
  nodeName,
  expanded,
  onToggle,
  onRemove,
}: {
  pulse: BusPulse;
  nodeName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const nodes = useAutumnStore((s) => s.nodes);
  const fromNode = nodes.find((n) => n.id === pulse.fromNodeId);
  const toNode = nodes.find((n) => n.id === pulse.toNodeId);
  const fromPersona = fromNode
    ? PERSONA_BY_ID[(fromNode.data as { personaId?: string }).personaId ?? ""]
    : null;
  const toPersona = toNode
    ? PERSONA_BY_ID[(toNode.data as { personaId?: string }).personaId ?? ""]
    : null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-violet-500/5 hover:bg-violet-500/10 transition-colors p-2 space-y-1 group bus-card-enter relative overflow-hidden",
        expanded && "ring-1 ring-violet-500/30",
      )}
      style={{
        borderColor: fromPersona ? `${fromPersona.color}40` : "oklch(0.78 0.18 55 / 0.2)",
      }}
    >
      {/* Persona-colored left edge accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: fromPersona?.color ?? "#888" }}
      />
      <div className="flex items-center gap-1.5 pl-1">
        <Badge
          variant="outline"
          className="text-[9px] h-4 px-1 border-violet-500/30 text-violet-300"
        >
          {pulse.kind}
        </Badge>
        <span className="text-[9px] text-muted-foreground ml-auto font-mono timestamp-mono">
          {new Date(pulse.ts).toLocaleTimeString()}
        </span>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-rose-400 transition-all"
          aria-label="Remove entry"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] pl-1">
        <div
          className="size-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shadow-sm"
          style={{ background: fromPersona?.color ?? "#888" }}
          title={fromPersona?.name}
        >
          {fromPersona?.glyph ?? "?"}
        </div>
        <span className="font-medium truncate">{nodeName(pulse.fromNodeId)}</span>
        <ArrowRight className="size-3 text-violet-400 persona-arrow-flow shrink-0" />
        <div
          className="size-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shadow-sm"
          style={{ background: toPersona?.color ?? "#888" }}
          title={toPersona?.name}
        >
          {toPersona?.glyph ?? "?"}
        </div>
        <span className="font-medium truncate">{nodeName(pulse.toNodeId)}</span>
      </div>
      <button
        onClick={onToggle}
        className="block w-full text-left text-[11px] text-muted-foreground italic pl-1 border-l-2 border-violet-500/30 hover:border-violet-500/60 transition-colors"
      >
        <span className={cn("line-clamp-2", expanded && "line-clamp-none whitespace-pre-wrap")}>
          {pulse.text}
        </span>
        <span className="flex items-center gap-0.5 text-[9px] text-violet-400/60 mt-1">
          {expanded ? (
            <>
              <ChevronUp className="size-2.5" /> collapse
            </>
          ) : (
            <>
              <ChevronDown className="size-2.5" /> expand
            </>
          )}
        </span>
      </button>
    </div>
  );
}
