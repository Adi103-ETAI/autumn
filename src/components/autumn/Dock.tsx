// Autumn — Left Dock (tool rail).
// Mirrors October's dock: quick-add buttons for each node kind.
// Each button has a rich tooltip (label + description), a hover-lift +
// warm gradient (autumn-dock-btn), and an amber active/pressed ring.

"use client";

import { Fragment } from "react";
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
                className="w-7 h-px bg-border/50 my-0.5"
              />
            )}
            <Tooltip side="right">
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="autumn-dock-btn size-9 rounded-lg group"
                  onClick={() => addNode({ kind: t.kind })}
                  aria-label={`Add ${t.label}`}
                >
                  <t.icon className={`size-4 ${t.color}`} />
                </Button>
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
      </nav>
    </TooltipProvider>
  );
}
