// Autumn — Left Dock (tool rail).
// Mirrors October's dock: quick-add buttons for each node kind.

"use client";

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
}

const TOOLS: DockTool[] = [
  { kind: "chat", label: "Agent", icon: Bot, color: "text-fuchsia-400" },
  { kind: "terminal", label: "Terminal", icon: TerminalSquare, color: "text-emerald-400" },
  { kind: "screen", label: "Screen", icon: MonitorSmartphone, color: "text-sky-400" },
  { kind: "sticky", label: "Note", icon: StickyNote, color: "text-amber-400" },
  { kind: "analytics", label: "Analytics", icon: BarChart3, color: "text-orange-400" },
  { kind: "youtube", label: "Browser", icon: Globe, color: "text-violet-400" },
  { kind: "remotion", label: "Remotion", icon: Clapperboard, color: "text-blue-400" },
];

export function Dock() {
  const addNode = useAutumnStore((s) => s.addNode);

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className="w-14 shrink-0 border-r border-border/50 bg-sidebar/60 backdrop-blur-md flex flex-col items-center py-3 gap-1.5"
        aria-label="Canvas tools"
      >
        {TOOLS.map((t) => (
          <Tooltip key={t.kind} side="right">
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-lg hover:bg-accent/60 transition-colors group"
                onClick={() => addNode({ kind: t.kind })}
                aria-label={`Add ${t.label}`}
              >
                <t.icon className={`size-4.5 ${t.color}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              Add {t.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}
