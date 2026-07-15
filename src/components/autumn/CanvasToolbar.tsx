// Autumn — Floating canvas toolbar.
// Bottom-center overlay on the canvas with quick actions: arrange, fit, clear,
// live node/edge counter, zoom level, and multi-select bulk actions.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Search,
  ZoomIn,
  Copy,
} from "lucide-react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { NodeKind } from "@/lib/autumn/types";

export function CanvasToolbar() {
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const addNode = useAutumnStore((s) => s.addNode);
  const nodeCount = useAutumnStore((s) => s.nodes.length);
  const edgeCount = useAutumnStore((s) => s.edges.length);
  const selectedNodeIds = useAutumnStore((s) => s.selectedNodeIds);
  const removeNodes = useAutumnStore((s) => s.removeNodes);
  const duplicateNode = useAutumnStore((s) => s.duplicateNode);
  const clearSelection = useAutumnStore((s) => s.clearSelection);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const { fitView } = useReactFlow();
  // Subscribe to the react-flow viewport transform for a reactive zoom reading.
  const zoom = useStore((s) => s.transform[2]);

  const hasMulti = selectedNodeIds.length > 0;
  const zoomPct = Math.round(zoom * 100);

  return (
    <TooltipProvider delayDuration={200}>
      <ZoomChip />
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
            label="Search nodes (⌘F)"
            onClick={() => setShowNodeSearch(true)}
            icon={Search}
            color="text-emerald-400"
          />
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

        {/* Multi-select bulk actions (only shown when something is selected) */}
        {hasMulti && (
          <div className="flex items-center gap-0.5 px-1 border-r border-border/40 fade-in-up">
            <div className="px-1.5 flex items-center gap-1 text-[10px] text-sky-400">
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[9px] border-sky-400/40 text-sky-300"
              >
                {selectedNodeIds.length} selected
              </Badge>
            </div>
            <ToolbarButton
              label="Duplicate all selected"
              onClick={() => {
                // Duplicate each in order; the store returns new ids.
                const store = useAutumnStore.getState();
                const ids = [...store.selectedNodeIds];
                ids.forEach((id) => store.duplicateNode(id));
              }}
              icon={Copy}
              color="text-amber-300"
            />
            <ToolbarButton
              label="Remove all selected"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${selectedNodeIds.length} selected node${
                      selectedNodeIds.length === 1 ? "" : "s"
                    }?`,
                  )
                ) {
                  removeNodes(selectedNodeIds);
                }
              }}
              icon={Trash2}
              color="text-rose-400"
            />
            <ToolbarButton
              label="Clear selection"
              onClick={clearSelection}
              icon={Maximize2}
              color="text-muted-foreground"
            />
          </div>
        )}

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

        {/* Stats + zoom */}
        <div className="flex items-center gap-2 pl-2 pr-1 border-l border-border/40 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-fuchsia-400" />
            {nodeCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-400" />
            {edgeCount}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px]">
            <ZoomIn className="size-2.5 text-muted-foreground/70" />
            {zoomPct}%
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

// ZoomChip — small bottom-left chip that shows the current zoom level as a
// percentage. Click to reset to 100%. Reactively subscribes to the react-flow
// viewport transform so it updates the moment the user zooms.
function ZoomChip() {
  const zoom = useStore((s) => s.transform[2]);
  const { zoomTo } = useReactFlow();
  const zoomPct = Math.round(zoom * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => zoomTo(1, { duration: 300 })}
          className="chip-zoom-reset absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full border border-border/50 bg-card/80 backdrop-blur-md px-2.5 py-1 font-mono text-[10px] text-muted-foreground shadow-lg hover:border-amber-500/50 hover:text-amber-300"
          aria-label={`Zoom: ${zoomPct}%. Click to reset to 100%`}
        >
          <ZoomIn className="size-2.5" />
          <span>{zoomPct}%</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Reset to 100%
      </TooltipContent>
    </Tooltip>
  );
}

// Re-export for type usage
export type { NodeKind };
