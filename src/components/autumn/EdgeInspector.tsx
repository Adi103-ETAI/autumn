// Autumn — Edge Inspector dialog.
// Opens when a user clicks the label on a bus edge. Shows all message_peer
// packets that flowed through that edge (from busHistory), plus edge metadata.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cable, ArrowRight, Trash2, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { cn } from "@/lib/utils";

export function EdgeInspector({
  edgeId,
  open,
  onOpenChange,
}: {
  edgeId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const edges = useAutumnStore((s) => s.edges);
  const nodes = useAutumnStore((s) => s.nodes);
  const busHistory = useAutumnStore((s) => s.busHistory);
  const clearBusHistory = useAutumnStore((s) => s.clearBusHistory);
  const removeBusHistoryEntry = useAutumnStore((s) => s.removeBusHistoryEntry);

  const edge = edgeId ? edges.find((e) => e.id === edgeId) : null;
  const sourceNode = edge ? nodes.find((n) => n.id === edge.source) : null;
  const targetNode = edge ? nodes.find((n) => n.id === edge.target) : null;
  const sourcePersona = sourceNode
    ? PERSONA_BY_ID[(sourceNode.data as { personaId?: string }).personaId ?? ""]
    : null;
  const targetPersona = targetNode
    ? PERSONA_BY_ID[(targetNode.data as { personaId?: string }).personaId ?? ""]
    : null;
  const messages = edgeId
    ? busHistory.filter((p) => p.edgeId === edgeId)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur-md border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cable className="size-4 text-violet-400" />
            <span>Bus edge inspector</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            All <code className="text-violet-300">message_peer</code> packets that have
            flowed along this bus edge.
          </DialogDescription>
        </DialogHeader>

        {!edge ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Edge not found.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Edge summary card */}
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div
                    className="size-8 rounded-md flex items-center justify-center text-white text-xs font-bold shadow"
                    style={{ background: sourcePersona?.color ?? "#888" }}
                  >
                    {sourcePersona?.glyph ?? "?"}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{sourceNode?.name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">source</div>
                  </div>
                </div>
                <div className="flex flex-col items-center text-violet-400/80">
                  <ArrowRight className="size-4" />
                  <span className="text-[9px] uppercase tracking-wider mt-0.5">bus</span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="size-8 rounded-md flex items-center justify-center text-white text-xs font-bold shadow"
                    style={{ background: targetPersona?.color ?? "#888" }}
                  >
                    {targetPersona?.glyph ?? "?"}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{targetNode?.name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">target</div>
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-1.5 border-violet-500/30 text-violet-300"
                  >
                    {messages.length} msg{messages.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    <code className="text-[9px]">{edge.id.slice(0, 12)}</code>
                  </Badge>
                </div>
              </div>
            </div>

            {/* Direction stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400">
                  <ArrowUpFromLine className="size-3" />
                  Source → Target
                </div>
                <div className="text-lg font-semibold text-emerald-300">
                  {messages.filter((m) => m.fromNodeId === edge.source).length}
                </div>
              </div>
              <div className="rounded-md bg-sky-500/5 border border-sky-500/20 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-400">
                  <ArrowDownToLine className="size-3" />
                  Target → Source
                </div>
                <div className="text-lg font-semibold text-sky-300">
                  {messages.filter((m) => m.fromNodeId === edge.target).length}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto autumn-scroll">
              {messages.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground empty-cta rounded-lg">
                  <div className="font-medium text-foreground/80 mb-1">No messages yet</div>
                  <div className="text-[10px]">
                    Send a task to {sourceNode?.name ?? "the source"} — when it
                    finishes, its <code className="text-violet-300">message_peer</code> handoff
                    will appear here.
                  </div>
                </div>
              ) : (
                [...messages].reverse().map((m) => {
                  const isForward = m.fromNodeId === edge.source;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-lg border p-2.5 space-y-1 group",
                        isForward
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-sky-500/20 bg-sky-500/5",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] h-4 px-1",
                            isForward
                              ? "border-emerald-500/30 text-emerald-300"
                              : "border-sky-500/30 text-sky-300",
                          )}
                        >
                          {isForward ? "→ forward" : "← reverse"}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground ml-auto font-mono timestamp-mono">
                          {new Date(m.ts).toLocaleTimeString()}
                        </span>
                        <button
                          onClick={() => removeBusHistoryEntry(m.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-rose-400 transition-all"
                          aria-label="Remove message"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      <div className="text-xs leading-relaxed whitespace-pre-wrap pl-1 border-l-2 border-violet-500/30">
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={clearBusHistory}
                disabled={messages.length === 0}
              >
                <Trash2 className="size-3" />
                Clear all bus history
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
