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
  Pencil,
  RotateCcw,
  Save,
  Share2,
  Sparkles,
  Wifi,
  FolderOpen,
  Loader2,
  Check,
  Trash2,
  LayoutGrid,
  Download,
  Clock,
  Command as CommandIcon,
} from "lucide-react";
import { toast } from "sonner";
import { shareCurrentCanvas } from "@/lib/autumn/share-canvas";

export function TopBar() {
  const canvasName = useAutumnStore((s) => s.canvasName);
  const setCanvasName = useAutumnStore((s) => s.setCanvasName);
  const resetCanvas = useAutumnStore((s) => s.resetCanvas);
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
  const setShowCanvasSwitcher = useAutumnStore((s) => s.setShowCanvasSwitcher);
  const setShowCommandPalette = useAutumnStore((s) => s.setShowCommandPalette);
  const setShowExportDialog = useAutumnStore((s) => s.setShowExportDialog);
  const setShowActivityLog = useAutumnStore((s) => s.setShowActivityLog);
  const saveCanvas = useAutumnStore((s) => s.saveCanvas);
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const isSaving = useAutumnStore((s) => s.isSaving);
  const lastSavedAt = useAutumnStore((s) => s.lastSavedAt);
  const nodeCount = useAutumnStore((s) => s.nodes.length);
  const edgeCount = useAutumnStore((s) => s.edges.length);
  const taskDone = useAutumnStore(
    (s) => s.tasks.filter((t) => t.status === "done").length,
  );
  const taskTotal = useAutumnStore((s) => s.tasks.length);

  const handleSave = async () => {
    await saveCanvas();
    const err = useAutumnStore.getState().saveError;
    if (err) {
      toast.error(`Save failed: ${err}`);
    } else {
      toast.success("Canvas saved", {
        description: `"${canvasName}" persisted to the local database.`,
      });
    }
  };

  return (
    <header className="autumn-topbar-gradient h-14 shrink-0 border-b border-border/50 backdrop-blur-md flex items-center px-3 gap-3">
      <div className="flex items-center gap-2">
        <div className="topbar-logo-shimmer size-8 rounded-lg bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <Leaf className="size-4 text-white relative z-10" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Autumn</div>
          <div className="text-[10px] text-muted-foreground -mt-0.5">
            spatial workshop
          </div>
        </div>
      </div>

      <div className="h-6 w-px bg-border/60 mx-1" />

      <div className="flex items-center gap-2">
        <span
          className="size-1.5 rounded-full bg-emerald-400 pulse-ring"
          aria-label="Workshop online"
          title="Workshop online"
        />
        <div className="group relative flex items-center">
          <input
            value={canvasName}
            onChange={(e) => setCanvasName(e.target.value)}
            className="bg-transparent text-sm font-medium pl-2 pr-7 py-1 rounded-md hover:bg-accent/40 focus:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-amber-500/40 transition-colors w-56"
            aria-label="Canvas name"
          />
          <Pencil className="size-3 text-muted-foreground/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-0 transition-opacity absolute right-2 pointer-events-none" />
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
        onClick={() => setShowCanvasSwitcher(true)}
      >
        <FolderOpen className="size-3.5" />
        <span className="hidden sm:inline">Canvases</span>
      </Button>

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

      {/* Save status indicator */}
      {lastSavedAt && !isSaving && (
        <span className="text-[10px] text-muted-foreground/70 hidden md:flex items-center gap-1">
          <Check className="size-3 text-emerald-400" />
          saved
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
          onClick={() => setShowActivityLog(true)}
        >
          <Clock className="size-4" />
          <span className="hidden md:inline">Activity</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
          onClick={() => setShowExportDialog(true)}
        >
          <Download className="size-4" />
          <span className="hidden md:inline">Export</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle className="size-4" />
          <span className="hidden sm:inline">Help</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
          onClick={() => {
            shareCurrentCanvas();
          }}
        >
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 h-8"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          <span className="hidden sm:inline">
            {isSaving ? "Saving…" : "Save"}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 hover:bg-accent/60">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Canvas actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setShowCommandPalette(true)}
              className="gap-2"
            >
              <CommandIcon className="size-4" />
              Command palette
              <span className="ml-auto text-[9px] text-muted-foreground font-mono">⌘K</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowCanvasSwitcher(true)}
              className="gap-2"
            >
              <FolderOpen className="size-4" />
              Open canvas switcher
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowExportDialog(true)}
              className="gap-2"
            >
              <Download className="size-4" />
              Export / import JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={arrangeNodes} className="gap-2">
              <LayoutGrid className="size-4" />
              Arrange nodes
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowActivityLog(true)}
              className="gap-2"
            >
              <Clock className="size-4" />
              Activity timeline
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowHelp(true)}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              Show onboarding
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={resetCanvas}
              className="gap-2 text-rose-400"
            >
              <RotateCcw className="size-4" />
              Reset to seed canvas
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void useAutumnStore.getState().clearCanvas()}
              className="gap-2 text-rose-400"
            >
              <Trash2 className="size-4" />
              Clear all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
