// Autumn — Floating canvas toolbar (app-tile dock).
// Bottom-center pill with 7 colorful app-tiles, mirroring the reference design:
//   mic · agents(app-grid) · browser(compass) · video-editor · mobile-preview · terminal · sticky-note
// Each tile is a gradient rounded square with a white glyph + colored glow.
// Utility actions (search/arrange/fit/clear/stats) were removed per the plan —
// fit-view already lives in the MinimapPanel below the minimap.

"use client";

import { useState, useEffect, useRef } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mic,
  LayoutGrid,
  Compass,
  Clapperboard,
  Smartphone,
  TerminalSquare,
  StickyNote,
  ChevronDown,
} from "lucide-react";
import { QuickSpawnMenu } from "./QuickSpawnMenu";
import { cn } from "@/lib/utils";

// ── Tile definitions ────────────────────────────────────────────────────────
// Each tile carries its own gradient + glow color so the dock reads as a row of
// distinct colorful app icons (like the reference's bottom dock).

interface TileDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind gradient classes for the tile background. */
  gradient: string;
  /** Hex/oklch glow color used in the box-shadow. */
  glow: string;
}

const TILES: TileDef[] = [
  {
    key: "voice",
    label: "Voice input",
    icon: Mic,
    gradient: "from-rose-500 to-pink-600",
    glow: "oklch(0.65 0.23 12)",
  },
  {
    key: "agents",
    label: "Coding agents",
    icon: LayoutGrid,
    gradient: "from-violet-500 to-fuchsia-600",
    glow: "oklch(0.62 0.22 300)",
  },
  {
    key: "browser",
    label: "Browser",
    icon: Compass,
    gradient: "from-sky-500 to-blue-600",
    glow: "oklch(0.62 0.2 240)",
  },
  {
    key: "video",
    label: "Video editor",
    icon: Clapperboard,
    gradient: "from-slate-700 to-slate-900",
    glow: "oklch(0.45 0.02 260)",
  },
  {
    key: "mobile",
    label: "Mobile preview",
    icon: Smartphone,
    gradient: "from-emerald-500 to-teal-600",
    glow: "oklch(0.68 0.17 165)",
  },
  {
    key: "terminal",
    label: "Terminal",
    icon: TerminalSquare,
    gradient: "from-zinc-700 to-zinc-900",
    glow: "oklch(0.42 0.02 145)",
  },
  {
    key: "note",
    label: "Sticky note",
    icon: StickyNote,
    gradient: "from-amber-400 to-orange-500",
    glow: "oklch(0.78 0.16 70)",
  },
];

export function CanvasToolbar() {
  const addNode = useAutumnStore((s) => s.addNode);

  // Voice state — mirrors VoiceMicButton's handleClick logic so the dock's mic
  // tile behaves identically to the floating mic button.
  const voiceEnabled = useAutumnStore((s) => s.voiceEnabled);
  const setVoiceSetupOpen = useAutumnStore((s) => s.setVoiceSetupOpen);
  const isListening = useAutumnStore((s) => s.isListening);
  const setListening = useAutumnStore((s) => s.setListening);
  const setPendingCommand = useAutumnStore((s) => s.setPendingCommand);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);

  // QuickSpawnMenu open state (triggered by the agents tile).
  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const spawnRef = useRef<HTMLDivElement>(null);

  // Close spawn menu on outside click / Esc.
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

  // ── Tile click handlers ──────────────────────────────────────────────────
  const handleMicClick = () => {
    if (!voiceEnabled) {
      setVoiceSetupOpen(true);
      return;
    }
    // Toggle listening. The actual recognition start/stop lives in the
    // VoiceMicButton component (which we keep mounted for its Web Speech API
    // wiring); here we just flip the flag it reacts to.
    if (isListening) {
      setListening(false);
    } else {
      setListening(true);
      // Ensure the Commander panel is visible so the transcript lands somewhere.
      setRightPanelTab("commander");
    }
  };

  const handleAgentsClick = () => setSpawnMenuOpen((v) => !v);
  const handleBrowserClick = () => addNode({ kind: "youtube" });
  const handleVideoClick = () => addNode({ kind: "remotion" });
  const handleMobileClick = () =>
    addNode({ kind: "screen", data: { screenKind: "phone" } });
  const handleTerminalClick = () => addNode({ kind: "terminal" });
  const handleNoteClick = () => addNode({ kind: "sticky" });

  const handlers: Record<string, () => void> = {
    voice: handleMicClick,
    agents: handleAgentsClick,
    browser: handleBrowserClick,
    video: handleVideoClick,
    mobile: handleMobileClick,
    terminal: handleTerminalClick,
    note: handleNoteClick,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-2xl border border-border/40 bg-card/70 backdrop-blur-xl px-2 py-2 shadow-2xl"
        style={{
          boxShadow:
            "0 8px 32px -8px oklch(0.78 0.18 55 / 0.12), 0 0 0 1px oklch(0.78 0.18 55 / 0.06)",
        }}
      >
        {TILES.map((tile) => {
          const Icon = tile.icon;
          const isAgents = tile.key === "agents";
          const isVoice = tile.key === "voice";
          const active = (isVoice && isListening) || (isAgents && spawnMenuOpen);

          const tileEl = (
            <button
              key={tile.key}
              type="button"
              onClick={handlers[tile.key]}
              aria-label={tile.label}
              aria-pressed={active}
              className={cn(
                "group relative flex size-10 items-center justify-center rounded-xl",
                "bg-gradient-to-br transition-all duration-150",
                tile.gradient,
                "hover:scale-105 active:scale-95",
                active && "ring-2 ring-white/70 ring-offset-2 ring-offset-card",
              )}
              style={{
                boxShadow: `0 4px 14px -4px ${tile.glow}80, inset 0 1px 0 0 rgb(255 255 255 / 0.15)`,
              }}
            >
              {/* Glossy highlight (top-left sheen) */}
              <span
                className="pointer-events-none absolute inset-0 rounded-xl opacity-60"
                style={{
                  background:
                    "linear-gradient(135deg, rgb(255 255 255 / 0.25) 0%, rgb(255 255 255 / 0) 45%)",
                }}
              />
              <Icon className="relative size-5 text-white drop-shadow-sm" />
              {/* Active-listening pulse for the mic */}
              {isVoice && isListening && (
                <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-300 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
                </span>
              )}
              {/* Chevron indicator on the agents tile (opens a menu) */}
              {isAgents && (
                <ChevronDown className="absolute -bottom-0.5 size-2.5 text-white/80" />
              )}
            </button>
          );

          return (
            <Tooltip key={tile.key}>
              <TooltipTrigger asChild>{tileEl}</TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {tile.label}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* QuickSpawnMenu — anchored to the agents tile */}
        <div ref={spawnRef} className="relative">
          <QuickSpawnMenu
            open={spawnMenuOpen}
            onClose={() => setSpawnMenuOpen(false)}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
