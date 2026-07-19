// Autumn — Floating canvas toolbar (bottom dock).
// Quick actions: add agent/screen/note/terminal/browser/video, search,
// select-all, arrange, fit view, background picker, multi-select bulk
// actions, and clear canvas. Zoom controls live in the MinimapPanel.

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
  Bot,
  SquareTerminal,
  Monitor,
  StickyNote,
  Compass,
  Clapperboard,
  Search,
  Copy,
  CheckSquare,
  ChevronDown,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import type { NodeKind } from "@/lib/autumn/types";
import { BackgroundPicker } from "./BackgroundPicker";
import { AgentPickerPanel } from "./AgentPickerPanel";
import { cn } from "@/lib/utils";

export function CanvasToolbar() {
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const addNode = useAutumnStore((s) => s.addNode);
  const selectedNodeIds = useAutumnStore((s) => s.selectedNodeIds);
  const removeNodes = useAutumnStore((s) => s.removeNodes);
  const clearSelection = useAutumnStore((s) => s.clearSelection);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const selectAllNodes = useAutumnStore((s) => s.selectAllNodes);
  const agentPickerOpen = useAutumnStore((s) => s.agentPickerOpen);
  const setAgentPickerOpen = useAutumnStore((s) => s.setAgentPickerOpen);
  const { fitView } = useReactFlow();

  const hasMulti = selectedNodeIds.length > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border border-border/40 bg-card/70 backdrop-blur-xl px-2 py-1.5 shadow-2xl" style={{ boxShadow: "0 8px 32px -8px oklch(0.78 0.18 55 / 0.1), 0 0 0 1px oklch(0.78 0.18 55 / 0.06)" }}>
        {/* Quick add — colorful app-tile icons (macOS/October dock style) */}
        <div className="flex items-center gap-1.5 pr-2 border-r border-border/40">
          <AppTile
            label="Add agent"
            onClick={() => setAgentPickerOpen(!agentPickerOpen)}
            icon={Bot}
            tile="from-fuchsia-500 to-purple-600"
            glow="rgba(217,70,239,0.45)"
            badge={
              <ChevronDown className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-card border border-border/60 text-fuchsia-300" />
            }
          />
          <AgentPickerPanel
            open={agentPickerOpen}
            onClose={() => setAgentPickerOpen(false)}
          />
          <AppTile
            label="Add terminal"
            onClick={() => addNode({ kind: "terminal" })}
            icon={SquareTerminal}
            tile="from-slate-700 to-slate-900"
            glow="rgba(16,185,129,0.40)"
          />
          <AppTile
            label="Add browser"
            onClick={() => addNode({ kind: "youtube" })}
            icon={Compass}
            tile="from-cyan-400 to-blue-500"
            glow="rgba(34,211,238,0.45)"
          />
          <AppTile
            label="Add screen"
            onClick={() => addNode({ kind: "screen" })}
            icon={Monitor}
            tile="from-sky-400 to-blue-600"
            glow="rgba(56,189,248,0.45)"
          />
          <AppTile
            label="Add note"
            onClick={() => addNode({ kind: "sticky" })}
            icon={StickyNote}
            tile="from-amber-300 to-yellow-500"
            glow="rgba(251,191,36,0.45)"
          />
          <AppTile
            label="Add video"
            onClick={() => addNode({ kind: "remotion" })}
            icon={Clapperboard}
            tile="from-violet-500 to-fuchsia-600"
            glow="rgba(139,92,246,0.45)"
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
            label="Select all (⌘A)"
            onClick={selectAllNodes}
            icon={CheckSquare}
            color="text-sky-400"
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
            color="text-amber-400"
          />
          {/* Scenic background picker */}
          <BackgroundPicker />
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
      </div>
    </TooltipProvider>
  );
}

function ToolbarButton({
  label,
  onClick,
  icon: Icon,
  color,
  extraElement,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  extraElement?: React.ReactNode;
}) {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full hover:bg-accent/60 transition-colors"
          onClick={onClick}
        >
          <Icon className={`size-4 ${color}`} />
          {extraElement}
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

// AppTile — colorful gradient app-icon tile for the bottom dock's quick-add
// group (macOS/October dock aesthetic). Bold white icon on a per-tool gradient
// with a glossy top highlight and soft colored glow on hover.
function AppTile({
  label,
  onClick,
  icon: Icon,
  tile,
  glow,
  badge,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  tile: string;
  glow: string;
  badge?: React.ReactNode;
}) {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "dock-app-tile group relative flex size-9 items-center justify-center rounded-xl",
            "bg-gradient-to-br shadow-md shadow-black/30",
            "ring-1 ring-inset ring-white/15",
            "transition-all duration-200",
            "hover:scale-110 hover:shadow-lg hover:brightness-110",
            "active:scale-95",
            tile,
          )}
          style={{ ["--tile-glow" as string]: glow } as React.CSSProperties}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/25 to-transparent"
          />
          <Icon className="relative size-4 text-white drop-shadow-sm" />
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
