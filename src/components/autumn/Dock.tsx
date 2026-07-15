// Autumn — Left Dock (tool rail).
// Mirrors October's dock: quick-add buttons for each node kind.
// Each button has a rich tooltip (label + description), a hover-lift +
// warm gradient (autumn-dock-btn), rotating gradient border on hover,
// an active flash when a node was just added, and a count badge for Agents.

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NodeKind } from "@/lib/autumn/types";
import {
  Bot,
  TerminalSquare,
  MonitorSmartphone,
  StickyNote,
  BarChart3,
  Globe,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DockTool {
  kind: NodeKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  description: string;
}

const TOOLS: DockTool[] = [
  {
    kind: "chat",
    label: "Agent",
    icon: Bot,
    color: "text-fuchsia-400",
    description: "Add an AI agent node (Atlas, Apollo, …)",
  },
  {
    kind: "terminal",
    label: "Terminal",
    icon: TerminalSquare,
    color: "text-emerald-400",
    description: "Add a terminal node for shell commands",
  },
  {
    kind: "screen",
    label: "Screen",
    icon: MonitorSmartphone,
    color: "text-sky-400",
    description: "Add a screen node for live previews",
  },
  {
    kind: "sticky",
    label: "Note",
    icon: StickyNote,
    color: "text-amber-400",
    description: "Add a sticky note with markdown support",
  },
  {
    kind: "analytics",
    label: "Analytics",
    icon: BarChart3,
    color: "text-orange-400",
    description: "Add an analytics node for metrics & charts",
  },
  {
    kind: "youtube",
    label: "Browser",
    icon: Globe,
    color: "text-violet-400",
    description: "Add a browser node for web content",
  },
  {
    kind: "remotion",
    label: "Remotion",
    icon: Clapperboard,
    color: "text-cyan-400",
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
        className="w-14 shrink-0 border-r border-border/50 bg-sidebar/60 backdrop-blur-md flex flex-col items-center py-3 gap-1.5"
        aria-label="Canvas tools"
      >
        {TOOLS.map((t, i) => (
          <Fragment key={t.kind}>
            {/* Subtle separator between the primary "Add Agent" action
                and the rest of the dock. */}
            {i === 1 && (
              <div
                aria-hidden
                className="w-7 h-px my-0.5 dock-glow-separator"
              />
            )}
            <Tooltip side="right">
              <TooltipTrigger asChild>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "autumn-dock-btn dock-btn-gradient-border dock-btn-scale size-9 rounded-lg group relative",
                      activeKind === t.kind && "dock-btn-active",
                    )}
                    onClick={() => handleAddNode(t.kind)}
                    aria-label={`Add ${t.label}`}
                  >
                    <t.icon className={`size-4 ${t.color}`} />
                  </Button>
                  {/* Count badge for Agent dock button */}
                  {t.kind === "chat" && chatCount > 0 && (
                    <span className="dock-count-badge">
                      {chatCount > 9 ? "9+" : chatCount}
                    </span>
                  )}
                </div>
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
