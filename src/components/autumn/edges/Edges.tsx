// Autumn — custom edge components.
// - BusEdge: animated dashed line with optional pulse circles flowing along it.
// - NavigationEdge: solid thin line for screen→screen nav links.

"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";

export function BusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const pulses = useAutumnStore((s) => s.pulses);
  const myPulses = pulses.filter((p) => p.edgeId === id);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "oklch(0.78 0.18 55)" : "oklch(0.6 0.08 55 / 0.55)",
          strokeWidth: selected ? 2.5 : 1.8,
        }}
      />
      {/* Animated overlay */}
      <path
        d={edgePath}
        fill="none"
        className="bus-edge-flow"
        style={{
          stroke: "oklch(0.78 0.18 55 / 0.8)",
          strokeWidth: 1.5,
        }}
      />
      {/* Pulses */}
      {myPulses.map((p) => (
        <PulseCircle
          key={p.id}
          edgeId={id}
          sourceX={sourceX}
          sourceY={sourceY}
          targetX={targetX}
          targetY={targetY}
          toTarget={p.toNodeId === target}
          text={p.text}
        />
      ))}
      <EdgeLabelRenderer>
        <button
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-300/90 nodrag nopan hover:bg-amber-500/30 hover:border-amber-500/50 hover:scale-110 transition-all cursor-pointer"
          onDoubleClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("autumn:inspect-edge", { detail: { id } }),
            );
          }}
          title="Double-click to inspect bus traffic"
        >
          {(data as { label?: string })?.label ?? "bus"}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

function PulseCircle({
  edgeId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  toTarget,
  text,
}: {
  edgeId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  toTarget: boolean;
  text: string;
}) {
  const fromX = toTarget ? sourceX : targetX;
  const fromY = toTarget ? sourceY : targetY;
  const toX = toTarget ? targetX : sourceX;
  const toY = toTarget ? targetY : sourceY;

  return (
    <EdgeLabelRenderer>
      <div
        key={edgeId + "-pulse-" + Math.random()}
        className="pointer-events-none absolute"
        style={{
          left: fromX,
          top: fromY,
          animation: "pulse-along 3s linear forwards",
          // animate via CSS custom props
          ["--to-x" as string]: `${toX - fromX}px`,
          ["--to-y" as string]: `${toY - fromY}px`,
        }}
      >
        <style>{`
          @keyframes pulse-along {
            0% { transform: translate(0,0); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translate(var(--to-x), var(--to-y)); opacity: 0; }
          }
        `}</style>
        <div className="flex items-center gap-1 rounded-full bg-amber-500/90 border border-amber-300 px-2 py-0.5 shadow-lg shadow-amber-500/40 -translate-x-1/2 -translate-y-1/2 max-w-[180px]">
          <span className="size-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-[9px] font-medium text-amber-950 truncate">
            {text.slice(0, 40)}
          </span>
        </div>
      </div>
    </EdgeLabelRenderer>
  );
}

export function NavigationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "oklch(0.7 0.1 200)" : "oklch(0.5 0.05 200 / 0.5)",
          strokeWidth: 1.2,
          strokeDasharray: "2 4",
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "none",
          }}
          className="rounded-full bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-sky-300/90 nodrag nopan"
        >
          nav
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
