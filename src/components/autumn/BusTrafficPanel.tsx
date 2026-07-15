// Autumn — Bus Traffic panel.
// Shows live AutumnBus /hook/* traffic: message_peer packets, session events,
// pre-prompt injections. Like a developer-tools view of the bus.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import {
  Radio,
  Trash2,
  ArrowRight,
  Users,
  Cable,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BusTrafficPanel() {
  const pulses = useAutumnStore((s) => s.pulses);
  const edges = useAutumnStore((s) => s.edges);
  const nodes = useAutumnStore((s) => s.nodes);
  const clearPulses = useAutumnStore((s) => s.clearPulses);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const tab = useAutumnStore((s) => s.rightPanelTab);

  const nodeName = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id.slice(0, 8);
    return n.name;
  };

  const busEdges = edges.filter((e) => e.kind === "bus");

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border/50 px-2 py-2">
        <Tabs value={tab} onValueChange={(v) => setRightPanelTab(v as "commander" | "tasks" | "bus")}>
          <TabsList className="grid w-full grid-cols-3 bg-muted/30">
            <TabsTrigger value="commander" className="text-xs">
              Commander
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">
              Tasks
            </TabsTrigger>
            <TabsTrigger value="bus" className="text-xs gap-1">
              <Radio className="size-3" />
              Bus
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Bus overview */}
      <div className="p-3 border-b border-border/50 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Cable className="size-3.5 text-amber-400" />
          <span className="font-medium">AutumnBus</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto">
            <span className="size-1 rounded-full bg-emerald-400 mr-1 animate-pulse" />
            live
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>

      {/* Bus edges */}
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
            busEdges.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-1.5 text-[11px] rounded-md bg-muted/20 px-2 py-1"
              >
                <span className="font-medium text-amber-300/90">
                  {nodeName(e.source)}
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className="font-medium text-amber-300/90">
                  {nodeName(e.target)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Live traffic */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Live traffic
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] gap-1 text-muted-foreground"
          onClick={clearPulses}
        >
          <Trash2 className="size-3" />
          Clear
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto autumn-scroll p-3 space-y-2">
        {pulses.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            <Radio className="size-6 text-muted-foreground/30 mx-auto mb-2" />
            No traffic yet.
            <div className="text-[10px] mt-1 text-muted-foreground/60">
              Send a task to a connected agent to see message_peer packets flow.
            </div>
          </div>
        ) : (
          [...pulses].reverse().map((p) => {
            const fromNode = nodes.find((n) => n.id === p.fromNodeId);
            const toNode = nodes.find((n) => n.id === p.toNodeId);
            const fromPersona = fromNode
              ? PERSONA_BY_ID[
                  (fromNode.data as { personaId?: string }).personaId ?? ""
                ]
              : null;
            const toPersona = toNode
              ? PERSONA_BY_ID[
                  (toNode.data as { personaId?: string }).personaId ?? ""
                ]
              : null;
            return (
              <div
                key={p.id}
                className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1"
              >
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-300"
                  >
                    {p.kind}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground ml-auto font-mono">
                    {new Date(p.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <div
                    className="size-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ background: fromPersona?.color ?? "#888" }}
                  >
                    {fromPersona?.glyph ?? "?"}
                  </div>
                  <span className="font-medium">{nodeName(p.fromNodeId)}</span>
                  <ArrowRight className="size-3 text-amber-400" />
                  <div
                    className="size-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ background: toPersona?.color ?? "#888" }}
                  >
                    {toPersona?.glyph ?? "?"}
                  </div>
                  <span className="font-medium">{nodeName(p.toNodeId)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground italic line-clamp-3 pl-1 border-l-2 border-amber-500/30">
                  {p.text}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
