// Autumn — Floating canvas toolbar (bottom dock).
// Quick actions: add agent/screen/note/terminal/browser/video, search,
// select-all, arrange, fit view, background picker, multi-select bulk
// actions, and clear canvas. Zoom controls live in the MinimapPanel.

"use client";

import { useState, useEffect, useRef } from "react";
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
  MonitorSmartphone,
  StickyNote,
  Search,
  Copy,
  CheckSquare,
  ChevronDown,
  TerminalSquare,
  Globe,
  Clapperboard,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import type { NodeKind } from "@/lib/autumn/types";
import { QuickSpawnMenu } from "./QuickSpawnMenu";
import { BackgroundPicker } from "./BackgroundPicker";

export function CanvasToolbar() {
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const addNode = useAutumnStore((s) => s.addNode);
  const selectedNodeIds = useAutumnStore((s) => s.selectedNodeIds);
  const removeNodes = useAutumnStore((s) => s.removeNodes);
  const clearSelection = useAutumnStore((s) => s.clearSelection);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const selectAllNodes = useAutumnStore((s) => s.selectAllNodes);
  const { fitView } = useReactFlow();

  // QuickSpawnMenu open state
  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const spawnRef = useRef<HTMLDivElement>(null);

  // Close spawn menu on outside click
  useEffect(() => {
    if (!spawnMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (spawnRef.current && !spawnRef.current.contains(e.target as Node)) {
        setSpawnMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSpawnMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [spawnMenuOpen]);

  const hasMulti = selectedNodeIds.length > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border border-border/40 bg-card/70 backdrop-blur-xl px-2 py-1.5 shadow-2xl" style={{ boxShadow: "0 8px 32px -8px oklch(0.78 0.18 55 / 0.1), 0 0 0 1px oklch(0.78 0.18 55 / 0.06)" }}>
        {/* Quick add — agent button triggers QuickSpawnMenu */}
        <div className="flex items-center gap-0.5 pr-1 border-r border-border/40" ref={spawnRef}>
          <div className="relative">
            <ToolbarButton
              label="Add agent"
              onClick={() => setSpawnMenuOpen((v) => !v)}
              icon={Bot}
              color="text-fuchsia-400"
              extraElement={
                <ChevronDown className="size-2.5 text-fuchsia-400/70" />
              }
            />
            <QuickSpawnMenu
              open={spawnMenuOpen}
              onClose={() => setSpawnMenuOpen(false)}
            />
          </div>
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
          <ToolbarButton
            label="Add terminal"
            onClick={() => addNode({ kind: "terminal" })}
            icon={TerminalSquare}
            color="text-emerald-400"
          />
          <ToolbarButton
            label="Add browser"
            onClick={() => addNode({ kind: "youtube" })}
            icon={Globe}
            color="text-amber-400"
          />
          <ToolbarButton
            label="Add video"
            onClick={() => addNode({ kind: "remotion" })}
            icon={Clapperboard}
            color="text-blue-400"
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
