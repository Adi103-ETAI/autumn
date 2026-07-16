// Autumn — QuickSpawnMenu.
// A dropdown/popover menu triggered from the CanvasToolbar "Add Agent" button.
// Shows preset agent configurations for quick spawning.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentHarness } from "@/lib/autumn/types";
import { nextPersona } from "@/lib/autumn/personas";
import { defaultModelFor } from "@/lib/autumn/harness-meta";
import { nanoid } from "nanoid";
import {
  Code2,
  Eye,
  Server,
  Paintbrush,
  TestTube2,
  BarChart3,
  Plus,
} from "lucide-react";

// ── Preset definitions ──────────────────────────────────────────────────────

interface AgentPreset {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  harness: AgentHarness;
  model: string;
  effort: "low" | "medium" | "high";
  effortColor: string;
}

const PRESETS: AgentPreset[] = [
  {
    id: "fullstack",
    name: "Full Stack Dev",
    description: "End-to-end feature development",
    icon: Code2,
    iconColor: "text-emerald-400",
    harness: "claude-code",
    model: "claude-sonnet-4",
    effort: "high",
    effortColor: "text-violet-400 border-violet-500/40",
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    description: "PR reviews and quality checks",
    icon: Eye,
    iconColor: "text-sky-400",
    harness: "claude-code",
    model: "claude-sonnet-4",
    effort: "medium",
    effortColor: "text-sky-400 border-sky-500/40",
  },
  {
    id: "backend",
    name: "Backend API",
    description: "APIs, databases, services",
    icon: Server,
    iconColor: "text-emerald-400",
    harness: "codex",
    model: "gpt-5-codex",
    effort: "high",
    effortColor: "text-violet-400 border-violet-500/40",
  },
  {
    id: "frontend",
    name: "Frontend UI",
    description: "Components, design, polish",
    icon: Paintbrush,
    iconColor: "text-pink-400",
    harness: "cursor",
    model: "cursor-pro",
    effort: "medium",
    effortColor: "text-sky-400 border-sky-500/40",
  },
  {
    id: "test",
    name: "Test Engineer",
    description: "Unit tests, e2e, CI/CD",
    icon: TestTube2,
    iconColor: "text-violet-400",
    harness: "claude-code",
    model: "claude-sonnet-4",
    effort: "low",
    effortColor: "text-zinc-400 border-zinc-500/40",
  },
  {
    id: "analyst",
    name: "Data Analyst",
    description: "Data analysis, reports, insights",
    icon: BarChart3,
    iconColor: "text-orange-400",
    harness: "gemini",
    model: "gemini-2.5-pro",
    effort: "medium",
    effortColor: "text-sky-400 border-sky-500/40",
  },
];

// ── QuickSpawnMenu component ────────────────────────────────────────────────

export function QuickSpawnMenu({
  open,
  onClose,
  screenPosition,
  canvasPosition,
}: {
  open: boolean;
  onClose: () => void;
  /** Screen coordinates for menu positioning (from context menu click) */
  screenPosition?: { x: number; y: number };
  /** Canvas coordinates for node placement */
  canvasPosition?: { x: number; y: number };
}) {
  const addNode = useAutumnStore((s) => s.addNode);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);

  if (!open) return null;

  const spawnPreset = (preset: AgentPreset) => {
    // Get a persona from the rotation, then override harness/model/effort
    const persona = nextPersona();
    const id = addNode({
      kind: "chat",
      name: preset.name,
      data: {
        harness: preset.harness,
        personaId: persona.id,
        model: preset.model,
        effort: preset.effort,
        permission: "ask",
        status: "idle",
        doing: `Ready — ${preset.description}`,
        messages: [
          {
            id: `m-${nanoid(6)}`,
            role: "system",
            text: `${preset.name} online · ${preset.harness}/${preset.model} · ${preset.description}`,
            ts: Date.now(),
          },
        ],
      },
      position: canvasPosition
        ? { x: canvasPosition.x, y: canvasPosition.y }
        : undefined,
    });
    setSelectedNode(id);
    setRightPanelTab("commander");
    onClose();
  };

  const spawnCustom = () => {
    const id = addNode({ kind: "chat" });
    setSelectedNode(id);
    setRightPanelTab("commander");
    onClose();
  };

  // Compute menu position — if we have explicit screen coordinates (from context menu),
  // use them; otherwise default to a centered position below the toolbar.
  const style: React.CSSProperties = screenPosition
    ? { left: screenPosition.x, top: screenPosition.y }
    : {};

  return (
    <div
      className={cn(
        "fixed z-50 w-[260px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-md shadow-2xl py-1.5 spawn-menu-enter",
        !screenPosition && "bottom-16 left-1/2 -translate-x-1/2",
      )}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        Quick spawn agent
      </div>
      <div className="h-px bg-border/40 my-0.5" />
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() => spawnPreset(preset)}
          className="flex w-full items-center gap-2.5 px-2.5 py-2 text-xs hover:bg-accent/60 transition-colors text-left spawn-preset-item"
        >
          <div
            className={cn(
              "size-7 rounded-md flex items-center justify-center border border-border/50 bg-muted/50",
            )}
          >
            <preset.icon className={cn("size-3.5", preset.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{preset.name}</div>
            <div className="text-[9px] text-muted-foreground truncate">
              {preset.harness} · {preset.model}
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-[8px] h-4 px-1 border shrink-0",
              preset.effortColor,
            )}
          >
            {preset.effort}
          </Badge>
        </button>
      ))}
      <div className="h-px bg-border/40 my-0.5" />
      <button
        onClick={spawnCustom}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-xs hover:bg-accent/60 transition-colors text-left text-muted-foreground"
      >
        <Plus className="size-3.5" />
        <span>Custom…</span>
      </button>
    </div>
  );
}
