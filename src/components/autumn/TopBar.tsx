// Autumn — TopBar component.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HelpCircle,
  Leaf,
  MoreVertical,
  RotateCcw,
  Save,
  Share2,
  Sparkles,
  Wifi,
} from "lucide-react";

export function TopBar() {
  const canvasName = useAutumnStore((s) => s.canvasName);
  const setCanvasName = useAutumnStore((s) => s.setCanvasName);
  const resetCanvas = useAutumnStore((s) => s.resetCanvas);
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
  const nodeCount = useAutumnStore((s) => s.nodes.length);
  const edgeCount = useAutumnStore((s) => s.edges.length);
  const taskDone = useAutumnStore(
    (s) => s.tasks.filter((t) => t.status === "done").length,
  );
  const taskTotal = useAutumnStore((s) => s.tasks.length);

  return (
    <header className="h-14 shrink-0 border-b border-border/50 bg-sidebar/60 backdrop-blur-md flex items-center px-3 gap-3">
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-lg bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <Leaf className="size-4 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Autumn</div>
          <div className="text-[10px] text-muted-foreground -mt-0.5">
            spatial workshop
          </div>
        </div>
      </div>

      <div className="h-6 w-px bg-border/60 mx-1" />

      <input
        value={canvasName}
        onChange={(e) => setCanvasName(e.target.value)}
        className="bg-transparent text-sm font-medium px-2 py-1 rounded-md hover:bg-accent/40 focus:bg-accent/40 focus:outline-none transition-colors w-64"
        aria-label="Canvas name"
      />

      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="gap-1 text-[11px] h-6">
          <Wifi className="size-3 text-emerald-400" />
          bus live
        </Badge>
        <Badge variant="outline" className="text-[11px] h-6">
          {nodeCount} nodes
        </Badge>
        <Badge variant="outline" className="text-[11px] h-6">
          {edgeCount} edges
        </Badge>
        <Badge variant="outline" className="text-[11px] h-6">
          {taskDone}/{taskTotal} tasks
        </Badge>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle className="size-4" />
          <span className="hidden sm:inline">Help</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
          }}
        >
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
        >
          <Save className="size-4" />
          <span className="hidden sm:inline">Save</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Canvas actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetCanvas} className="gap-2 text-rose-400">
              <RotateCcw className="size-4" />
              Reset to seed canvas
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowHelp(true)}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              Show onboarding
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
