// Autumn — Activity timeline.
// A compact timeline of everything that's happened on the canvas:
// commander plans, agent runs, bus handoffs, task events, canvas saves.
// Shown as a slide-out overlay panel from the status bar's clock button.

"use client";

import { useAutumnStore, type ActivityEntry } from "@/lib/autumn/store";
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
  Sparkles,
  Bot,
  Cable,
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
import { formatDistanceToNow } from "date-fns";

const KIND_META: Partial<
  Record<
    ActivityEntry["kind"],
    { icon: LucideIcon; color: string; label: string }
  >
> = {
  commander_plan: { icon: Sparkles, color: "text-amber-400", label: "Plan" },
  agent_status: { icon: Bot, color: "text-fuchsia-400", label: "Agent" },
  agent_message: { icon: Bot, color: "text-emerald-400", label: "Response" },
  bus_message_peer: { icon: Cable, color: "text-amber-300", label: "Peer msg" },
  task_claim: { icon: ListChecks, color: "text-sky-400", label: "Task" },
  task_complete: { icon: ListChecks, color: "text-emerald-400", label: "Task" },
  task_add: { icon: Plus, color: "text-orange-400", label: "Task" },
  node_added: { icon: Plus, color: "text-violet-400", label: "Node" },
  node_removed: { icon: Trash2, color: "text-rose-400", label: "Node" },
  edge_added: { icon: Cable, color: "text-emerald-400", label: "Edge" },
  edge_removed: { icon: Trash2, color: "text-rose-400", label: "Edge" },
  canvas_saved: { icon: Save, color: "text-amber-300", label: "Save" },
  canvas_loaded: { icon: FolderOpen, color: "text-sky-400", label: "Load" },
  canvas_cleared: { icon: Eraser, color: "text-rose-400", label: "Clear" },
  duplicate_node: { icon: Copy, color: "text-amber-300", label: "Duplicate" },
  search: { icon: Search, color: "text-emerald-400", label: "Search" },
};

export function ActivityTimeline({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const activity = useAutumnStore((s) => s.activityLog);
  const nodes = useAutumnStore((s) => s.nodes);
  const clearActivity = useAutumnStore((s) => s.clearActivity);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);

  const reversed = [...activity].reverse();

  const personaFor = (nodeId?: string) => {
    if (!nodeId) return null;
    const n = nodes.find((x) => x.id === nodeId);
    if (!n || n.kind !== "chat") return null;
    return PERSONA_BY_ID[(n.data as { personaId?: string }).personaId ?? ""];
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[440px] sm:w-[480px] bg-card/95 backdrop-blur border-l-amber-500/20 p-0 flex flex-col"
      >
        <SheetHeader className="px-4 py-3 border-b border-border/50">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CircleDot className="size-4 text-emerald-400 animate-pulse" />
            Activity timeline
          </SheetTitle>
          <SheetDescription className="text-xs">
            Everything that's happened on this canvas — newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {activity.length} {activity.length === 1 ? "event" : "events"}
          </Badge>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] gap-1 text-muted-foreground"
            onClick={() => {
              clearActivity();
            }}
            title="Clears both the in-memory timeline and the persisted log for this canvas"
          >
            <Eraser className="size-3" />
            Clear timeline
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {reversed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <CircleDot className="size-8 text-muted-foreground/30 mb-2" />
                <div className="text-sm text-muted-foreground">No activity yet.</div>
                <div className="text-[10px] text-muted-foreground/60 mt-1">
                  Send a command to the Commander to get started.
                </div>
              </div>
            ) : (
              reversed.map((e, i) => {
                const meta = KIND_META[e.kind] ?? {
                  icon: CircleDot,
                  color: "text-muted-foreground",
                  label: "Event",
                };
                const Icon = meta.icon;
                const persona = personaFor(e.nodeId);
                const prev = reversed[i - 1];
                const showDateSep =
                  !prev ||
                  new Date(prev.ts).toDateString() !==
                    new Date(e.ts).toDateString();
                return (
                  <div key={e.id}>
                    {showDateSep && (
                      <div className="flex items-center gap-2 my-3 px-1">
                        <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider font-medium">
                          {new Date(e.ts).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (e.nodeId) {
                          setSelectedNode(e.nodeId);
                          onOpenChange(false);
                        }
                      }}
                      className={cn(
                        "w-full text-left flex items-start gap-2.5 rounded-lg p-2 transition-colors",
                        e.nodeId
                          ? "hover:bg-accent/30 cursor-pointer"
                          : "cursor-default",
                      )}
                    >
                      <div
                        className={cn(
                          "size-6 shrink-0 rounded-md flex items-center justify-center bg-muted/40 border border-border/40",
                          meta.color,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {persona && (
                            <div
                              className="size-3 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                              style={{ background: persona.color }}
                            >
                              {persona.glyph}
                            </div>
                          )}
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                            {meta.label}
                          </span>
                          <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono">
                            {new Date(e.ts).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="text-xs text-foreground/90 mt-0.5 leading-snug">
                          {e.text}
                        </div>
                        <div className="text-[9px] text-muted-foreground/50 mt-0.5">
                          {formatDistanceToNow(new Date(e.ts), {
                            addSuffix: true,
                          })}
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
