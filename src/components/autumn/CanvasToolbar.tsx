// Autumn — Bottom Dock (October-style redesign).
// A macOS-style horizontal dock pinned to the bottom-center of the canvas.
// Mirrors October Desktop's dock layout:
//   Left:  mic (Set up voice) + app icons (agent/screen/note/terminal/browser/video)
//   Center: "Project chat" input bar (opens the Commander)
//   Right:  screen count + zoom controls + "+" add button
// Also keeps the BackgroundPicker, search, arrange, fit-view as dock icons.

"use client";

import { useState, useEffect, useRef } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  TerminalSquare,
  MonitorSmartphone,
  StickyNote,
  Globe,
  Clapperboard,
  Search,
  LayoutGrid,
  Maximize2,
  Plus,
  Minus,
  Mic,
  MessageSquare,
  Image as ImageIcon,
} from "lucide-react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { NodeKind } from "@/lib/autumn/types";
import { QuickSpawnMenu } from "./QuickSpawnMenu";
import { BackgroundPicker } from "./BackgroundPicker";
import { cn } from "@/lib/utils";

// ── Dock app icons (left cluster) ───────────────────────────────────────────

interface DockApp {
  kind: NodeKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const DOCK_APPS: DockApp[] = [
  { kind: "screen", label: "Screen", icon: MonitorSmartphone, color: "text-sky-400" },
  { kind: "sticky", label: "Note", icon: StickyNote, color: "text-amber-400" },
  { kind: "terminal", label: "Terminal", icon: TerminalSquare, color: "text-emerald-400" },
  { kind: "youtube", label: "Browser", icon: Globe, color: "text-amber-400" },
  { kind: "remotion", label: "Video", icon: Clapperboard, color: "text-cyan-400" },
];

export function CanvasToolbar() {
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const addNode = useAutumnStore((s) => s.addNode);
  const nodes = useAutumnStore((s) => s.nodes);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const setVoiceSetupOpen = useAutumnStore((s) => s.setVoiceSetupOpen);
  const voiceEnabled = useAutumnStore((s) => s.voiceEnabled);
  const canvasName = useAutumnStore((s) => s.canvasName);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  // QuickSpawnMenu open state (for the + Agent button)
  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const spawnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spawnMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (spawnRef.current && !spawnRef.current.contains(e.target as Node)) {
        setSpawnMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSpawnMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [spawnMenuOpen]);

  const screenCount = nodes.filter((n) => n.kind === "screen").length;
  const zoomPct = Math.round(zoom * 100);

  return (
    <TooltipProvider delayDuration={300}>
      {/* Zoom chip (bottom-left, separate from dock) */}
      <ZoomChip />

      {/* macOS-style bottom dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-2xl border border-white/15 bg-zinc-900/70 backdrop-blur-2xl px-2 py-1.5 shadow-2xl autumn-dock-shadow">
        {/* ── Left cluster: mic + app icons ── */}
        <DockIconButton
          label={voiceEnabled ? "Voice active" : "Set up voice"}
          onClick={() => setVoiceSetupOpen(true)}
          icon={Mic}
          color={voiceEnabled ? "text-emerald-400" : "text-muted-foreground"}
          indicator={voiceEnabled ? "active" : undefined}
        />

        <div className="h-7 w-px bg-white/10 mx-0.5" />

        {/* Agent button — opens QuickSpawnMenu */}
        <div className="relative" ref={spawnRef}>
          <DockIconButton
            label="Add agent"
            onClick={() => setSpawnMenuOpen((v) => !v)}
            icon={Bot}
            color="text-fuchsia-400"
          />
          <QuickSpawnMenu
            open={spawnMenuOpen}
            onClose={() => setSpawnMenuOpen(false)}
          />
        </div>

        {/* App icon row */}
        {DOCK_APPS.map((app) => (
          <DockIconButton
            key={app.kind}
            label={`Add ${app.label}`}
            onClick={() => addNode({ kind: app.kind })}
            icon={app.icon}
            color={app.color}
          />
        ))}

        <div className="h-7 w-px bg-white/10 mx-0.5" />

        {/* ── Center: Project chat input bar ── */}
        <button
          type="button"
          onClick={() => setRightPanelTab("commander")}
          className="group flex items-center gap-2 h-8 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-amber-500/30 transition-colors min-w-[180px] max-w-[280px]"
          title="Open project chat (Commander)"
          aria-label={`Open project chat for ${canvasName}`}
        >
          <MessageSquare className="size-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors truncate flex-1 text-left">
            Project chat…
          </span>
          <span className="size-1.5 rounded-full bg-emerald-400 pulse-ring shrink-0" />
        </button>

        <div className="h-7 w-px bg-white/10 mx-0.5" />

        {/* ── Right cluster: canvas tools + screen count + zoom ── */}
        <DockIconButton
          label="Search nodes (⌘F)"
          onClick={() => setShowNodeSearch(true)}
          icon={Search}
          color="text-emerald-400"
        />
        <DockIconButton
          label="Arrange nodes"
          onClick={arrangeNodes}
          icon={LayoutGrid}
          color="text-emerald-400"
        />
        <DockIconButton
          label="Fit view"
          onClick={() => fitView({ padding: 0.2, duration: 400 })}
          icon={Maximize2}
          color="text-amber-400"
        />
        <BackgroundPicker compact />

        <div className="h-7 w-px bg-white/10 mx-0.5" />

        {/* Screen count */}
        <div className="flex items-center gap-1 px-1.5 text-[10px] text-muted-foreground">
          <MonitorSmartphone className="size-3 text-sky-400" />
          <span className="font-mono">{screenCount}</span>
          <span className="hidden md:inline">screen{screenCount === 1 ? "" : "s"}</span>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 px-1">
          <DockIconButton
            label="Zoom out"
            onClick={() => zoomOut({ duration: 200 })}
            icon={Minus}
            color="text-muted-foreground"
            size="sm"
          />
          <button
            type="button"
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            className="px-1.5 h-7 rounded-lg hover:bg-white/10 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors min-w-[36px]"
            title="Reset zoom (fit view)"
          >
            {zoomPct}%
          </button>
          <DockIconButton
            label="Zoom in"
            onClick={() => zoomIn({ duration: 200 })}
            icon={Plus}
            color="text-muted-foreground"
            size="sm"
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Dock icon button ─────────────────────────────────────────────────────────

function DockIconButton({
  label,
  onClick,
  icon: Icon,
  color,
  size = "md",
  indicator,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  size?: "sm" | "md";
  indicator?: "active";
}) {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "relative rounded-xl flex items-center justify-center transition-all",
            "hover:bg-white/10 hover:-translate-y-0.5 active:translate-y-0",
            "autumn-dock-icon",
            size === "md" ? "size-9" : "size-7",
          )}
          aria-label={label}
        >
          <Icon className={cn(size === "md" ? "size-4" : "size-3.5", color)} />
          {indicator === "active" && (
            <span
              className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-emerald-400"
              aria-hidden
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── ZoomChip (bottom-left, separate from dock) ───────────────────────────────

function ZoomChip() {
  const zoom = useStore((s) => s.transform[2]);
  const { zoomTo } = useReactFlow();
  const zoomPct = Math.round(zoom * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => zoomTo(1, { duration: 300 })}
          className="chip-zoom-reset absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-zinc-900/70 backdrop-blur-xl px-2.5 py-1 font-mono text-[10px] text-muted-foreground shadow-lg hover:border-amber-500/50 hover:text-amber-300 transition-colors"
          aria-label={`Zoom: ${zoomPct}%. Click to reset to 100%`}
        >
          <ImageIcon className="size-2.5" />
          <span>{zoomPct}%</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Reset to 100%
      </TooltipContent>
    </Tooltip>
  );
}

// Re-export for type usage
export type { NodeKind };
