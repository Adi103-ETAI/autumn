// Autumn — TopBar component (October-style redesign).
// Clean, minimal top header matching the October Desktop reference:
//   Left:  Autumn logo + editable workspace name + framework badge
//   Right: Live status, + Screens, Sync, Sessions, Sign in
// The heavier actions (Save/Export/Activity/Help/Share/Canvases/Home) live in
// the global MenuBar above this bar, so the TopBar stays uncluttered.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import {
  Pencil,
  MonitorSmartphone,
  RefreshCw,
  Users,
  User,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TopBar() {
  const canvasName = useAutumnStore((s) => s.canvasName);
  const setCanvasName = useAutumnStore((s) => s.setCanvasName);
  const canvasId = useAutumnStore((s) => s.canvasId);
  const workspaces = useAutumnStore((s) => s.workspaces);
  const addNode = useAutumnStore((s) => s.addNode);
  const saveCanvas = useAutumnStore((s) => s.saveCanvas);
  const setAppStage = useAutumnStore((s) => s.setAppStage);

  // Derive the framework badge from the active workspace (if any).
  const activeWorkspace = workspaces.find((w) => w.id === canvasId);
  const framework = activeWorkspace?.framework;

  const handleSync = async () => {
    await saveCanvas();
    const err = useAutumnStore.getState().saveError;
    if (err) {
      toast.error(`Sync failed: ${err}`);
    } else {
      toast.success("Synced", {
        description: `"${canvasName}" saved to the local database.`,
      });
    }
  };

  return (
    <header className="autumn-topbar-gradient h-12 shrink-0 border-b border-white/10 backdrop-blur-md flex items-center px-3 gap-3">
      {/* Left cluster: logo + workspace name + framework */}
      <div className="flex items-center gap-2.5">
        <AutumnLogo size={24} priority />
        <div className="group relative flex items-center">
          <input
            value={canvasName}
            onChange={(e) => setCanvasName(e.target.value)}
            className="bg-transparent text-sm font-medium pl-2 pr-7 py-1 rounded-md hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-1 focus:ring-amber-500/40 transition-colors w-48"
            aria-label="Workspace name"
          />
          <Pencil className="size-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-0 transition-opacity absolute right-2 pointer-events-none" />
        </div>
        {framework && (
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 border-white/15 bg-white/5 text-muted-foreground font-mono"
          >
            {framework}
          </Badge>
        )}
      </div>

      <div className="flex-1" />

      {/* Right cluster: Live + Screens + Sync + Sessions + Sign in */}
      <div className="flex items-center gap-1.5">
        {/* Live status */}
        <div className="flex items-center gap-1.5 px-2 h-7 rounded-md text-[11px] text-muted-foreground">
          <span
            className="size-1.5 rounded-full bg-emerald-400 pulse-ring"
            aria-label="Live"
            title="Live"
          />
          <span className="hidden sm:inline">Live</span>
        </div>

        {/* + Screens */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 h-7 text-[11px]"
          onClick={() => addNode({ kind: "screen" })}
          title="Add a screen node"
        >
          <Plus className="size-3" />
          <span className="hidden sm:inline">Screens</span>
        </Button>

        {/* Sync */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 h-7 text-[11px]"
          onClick={() => void handleSync()}
          title="Sync / save this canvas"
        >
          <RefreshCw className="size-3.5" />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        {/* Sessions */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 h-7 text-[11px]"
          onClick={() =>
            toast("Sessions coming soon", {
              description: "Multi-session canvas switching is in development.",
            })
          }
          title="Sessions"
        >
          <Users className="size-3.5" />
          <span className="hidden sm:inline">Sessions</span>
        </Button>

        <div className="h-5 w-px bg-white/10 mx-0.5" />

        {/* Sign in */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1.5 h-7 text-[11px]",
            "text-muted-foreground hover:text-foreground hover:bg-white/5",
          )}
          onClick={() => setAppStage("home")}
          title="Sign in / Home"
        >
          <User className="size-3.5" />
          <span className="hidden sm:inline">Sign in</span>
        </Button>
      </div>
    </header>
  );
}
