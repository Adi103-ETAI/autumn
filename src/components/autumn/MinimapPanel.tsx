// Autumn — MinimapPanel (Pixel-perfect match to Autumn Reference Screenshot).
// Custom high-fidelity spatial canvas minimap:
// 1. Guaranteed visibility & accurate mirroring of every active canvas node.
// 2. Real-time centered viewfinder frustum tracking live canvas viewport.
// 3. Interactive click & drag to pan the canvas anywhere.
// 4. Sleek bottom control bar: [ Map ] [ LayoutGrid ] [ Maximize2 ]  |  [ - ] [ 66% ] [ + ]

"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import type { NodeKind, AutumnNode } from "@/lib/autumn/types";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
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
const MAP_WIDTH = 204;
const MAP_HEIGHT = 130;
const PADDING = 140; // World coordinate padding

// Approximate standard node sizes in Autumn canvas space
const NODE_DIMENSIONS: Record<NodeKind, { w: number; h: number }> = {
  chat: { w: 360, h: 460 },
  terminal: { w: 480, h: 360 },
  youtube: { w: 480, h: 400 },
  sticky: { w: 240, h: 200 },
  screen: { w: 280, h: 520 },
  analytics: { w: 320, h: 260 },
  remotion: { w: 320, h: 260 },
};

// Exact colors matching Autumn reference screenshot
const AUTUMN_NODE_COLORS: Record<NodeKind, string> = {
  chat: "#a855f7",     // Violet/purple for AI agents (Atlas, Orion)
  terminal: "#22c55e", // Bright neon green for Apollo / Terminal
  youtube: "#8b5cf6",  // Purple for Browser / YouTube
  sticky: "#fbbf24",   // Warm amber/yellow for Sticky notes
  screen: "#38bdf8",   // Sky blue for Mobile / Screens
  analytics: "#f97316",// Orange for Analytics
  remotion: "#6366f1", // Indigo for Video editor
};

// One-character glyphs rendered inside each node rect in the minimap
const NODE_GLYPHS: Record<NodeKind, string> = {
  chat: "◈",
  terminal: ">_",
  youtube: "▶",
  sticky: "✎",
  screen: "▣",
  analytics: "▨",
  remotion: "⬡",
};

const STICKY_HEX: Record<string, string> = {
  amber: "#fbbf24",
  rose: "#f43f5e",
  emerald: "#10b981",
  violet: "#a855f7",
  cyan: "#06b6d4",
};

function getNodeFillColor(n: AutumnNode): string {
  const kind = n.kind;
  if (kind === "chat") {
    const personaId = (n.data as { personaId?: string } | undefined)?.personaId;
    const persona = personaId ? PERSONA_BY_ID[personaId] : undefined;
    return persona?.color ?? AUTUMN_NODE_COLORS.chat;
  }
  if (kind === "sticky") {
    const color = (n.data as { color?: string } | undefined)?.color;
    return (color && STICKY_HEX[color]) ?? AUTUMN_NODE_COLORS.sticky;
  }
  return AUTUMN_NODE_COLORS[kind] ?? "#71717a";
}

export function MinimapPanel() {
  const { zoomIn, zoomOut, fitView, setViewport, setCenter } = useReactFlow();
  const viewport = useViewport();
  const zoom = viewport.zoom ?? 1;
  const vpX = viewport.x ?? 0;
  const vpY = viewport.y ?? 0;

  const nodes = useAutumnStore((s) => s.nodes);
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);

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

  // ── Spatial coordinate projection ──────────────────────────────────────────
  // Current screen viewport in world canvas space
  const vpWidthWorld = windowSize.w / zoom;
  const vpHeightWorld = windowSize.h / zoom;
  const vpLeftWorld = -vpX / zoom;
  const vpTopWorld = -vpY / zoom;

  // Calculate world bounding box containing all nodes + the viewport
  let minX = vpLeftWorld;
  let maxX = vpLeftWorld + vpWidthWorld;
  let minY = vpTopWorld;
  let maxY = vpTopWorld + vpHeightWorld;

  for (const n of nodes) {
    const dims = NODE_DIMENSIONS[n.kind] || { w: 320, h: 240 };
    minX = Math.min(minX, n.position.x);
    maxX = Math.max(maxX, n.position.x + dims.w);
    minY = Math.min(minY, n.position.y);
    maxY = Math.max(maxY, n.position.y + dims.h);
  }

  // Add padding around world
  minX -= PADDING;
  maxX += PADDING;
  minY -= PADDING;
  maxY += PADDING;

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
              className="relative rounded-lg border border-white/10 bg-[#121215]/95 backdrop-blur-md shadow-2xl overflow-hidden cursor-crosshair"
              style={{
                width: `${MAP_WIDTH}px`,
                height: `${MAP_HEIGHT}px`,
                boxShadow:
                  "0 12px 32px -4px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)",
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
                    <circle cx="2" cy="2" r="0.6" fill="rgba(255,255,255,0.06)" />
                  </pattern>
                </defs>
                <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0d0d11" />
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

                {/* Render All Active Canvas Nodes */}
                {nodes.map((n) => {
                  const dims = NODE_DIMENSIONS[n.kind] || { w: 320, h: 240 };
                  const nx = toMapX(n.position.x);
                  const ny = toMapY(n.position.y);
                  const nw = Math.max(6, dims.w * scale);
                  const nh = Math.max(5, dims.h * scale);
                  const color = getNodeFillColor(n);
                  const glyph = NODE_GLYPHS[n.kind] ?? "◻";

                  return (
                    <g key={n.id}>
                      {/* Node body */}
                      <rect
                        x={nx}
                        y={ny}
                        width={nw}
                        height={nh}
                        rx={2.5}
                        fill={color}
                        fillOpacity={0.88}
                        stroke="rgba(255, 255, 255, 0.22)"
                        strokeWidth={0.75}
                      />
                      {/* Subtle header stripe */}
                      <rect
                        x={nx}
                        y={ny}
                        width={nw}
                        height={Math.min(3.5, nh * 0.18)}
                        rx={2.5}
                        fill="rgba(255,255,255,0.18)"
                      />
                      {/* Node glyph if big enough */}
                      {nw > 14 && nh > 12 && (
                        <text
                          x={nx + nw / 2}
                          y={ny + nh / 2 + 1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={Math.min(8, nw * 0.35)}
                          fill="rgba(255,255,255,0.55)"
                          fontFamily="system-ui, sans-serif"
                        >
                          {glyph}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Viewport Camera Frustum (Viewfinder) */}
                <rect
                  x={vfX}
                  y={vfY}
                  width={vfW}
                  height={vfH}
                  rx={3}
                  fill="rgba(59, 130, 246, 0.1)"
                  stroke="rgba(99, 179, 255, 0.8)"
                  strokeWidth={1.5}
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

