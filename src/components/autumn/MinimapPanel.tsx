// Autumn — MinimapPanel.
// Bottom-right overlay stacked UNDER the minimap. Mirrors the October Desktop
// layout: screen-count badge on TOP, then the minimap (rendered by ReactFlow),
// then a control bar with [grid toggle] [fullscreen] [zoom % slider] [+].
//
// The zoom slider is a real draggable range input bound to the live viewport
// zoom (0.1×–2×). The % label shows the current zoom relative to 100% (so
// 0.42× shows as "-58%", 1.0× shows as "0%", 1.5× shows as "+50%").

"use client";

import { useCallback } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  MonitorSmartphone,
  Plus,
  Maximize2,
  Grid3x3,
  Minus,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ReactFlow's default zoom clamp is [0.1, 2] — we mirror it on the slider.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

export function MinimapPanel() {
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();
  // useViewport subscribes to live zoom changes (scroll, pinch, buttons, slider).
  const viewport = useViewport();
  const zoom = viewport.zoom ?? 1;

  const screenCount = useAutumnStore(
    (s) => s.nodes.filter((n) => n.kind === "screen").length,
  );
  const showGrid = useAutumnStore((s) => s.showGrid);
  const setShowGrid = useAutumnStore((s) => s.setShowGrid);

  // Format zoom as a signed percentage relative to 100%.
  // 0.42× → "-58%", 1.0× → "0%", 1.5× → "+50%".
  const zoomPct = Math.round((zoom - 1) * 100);
  const zoomLabel = `${zoomPct >= 0 ? "+" : ""}${zoomPct}%`;

  // Slider drag → set viewport zoom (keep current x/y pan).
  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      setViewport({ x: viewport.x ?? 0, y: viewport.y ?? 0, zoom: next });
    },
    [setViewport, viewport.x, viewport.y],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 right-4 z-10 flex w-[180px] flex-col gap-1.5">
        {/* Screen count badge — now on TOP (above the minimap), per reference */}
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-card/80 px-2 py-1 shadow-lg backdrop-blur-xl">
          <MonitorSmartphone className="size-3 text-sky-400" />
          <span className="text-[11px] font-medium tabular-nums text-foreground/80">
            {screenCount} {screenCount === 1 ? "screen" : "screens"}
          </span>
        </div>

        {/* Control bar — grid toggle / fullscreen / zoom slider / + */}
        <div
          className="flex items-center gap-1 rounded-lg border border-border/50 bg-card/80 px-1.5 py-1 shadow-lg backdrop-blur-xl"
          style={{
            boxShadow:
              "0 4px 16px -4px oklch(0.78 0.18 55 / 0.12), 0 0 0 1px oklch(0.78 0.18 55 / 0.05)",
          }}
        >
          {/* Grid toggle — actually toggles the dotted canvas background */}
          <IconBtn
            label={showGrid ? "Hide grid" : "Show grid"}
            onClick={() => setShowGrid(!showGrid)}
            active={showGrid}
          >
            <Grid3x3 className="size-3.5" />
          </IconBtn>

          {/* Fullscreen / fit view */}
          <IconBtn
            label="Fit view"
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
          >
            <Maximize2 className="size-3.5" />
          </IconBtn>

          {/* Zoom slider — draggable, shows live % label */}
          <div className="flex flex-1 items-center gap-1 min-w-0">
            <Minus
              className="size-3 shrink-0 text-muted-foreground/70"
              aria-hidden
            />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={onSliderChange}
              aria-label="Zoom level"
              className="autumn-zoom-slider h-1 flex-1 cursor-pointer appearance-none rounded-full bg-muted/60"
            />
            <Plus
              className="size-3 shrink-0 text-muted-foreground/70"
              aria-hidden
            />
          </div>

          {/* Zoom % label */}
          <span className="shrink-0 rounded px-1 text-[10px] font-medium tabular-nums text-foreground/70 min-w-[34px] text-center">
            {zoomLabel}
          </span>

          {/* + button — explicit zoom-in */}
          <IconBtn label="Zoom in" onClick={() => zoomIn({ duration: 250 })}>
            <Plus className="size-3.5" />
          </IconBtn>
        </div>
      </div>
    </TooltipProvider>
  );
}

function IconBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors",
            "hover:bg-accent/60 hover:text-foreground",
            active && "bg-accent/60 text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
