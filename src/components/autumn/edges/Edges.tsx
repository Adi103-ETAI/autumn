// Autumn — custom edge components.
// - BusEdge: animated dashed line with optional pulse circles flowing along it.
//   Supports inline label editing (double-click) and a direction arrow indicator.
// - NavigationEdge: solid thin line for screen→screen nav links.

"use client";

import { useState, useRef, useEffect } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";

// ── Inline label editor for edge labels ──────────────────────────────────────

function EdgeLabelEditor({
  edgeId,
  initialLabel,
  labelX,
  labelY,
  onCommit,
  onCancel,
}: {
  edgeId: string;
  initialLabel: string;
  labelX: number;
  labelY: number;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus and select on mount
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onCommit(value.trim() || initialLabel);
    } else if (e.key === "Escape") {
      onCancel();
    }
    e.stopPropagation();
  };

  return (
    <div
      style={{
        position: "absolute",
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: "all",
      }}
      className="nodrag nopan"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value.trim() || initialLabel)}
        onKeyDown={handleKeyDown}
        className="w-24 rounded-md border border-amber-500/50 bg-card/95 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-300 text-center focus:outline-none focus:ring-1 focus:ring-amber-500/70"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Direction arrow indicator ────────────────────────────────────────────────

function DirectionArrow({
  edgePath,
  labelX,
  labelY,
  sourceColor,
  animated,
}: {
  edgePath: string;
  labelX: number;
  labelY: number;
  sourceColor: string;
  animated: boolean;
}) {
  // Place the arrow slightly offset from the label (above it)
  const arrowX = labelX;
  const arrowY = labelY - 16;

  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${arrowX}px, ${arrowY}px)`,
          pointerEvents: "none",
        }}
      >
        <svg
          width="16"
          height="10"
          viewBox="0 0 16 10"
          className={animated ? "edge-arrow-flow" : ""}
        >
          <polygon
            points="0,0 16,5 0,10 3,5"
            fill={sourceColor}
            opacity={animated ? 0.9 : 0.5}
          />
        </svg>
      </div>
    </EdgeLabelRenderer>
  );
}

// ── BusEdge ──────────────────────────────────────────────────────────────────

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
  const updateEdgeLabel = useAutumnStore((s) => s.updateEdgeLabel);
  const nodes = useAutumnStore((s) => s.nodes);

  // Inline label editing state
  const [editing, setEditing] = useState(false);
  const currentLabel = (data as { label?: string })?.label ?? "bus";

  // Resolve source persona color for the direction arrow
  const sourceNode = nodes.find((n) => n.id === source);
  const sourcePersona =
    sourceNode?.kind === "chat"
      ? PERSONA_BY_ID[(sourceNode.data as { personaId?: string }).personaId ?? ""]
      : null;
  const sourceColor = sourcePersona?.color ?? "#f59e0b";

  const handleLabelCommit = (newLabel: string) => {
    updateEdgeLabel(id, newLabel);
    setEditing(false);
  };

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
      {/* Direction arrow indicator */}
      <DirectionArrow
        edgePath={edgePath}
        labelX={labelX}
        labelY={labelY}
        sourceColor={sourceColor}
        animated={true}
      />
      {/* Edge label — inline editable on double-click */}
      <EdgeLabelRenderer>
        {editing ? (
          <EdgeLabelEditor
            edgeId={id}
            initialLabel={currentLabel}
            labelX={labelX}
            labelY={labelY}
            onCommit={handleLabelCommit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-300/90 nodrag nopan hover:bg-amber-500/30 hover:border-amber-500/50 hover:scale-110 transition-all cursor-pointer"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="Double-click to rename this edge"
          >
            {currentLabel}
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

// ── PulseCircle ──────────────────────────────────────────────────────────────

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

// ── NavigationEdge ───────────────────────────────────────────────────────────

export function NavigationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  data,
  source,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const updateEdgeLabel = useAutumnStore((s) => s.updateEdgeLabel);
  const nodes = useAutumnStore((s) => s.nodes);
  const [editing, setEditing] = useState(false);
  const currentLabel = (data as { label?: string })?.label ?? "nav";

  // Resolve source persona color for the direction arrow
  const sourceNode = nodes.find((n) => n.id === source);
  const sourcePersona =
    sourceNode?.kind === "chat"
      ? PERSONA_BY_ID[(sourceNode.data as { personaId?: string }).personaId ?? ""]
      : null;
  const sourceColor = sourcePersona?.color ?? "#38bdf8";

  const handleLabelCommit = (newLabel: string) => {
    updateEdgeLabel(id, newLabel);
    setEditing(false);
  };

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
      {/* Direction arrow for navigation edges */}
      <DirectionArrow
        edgePath={edgePath}
        labelX={labelX}
        labelY={labelY}
        sourceColor={sourceColor}
        animated={false}
      />
      <EdgeLabelRenderer>
        {editing ? (
          <EdgeLabelEditor
            edgeId={id}
            initialLabel={currentLabel}
            labelX={labelX}
            labelY={labelY}
            onCommit={handleLabelCommit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded-full bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-sky-300/90 nodrag nopan hover:bg-sky-500/30 hover:border-sky-500/50 hover:scale-110 transition-all cursor-pointer"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="Double-click to rename this edge"
          >
            {currentLabel}
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
