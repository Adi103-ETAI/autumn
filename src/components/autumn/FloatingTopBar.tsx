// Autumn — FloatingTopBar.
// A floating status bar pinned to the top of the canvas area (below the main
// TopBar). Mirrors October's floating status bar: a "Project chat" badge that
// opens the Commander, contextual "+ Add" buttons for spawning screens /
// browsers / video editors, an "AI Finder" launcher, and an "Apps" button.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  ChevronDown,
  MonitorSmartphone,
  Globe,
  Monitor,
  Clapperboard,
  Search,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AddButtonDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  onClick: () => void;
}

export function FloatingTopBar() {
  const canvasName = useAutumnStore((s) => s.canvasName);
  const addNode = useAutumnStore((s) => s.addNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const setAiFinderOpen = useAutumnStore((s) => s.setAiFinderOpen);
  const setAppsModalOpen = useAutumnStore((s) => s.setAppsModalOpen);

  const addButtons: AddButtonDef[] = [
    {
      id: "screens",
      label: "Screens",
      icon: MonitorSmartphone,
      accent:
        "text-sky-300 hover:bg-sky-500/10 hover:text-sky-200",
      onClick: () => addNode({ kind: "screen" }),
    },
    {
      id: "browser",
      label: "Browser",
      icon: Globe,
      accent:
        "text-violet-300 hover:bg-violet-500/10 hover:text-violet-200",
      onClick: () => addNode({ kind: "youtube" }),
    },
    {
      id: "desktop",
      label: "Desktop",
      icon: Monitor,
      accent:
        "text-sky-300 hover:bg-sky-500/10 hover:text-sky-200",
      onClick: () => addNode({ kind: "screen" }),
    },
    {
      id: "video-editor",
      label: "Video Editor",
      icon: Clapperboard,
      accent:
        "text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200",
      onClick: () => addNode({ kind: "remotion" }),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 w-[calc(100%-1rem)] max-w-[640px] pointer-events-auto"
    >
      <div className="flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-card/80 backdrop-blur-xl shadow-lg shadow-black/30 pl-1 pr-1 py-1 w-full">
        {/* Project chat badge — opens the Commander right panel */}
        <motion.button
          whileHover={{ y: -1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          onClick={() => setRightPanelTab("commander")}
          className={cn(
            "group relative flex items-center gap-2 rounded-full px-3 py-1.5 shrink-0",
            "bg-gradient-to-r from-violet-600 via-violet-500 to-violet-500",
            "text-violet-50 shadow-inner shadow-violet-300/20",
            "hover:from-violet-400 hover:via-orange-400 hover:to-violet-400 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60",
          )}
          title="Open project chat (Commander)"
          aria-label={`Open project chat for ${canvasName}`}
        >
          {/* pulsing live dot */}
          <span
            className="size-2 rounded-full bg-emerald-400 pulse-ring shrink-0"
            aria-hidden
          />
          <span className="text-[11px] font-semibold tracking-tight max-w-[120px] truncate">
            {canvasName}
          </span>
          <ChevronDown className="size-3 opacity-80 group-hover:opacity-100 transition-opacity" />
        </motion.button>

        {/* Divider */}
        <div className="h-5 w-px bg-border/50 shrink-0" />

        {/* Contextual Add buttons — horizontally scrollable row (shrinks to fit) */}
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto autumn-scroll py-0.5">
          {addButtons.map((b) => (
            <motion.div
              key={b.id}
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="shrink-0"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={b.onClick}
                className={cn(
                  "h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
                  "text-muted-foreground hover:text-foreground",
                  "border border-transparent hover:border-border/40",
                  b.accent,
                )}
                title={`Add ${b.label}`}
              >
                <b.icon className="size-3.5" />
                <span className="hidden sm:inline">+ {b.label}</span>
              </Button>
            </motion.div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-border/50 shrink-0" />

        {/* AI Finder button */}
        <motion.div
          whileHover={{ y: -1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="shrink-0"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiFinderOpen(true)}
            className={cn(
              "h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
              "border-violet-500/40 bg-violet-500/5",
              "text-violet-300 hover:text-violet-200",
              "hover:bg-violet-500/10 hover:border-violet-500/60",
            )}
            title="Open AI Finder"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">AI Finder</span>
          </Button>
        </motion.div>

        {/* Apps button */}
        <motion.div
          whileHover={{ y: -1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="shrink-0"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAppsModalOpen(true)}
            className={cn(
              "size-7 rounded-full shrink-0",
              "text-muted-foreground hover:text-foreground hover:bg-accent/60",
            )}
            title="Open Apps"
            aria-label="Open Apps"
          >
            <LayoutGrid className="size-3.5" />
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
