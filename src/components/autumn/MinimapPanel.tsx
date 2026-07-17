// Autumn — MinimapPanel.
// Bottom-right overlay stacked UNDER the minimap: a compact zoom control bar
// (- / percentage / + / fit) and a screen-count badge. Mirrors the October
// Desktop layout where zoom + screen indicator sit directly below the minimap.

"use client";

import { useReactFlow, useStore } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { MonitorSmartphone, Minus, Plus, Maximize2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MinimapPanel() {
  // Reactive zoom level from the react-flow viewport transform.
  const zoom = useStore((s) => s.transform[2]);
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const zoomPct = Math.round(zoom * 100);

  // Count screen-kind nodes for the badge.
  const screenCount = useAutumnStore(
    (s) => s.nodes.filter((n) => n.kind === "screen").length,
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 right-4 z-10 flex w-[150px] flex-col gap-1.5">
        {/* Zoom control bar — sits directly below the minimap */}
        <div
          className="flex items-center justify-between gap-0.5 rounded-lg border border-border/50 bg-card/80 px-1 py-1 shadow-lg backdrop-blur-xl"
          style={{
            boxShadow:
              "0 4px 16px -4px oklch(0.78 0.18 55 / 0.12), 0 0 0 1px oklch(0.78 0.18 55 / 0.05)",
          }}
        >
          <ZoomBtn
            label="Zoom out"
            onClick={() => zoomOut({ duration: 250 })}
            icon={Minus}
          />
          <button
            type="button"
            onClick={() => zoomTo(1, { duration: 300 })}
            className="flex-1 rounded-md px-1 py-0.5 text-center font-mono text-[11px] tabular-nums text-foreground/80 transition-colors hover:bg-accent/60"
            aria-label={`Zoom: ${zoomPct}%. Click to reset to 100%`}
          >
            {zoomPct}%
          </button>
          <ZoomBtn
            label="Zoom in"
            onClick={() => zoomIn({ duration: 250 })}
            icon={Plus}
          />
          <div className="mx-0.5 h-4 w-px bg-border/50" />
          <ZoomBtn
            label="Fit view"
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
            icon={Maximize2}
          />
        </div>

        {/* Screen count badge — sits below the zoom bar */}
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-card/80 px-2 py-1 shadow-lg backdrop-blur-xl">
          <MonitorSmartphone className="size-3 text-sky-400" />
          <span className="text-[11px] font-medium tabular-nums text-foreground/80">
            {screenCount} {screenCount === 1 ? "screen" : "screens"}
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ZoomBtn({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Tooltip side="left">
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors",
            "hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
