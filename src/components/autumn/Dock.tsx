// Autumn — Left Dock (tool rail).
// Mirrors October's dock: quick-add buttons for each node kind.
// Each button is a colorful "app tile" — a gradient rounded square with a
// bold white icon inside (macOS/October-dock aesthetic). Rich tooltip,
// hover-lift + brightness, active flash when a node was just added,
// and a count badge for Agents.

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NodeKind } from "@/lib/autumn/types";
import {
  Bot,
  SquareTerminal,
  Monitor,
  StickyNote,
  ChartColumn,
  Compass,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DockTool {
  kind: NodeKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind gradient classes for the app-tile background. */
  tile: string;
  /** Soft outer glow color on hover (rgba). */
  glow: string;
  description: string;
}

const TOOLS: DockTool[] = [
  {
    kind: "chat",
    label: "Agent",
    icon: Bot,
    tile: "from-fuchsia-500 to-purple-600",
    glow: "rgba(217,70,239,0.45)",
    description: "Add an AI agent node (Atlas, Apollo, …)",
  },
  {
    kind: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    tile: "from-slate-700 to-slate-900",
    glow: "rgba(16,185,129,0.40)",
    description: "Add a terminal node for shell commands",
  },
  {
    kind: "screen",
    label: "Screen",
    icon: Monitor,
    tile: "from-sky-400 to-blue-600",
    glow: "rgba(56,189,248,0.45)",
    description: "Add a screen node for live previews",
  },
  {
    kind: "sticky",
    label: "Note",
    icon: StickyNote,
    tile: "from-amber-300 to-yellow-500",
    glow: "rgba(251,191,36,0.45)",
    description: "Add a sticky note with markdown support",
  },
  {
    kind: "analytics",
    label: "Analytics",
    icon: ChartColumn,
    tile: "from-orange-400 to-red-500",
    glow: "rgba(249,115,22,0.45)",
    description: "Add an analytics node for metrics & charts",
  },
  {
    kind: "youtube",
    label: "Browser",
    icon: Compass,
    tile: "from-cyan-400 to-blue-500",
    glow: "rgba(34,211,238,0.45)",
    description: "Add a browser node for web content",
  },
  {
    kind: "remotion",
    label: "Remotion",
    icon: Clapperboard,
    tile: "from-violet-500 to-fuchsia-600",
    glow: "rgba(139,92,246,0.45)",
    description: "Add a Remotion node for video composition",
  },
];

export function Dock() {
  const addNode = useAutumnStore((s) => s.addNode);
  const nodes = useAutumnStore((s) => s.nodes);
  const running = useAutumnStore((s) => s.isAgentRunning);
  const chatCount = nodes.filter((n) => n.kind === "chat").length;
  const anyRunning = Object.values(running).some(Boolean);

  // Track which dock button was just activated (for flash animation)
  const [activeKind, setActiveKind] = useState<NodeKind | null>(null);
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddNode = (kind: NodeKind) => {
    addNode({ kind });
    // Flash the corresponding dock button
    setActiveKind(kind);
    if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
    activeTimeoutRef.current = setTimeout(() => setActiveKind(null), 600);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className="w-16 shrink-0 border-r border-border/50 bg-sidebar/60 backdrop-blur-md flex flex-col items-center py-3 gap-2"
        aria-label="Canvas tools"
      >
        {TOOLS.map((t, i) => (
          <Fragment key={t.kind}>
            {/* Subtle separator between the primary "Add Agent" action
                and the rest of the dock. */}
            {i === 1 && (
              <div
                aria-hidden
                className="w-8 h-px my-0.5 dock-glow-separator"
              />
            )}
            <Tooltip side="right">
              <TooltipTrigger asChild>
                <span className="relative block">
                  <button
                    type="button"
                    className={cn(
                      "dock-app-tile group relative flex size-10 items-center justify-center rounded-xl",
                      "bg-gradient-to-br shadow-lg shadow-black/30",
                      "ring-1 ring-inset ring-white/15",
                      "transition-all duration-200",
                      "hover:scale-110 hover:shadow-xl hover:brightness-110",
                      "active:scale-95",
                      t.tile,
                      activeKind === t.kind && "dock-tile-active",
                    )}
                    style={
                      {
                        // soft colored glow on hover via CSS variable
                        ["--tile-glow" as string]: t.glow,
                      } as React.CSSProperties
                    }
                    onClick={() => handleAddNode(t.kind)}
                    aria-label={`Add ${t.label}`}
                  >
                    {/* glossy top highlight for the 3D app-icon look */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/25 to-transparent"
                    />
                    <t.icon className="relative size-5 text-white drop-shadow-sm" />
                  </button>
                  {/* Count badge for Agent dock button */}
                  {t.kind === "chat" && chatCount > 0 && (
                    <span className="dock-count-badge">
                      {chatCount > 9 ? "9+" : chatCount}
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[220px]">
                <div className="font-medium">Add {t.label}</div>
                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                  {t.description}
                </div>
              </TooltipContent>
            </Tooltip>
          </Fragment>
        ))}
        {/* Running agent indicator at dock bottom */}
        {anyRunning && (
          <div className="flex justify-center mt-auto pt-1">
            <span
              className="dock-running-indicator size-1.5"
              title="Agent(s) running"
            />
          </div>
        )}
      </nav>
    </TooltipProvider>
  );
}
