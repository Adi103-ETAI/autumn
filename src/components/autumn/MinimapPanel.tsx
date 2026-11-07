// Autumn — spatial canvas minimap.
// Custom high-fidelity spatial canvas minimap:
// 1. Guaranteed visibility & accurate mirroring of every active canvas node.
// 2. Stable projection anchored to the node bounding box (no "swimming" while
//    panning); it only re-anchors when nodes move or the viewport escapes.
// 3. Interactive click & drag to pan the canvas anywhere.
// 4. Sleek bottom control bar: [ Map ] [ LayoutGrid ] [ Maximize2 ]  |  [ - ] [ 66% ] [ + ]

"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { useReactFlow, useViewport, useStore } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { useAutumnStore } from "@/lib/autumn/store";
import type { NodeKind, AutumnNode } from "@/lib/autumn/types";
import {
  Map as MapIcon,
  LayoutGrid,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// Minimap Dimensions
const MAP_WIDTH = 216;
const MAP_HEIGHT = 136;
const PADDING = 140; // World coordinate padding

// Approximate standard node sizes — fallback only; real measured dimensions
// from the React Flow store take priority so chips mirror true canvas shapes.
const NODE_DIMENSIONS: Record<NodeKind, { w: number; h: number }> = {
  chat: { w: 360, h: 460 },
  terminal: { w: 480, h: 360 },
  youtube: { w: 480, h: 400 },
  sticky: { w: 240, h: 200 },
  screen: { w: 280, h: 520 },
  analytics: { w: 320, h: 260 },
  remotion: { w: 320, h: 260 },
};

// Hardcoded chip colors per node kind
const MINIMAP_COLORS: Record<NodeKind, string> = {
  chat: "#ef4444",     // red — all AI agents
  terminal: "#a855f7", // purple — terminal
  youtube: "#f97316",  // orange — browser / YouTube
  sticky: "#fbbf24",   // yellow — notes
  screen: "#38bdf8",   // blue — preview / screens
  analytics: "#f97316",// orange — analytics
  remotion: "#6366f1", // indigo — video editor
};

function getNodeFillColor(n: AutumnNode): string {
  return MINIMAP_COLORS[n.kind] ?? "#71717a";
}

export function MinimapPanel() {
  const { zoomIn, zoomOut, fitView, setViewport, setCenter } = useReactFlow();
  const viewport = useViewport();
  const zoom = viewport.zoom ?? 1;
  const vpX = viewport.x ?? 0;
  const vpY = viewport.y ?? 0;

  const nodes = useAutumnStore((s) => s.nodes);
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);

  // Real measured node dimensions from the React Flow store, keyed by node id.
  // Falls back to NODE_DIMENSIONS for nodes not measured yet.
  const measuredById = useStore(
    useShallow((s) => {
      const map: Record<string, { w?: number; h?: number }> = {};
      s.nodeLookup.forEach((node, id) => {
        if (node.measured?.width != null || node.measured?.height != null) {
          map[id] = { w: node.measured.width, h: node.measured.height };
        }
      });
      return map;
    }),
  );

  const nodeSize = useCallback(
    (n: AutumnNode) => {
      const m = measuredById[n.id];
      const fallback = NODE_DIMENSIONS[n.kind] || { w: 320, h: 240 };
      return { w: m?.w ?? fallback.w, h: m?.h ?? fallback.h };
    },
    [measuredById],
  );

  // Floating minimap preview box state (open by default, toggleable via Map icon)
  const [isOpen, setIsOpen] = useState(true);
  const [windowSize, setWindowSize] = useState({ w: 1440, h: 900 });
  const isDraggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Track window size for viewport frustum projection
  useEffect(() => {
    const updateSize = () => {
      setWindowSize({ w: window.innerWidth || 1440, h: window.innerHeight || 900 });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Absolute zoom percentage readout (e.g. "66%")
  const zoomPercentage = Math.round(zoom * 100);

  // Reset zoom to 100% on percentage label click
  const handleResetZoom = useCallback(() => {
    setViewport({ x: vpX, y: vpY, zoom: 1 }, { duration: 250 });
  }, [setViewport, vpX, vpY]);

  // Handle auto-arrange layout
  const handleAutoArrange = useCallback(() => {
    arrangeNodes();
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 400 });
    }, 80);
    toast.success("Auto-arranged canvas layout");
  }, [arrangeNodes, fitView]);

  // ── Stable spatial coordinate projection ───────────────────────────────────
  // Current screen viewport in world canvas space
  const vpWidthWorld = windowSize.w / zoom;
  const vpHeightWorld = windowSize.h / zoom;
  const vpLeftWorld = -vpX / zoom;
  const vpTopWorld = -vpY / zoom;

  // Selected canvas nodes (for highlight chips in the map)
  const selectedIds = useStore(
    useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => n.id)),
  );

  // The map is anchored to the nodes' bounding box so it stays still while
  // panning. It only grows to include the viewport when the frustum escapes
  // the node region, and re-anchors once the viewport fits the nodes again.
  const nodeBounds = useMemo<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(() => {
    if (nodes.length === 0) return null;
    let nMinX = Infinity;
    let nMinY = Infinity;
    let nMaxX = -Infinity;
    let nMaxY = -Infinity;
    for (const n of nodes) {
      const dims = nodeSize(n);
      nMinX = Math.min(nMinX, n.position.x);
      nMaxX = Math.max(nMaxX, n.position.x + dims.w);
      nMinY = Math.min(nMinY, n.position.y);
      nMaxY = Math.max(nMaxY, n.position.y + dims.h);
    }
    return {
      minX: nMinX - PADDING,
      minY: nMinY - PADDING,
      maxX: nMaxX + PADDING,
      maxY: nMaxY + PADDING,
    };
  }, [nodes, nodeSize]);

  const vpRightWorld = vpLeftWorld + vpWidthWorld;
  const vpBottomWorld = vpTopWorld + vpHeightWorld;

  const bounds =
    nodeBounds === null
      ? // Empty canvas: frame just the viewport with padding
        {
          minX: vpLeftWorld - PADDING,
          minY: vpTopWorld - PADDING,
          maxX: vpRightWorld + PADDING,
          maxY: vpBottomWorld + PADDING,
        }
      : vpLeftWorld >= nodeBounds.minX &&
          vpTopWorld >= nodeBounds.minY &&
          vpRightWorld <= nodeBounds.maxX &&
          vpBottomWorld <= nodeBounds.maxY
        ? // Viewport inside the node region — anchor the map to the nodes
          nodeBounds
        : // Viewport escaped — expand the frame to include it
          {
            minX: Math.min(nodeBounds.minX, vpLeftWorld),
            minY: Math.min(nodeBounds.minY, vpTopWorld),
            maxX: Math.max(nodeBounds.maxX, vpRightWorld),
            maxY: Math.max(nodeBounds.maxY, vpBottomWorld),
          };

  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minY = bounds.minY;
  const maxY = bounds.maxY;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);

  // Uniform scale to fit within MAP_WIDTH × MAP_HEIGHT
  const scale = Math.min(MAP_WIDTH / worldW, MAP_HEIGHT / worldH);
  const offsetX = (MAP_WIDTH - worldW * scale) / 2;
  const offsetY = (MAP_HEIGHT - worldH * scale) / 2;

  // Transform world (wx, wy) to SVG coordinate (mx, my)
  const toMapX = useCallback(
    (wx: number) => offsetX + (wx - minX) * scale,
    [offsetX, minX, scale],
  );
  const toMapY = useCallback(
    (wy: number) => offsetY + (wy - minY) * scale,
    [offsetY, minY, scale],
  );

  // Transform SVG coordinate (mx, my) back to world (wx, wy)
  const toWorldX = useCallback(
    (mx: number) => minX + (mx - offsetX) / scale,
    [minX, offsetX, scale],
  );
  const toWorldY = useCallback(
    (my: number) => minY + (my - offsetY) / scale,
    [minY, offsetY, scale],
  );

  // Interactive pan on click / drag inside minimap
  const panToSvgPoint = useCallback(
    (clientX: number, clientY: number, smooth = true) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const clickY = clientY - rect.top;

      const targetWorldX = toWorldX(clickX);
      const targetWorldY = toWorldY(clickY);

      setCenter(targetWorldX, targetWorldY, {
        zoom,
        duration: smooth ? 250 : 0,
      });
    },
    [toWorldX, toWorldY, setCenter, zoom],
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    panToSvgPoint(e.clientX, e.clientY, true);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    panToSvgPoint(e.clientX, e.clientY, false);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Viewfinder bounding coordinates
  const vfX = toMapX(vpLeftWorld);
  const vfY = toMapY(vpTopWorld);
  const vfW = Math.max(8, vpWidthWorld * scale);
  const vfH = Math.max(8, vpHeightWorld * scale);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2 select-none pointer-events-auto">
        {/* Floating Minimap Box — directly mirrors all active canvas nodes */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="relative rounded-xl border border-white/10 bg-[#101014]/90 backdrop-blur-md overflow-hidden cursor-crosshair"
              style={{
                width: `${MAP_WIDTH}px`,
                height: `${MAP_HEIGHT}px`,
                boxShadow:
                  "0 16px 40px -8px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06)",
              }}
            >
              <svg
                ref={svgRef}
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="w-full h-full block select-none touch-none"
              >
                {/* Background */}
                <defs>
                  <pattern
                    id="minimap-grid"
                    width="12"
                    height="12"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="2" cy="2" r="0.6" fill="rgba(255,255,255,0.045)" />
                  </pattern>
                </defs>
                <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0b0b0f" />
                <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#minimap-grid)" />

                {/* Empty canvas hint */}
                {nodes.length === 0 && (
                  <text
                    x={MAP_WIDTH / 2}
                    y={MAP_HEIGHT / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="10"
                    fill="rgba(255,255,255,0.2)"
                    fontFamily="system-ui, sans-serif"
                  >
                    No nodes yet
                  </text>
                )}

                {/* Render All Active Canvas Nodes — muted accent chips.
                    Chip width/height mirror the node's real canvas size. */}
                {nodes.map((n) => {
                  const dims = nodeSize(n);
                  const nx = toMapX(n.position.x);
                  const ny = toMapY(n.position.y);
                  const nw = Math.max(6, dims.w * scale);
                  const nh = Math.max(5, dims.h * scale);
                  const color = getNodeFillColor(n);
                  const isSelected = selectedIds.includes(n.id);

                  return (
                    <rect
                      key={n.id}
                      x={nx}
                      y={ny}
                      width={nw}
                      height={nh}
                      rx={3}
                      fill={color}
                      fillOpacity={isSelected ? 0.4 : 0.18}
                      stroke={color}
                      strokeOpacity={isSelected ? 0.95 : 0.55}
                      strokeWidth={isSelected ? 1.4 : 1}
                    />
                  );
                })}

                {/* Viewport Camera Frustum (Viewfinder) */}
                <rect
                  x={vfX}
                  y={vfY}
                  width={vfW}
                  height={vfH}
                  rx={4}
                  fill="rgba(255, 255, 255, 0.05)"
                  stroke="rgba(255, 255, 255, 0.7)"
                  strokeWidth={1.25}
                  strokeDasharray="0"
                />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Control Bar: [ Map ] [ LayoutGrid ] [ Maximize2 ]  |  [ - ] [ 66% ] [ + ] */}
        <div
          className="flex h-9 items-center gap-0.5 rounded-lg border border-white/10 bg-[#121215]/90 backdrop-blur-md px-1.5 py-1 shadow-lg"
          style={{
            boxShadow:
              "0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)",
          }}
        >
          {/* Map toggle button */}
          <IconBtn
            label={isOpen ? "Hide minimap" : "Show minimap"}
            onClick={() => setIsOpen(!isOpen)}
            active={isOpen}
          >
            <MapIcon className="size-3.5" />
          </IconBtn>

          {/* Grid / Arrange button */}
          <IconBtn label="Auto-arrange nodes" onClick={handleAutoArrange}>
            <LayoutGrid className="size-3.5" />
          </IconBtn>

          {/* Fit view / Maximize button */}
          <IconBtn
            label="Fit view (⛶)"
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
          >
            <Maximize2 className="size-3.5" />
          </IconBtn>

          {/* Subtle vertical separator */}
          <div className="mx-1 h-3.5 w-[1px] bg-white/10" />

          {/* Zoom Out (-) */}
          <button
            type="button"
            onClick={() => zoomOut({ duration: 200 })}
            aria-label="Zoom out"
            className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors active:scale-95"
          >
            <Minus className="size-3.5" />
          </button>

          {/* Zoom % label (clickable to reset to 100%) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 py-0.5 text-[11px] font-mono font-medium text-zinc-300 hover:text-white hover:bg-white/10 rounded transition-colors tabular-nums min-w-[36px] text-center"
              >
                {zoomPercentage}%
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Zoom: {zoomPercentage}% (Click to reset 100%)
            </TooltipContent>
          </Tooltip>

          {/* Zoom In (+) */}
          <button
            type="button"
            onClick={() => zoomIn({ duration: 200 })}
            aria-label="Zoom in"
            className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors active:scale-95"
          >
            <Plus className="size-3.5" />
          </button>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors",
            "hover:bg-white/10 hover:text-zinc-100",
            active && "bg-white/15 text-zinc-100",
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

