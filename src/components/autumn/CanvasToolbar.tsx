// Autumn — Floating canvas toolbar.
// Bottom-center overlay on the canvas with quick actions: arrange, fit, clear,
// and a live node/edge counter.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutGrid,
  Maximize2,
  Trash2,
  Plus,
  Bot,
  MonitorSmartphone,
  StickyNote,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import type { NodeKind } from "@/lib/autumn/types";

export function CanvasToolbar() {
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const addNode = useAutumnStore((s) => s.addNode);
  const nodeCount = useAutumnStore((s) => s.nodes.length);
  const edgeCount = useAutumnStore((s) => s.edges.length);
  const fitView = useReactFlow().fitView;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-xl border border-border/50 bg-card/80 backdrop-blur-md px-1.5 py-1 shadow-2xl">
        {/* Quick add */}
        <div className="flex items-center gap-0.5 pr-1 border-r border-border/40">
          <ToolbarButton
            label="Add agent"
            onClick={() => addNode({ kind: "chat" })}
            icon={Bot}
            color="text-fuchsia-400"
          />
          <ToolbarButton
            label="Add screen"
            onClick={() => addNode({ kind: "screen" })}
            icon={MonitorSmartphone}
            color="text-sky-400"
          />
          <ToolbarButton
            label="Add note"
            onClick={() => addNode({ kind: "sticky" })}
            icon={StickyNote}
            color="text-amber-400"
          />
        </div>

        {/* Canvas actions */}
        <div className="flex items-center gap-0.5 px-1 border-r border-border/40">
          <ToolbarButton
            label="Arrange nodes"
            onClick={arrangeNodes}
            icon={LayoutGrid}
            color="text-emerald-400"
          />
          <ToolbarButton
            label="Fit view"
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
            icon={Maximize2}
            color="text-violet-400"
          />
        </div>

        {/* Danger */}
        <div className="flex items-center gap-0.5 pl-1">
          <ToolbarButton
            label="Clear canvas"
            onClick={() => {
              if (
                window.confirm(
                  "Clear all nodes and edges from the canvas? This cannot be undone.",
                )
              ) {
                clearCanvas();
              }
            }}
            icon={Trash2}
            color="text-rose-400"
          />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 pl-2 pr-1 border-l border-border/40 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-fuchsia-400" />
            {nodeCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-400" />
            {edgeCount}
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ToolbarButton({
  label,
  onClick,
  icon: Icon,
  color,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg hover:bg-accent/60 transition-colors"
          onClick={onClick}
        >
          <Icon className={`size-4 ${color}`} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// Re-export for type usage
export type { NodeKind };
