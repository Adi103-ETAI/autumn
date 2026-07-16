// Autumn — ChatNode component (agent node on the canvas).
// The most complex node type: shows persona, harness, status, doing, message
// preview, and supports sending a task. Click to expand chat in the right panel.

"use client";

import { useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { ChatNodeData } from "@/lib/autumn/types";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play,
  Square,
  MoreHorizontal,
  Bot,
  Settings2,
  Trash2,
  Cable,
  Copy,
  Search,
  History,
  MessageSquare,
  FileText,
  FolderSearch,
  Code2,
  Terminal,
  Hash,
  Wrench,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  idle: { dot: "bg-zinc-500", label: "Idle" },
  thinking: { dot: "bg-amber-400 animate-pulse", label: "Thinking" },
  working: { dot: "bg-emerald-400 animate-pulse", label: "Working" },
  waiting: { dot: "bg-sky-400", label: "Waiting" },
  done: { dot: "bg-zinc-400", label: "Done" },
  error: { dot: "bg-rose-500", label: "Error" },
  offline: { dot: "bg-zinc-700", label: "Offline" },
};

// Tool pattern detection for the tool-use badge strip
interface ToolBadgeInfo {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string; // tailwind bg color class
}

const TOOL_PATTERNS: { pattern: RegExp; badge: ToolBadgeInfo }[] = [
  { pattern: /\bTodoWrite\b/, badge: { name: "Todo", icon: Hash, color: "bg-amber-500/30 text-amber-300 border-violet-500/30" } },
  { pattern: /\bRead\b|\bread_file\b/, badge: { name: "Read", icon: FileText, color: "bg-amber-500/30 text-amber-300 border-violet-500/30" } },
  { pattern: /\bEdit\b|\bapply_patch\b/, badge: { name: "Edit", icon: Code2, color: "bg-emerald-500/30 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bWrite\b|\bwrite_file\b/, badge: { name: "Write", icon: FileText, color: "bg-emerald-500/30 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bBash\b/, badge: { name: "Bash", icon: Terminal, color: "bg-emerald-500/30 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bGlob\b/, badge: { name: "Glob", icon: FolderSearch, color: "bg-sky-500/30 text-sky-300 border-sky-500/30" } },
  { pattern: /\bGrep\b/, badge: { name: "Grep", icon: FolderSearch, color: "bg-sky-500/30 text-sky-300 border-sky-500/30" } },
  { pattern: /\bWrench\b|\bTool\b/, badge: { name: "Tool", icon: Wrench, color: "bg-sky-500/30 text-sky-300 border-sky-500/30" } },
];

function extractToolBadges(messages: { role: string; text: string }[]): ToolBadgeInfo[] {
  // Find the last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant?.text) return [];
  const seen = new Set<string>();
  const badges: ToolBadgeInfo[] = [];
  for (const { pattern, badge } of TOOL_PATTERNS) {
    if (pattern.test(lastAssistant.text) && !seen.has(badge.name)) {
      seen.add(badge.name);
      badges.push(badge);
    }
  }
  return badges;
}

export interface ChatNodeRenderData {
  harness: string;
  personaId: string;
  status: string;
  doing?: string;
  messages: { id: string; role: string; text: string; authorName?: string; streaming?: boolean }[];
  model?: string;
  effort?: string;
  // injected by CanvasView for search highlighting
  __searchMatch?: boolean;
}

export function ChatNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as ChatNodeRenderData;
  const persona = PERSONA_BY_ID[d.personaId];
  const removeNode = useAutumnStore((s) => s.removeNode);
  const duplicateNode = useAutumnStore((s) => s.duplicateNode);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const setSettingsNode = useAutumnStore((s) => s.setSettingsNode);
  const setConnectMode = useAutumnStore((s) => s.setConnectMode);
  const setAgentHistoryFor = useAutumnStore((s) => s.setAgentHistoryFor);
  const setAgentHistoryOpen = useAutumnStore((s) => s.setAgentHistoryOpen);
  const isRunning = useAutumnStore((s) => s.isAgentRunning[id] ?? false);
  const connectMode = useAutumnStore((s) => s.connectMode);
  const isConnectSource = connectMode?.from === id;
  const isConnectTargetCandidate =
    connectMode?.from !== null && connectMode?.from !== undefined && connectMode?.from !== id;
  const isInMultiSelect = useAutumnStore((s) => s.selectedNodeIds.includes(id));

  // Compute "last active" relative timestamp from messages
  const lastActiveTs = d.messages.length > 0
    ? (d.messages[d.messages.length - 1] as { ts?: number }).ts
    : undefined;
  const lastActiveRel = lastActiveTs ? relTimeAgo(lastActiveTs) : undefined;

  const status = STATUS_STYLES[d.status] ?? STATUS_STYLES.idle;
  const lastMsg = d.messages[d.messages.length - 1];
  const lastText =
    lastMsg?.role === "assistant" || lastMsg?.role === "peer"
      ? lastMsg.text
      : d.doing ?? "Standing by.";
  const peerCount = useAutumnStore(
    (s) =>
      s.edges.filter(
        (e) => e.kind === "bus" && (e.source === id || e.target === id),
      ).length,
  );

  // Tool badge extraction from messages
  const toolBadges = useMemo(() => extractToolBadges(d.messages), [d.messages]);
  const isActive = d.status === "working" || d.status === "thinking";

  // Handle tooltip state
  const [hoveredHandle, setHoveredHandle] = useState<"left" | "right" | null>(null);

  const handleOpen = () => {
    setSelectedNode(id);
    setRightPanelTab("commander");
  };

  const handleRun = () => {
    void runAgentForNode(id);
  };

  const handleStartConnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectMode({ from: id });
  };

  const handleDuplicate = () => {
    const newId = duplicateNode(id);
    if (newId) setSelectedNode(newId);
  };

  const handleViewHistory = () => {
    setAgentHistoryFor(id);
    setAgentHistoryOpen(true);
  };

  // Determine handle states
  const showPulse = !isActive && !connectMode;
  const sourceGlow = isConnectSource ? "handle-glow-source" : "";
  const targetGlow = isConnectTargetCandidate ? "handle-glow-target" : "";
  const handlePulseClass = showPulse ? "handle-pulse" : "";

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "w-[280px] rounded-xl border bg-card/95 backdrop-blur shadow-xl transition-all relative overflow-hidden chat-node-idle-glow",
          selected
            ? "border-amber-500/60 ring-2 ring-amber-500/30"
            : "border-border/60 hover:border-border",
          d.status === "idle" && !selected && "breathing-border",
          d.status === "working" && "agent-active",
          isConnectSource && "ring-2 ring-amber-400/80 animate-pulse",
          isConnectTargetCandidate &&
            "ring-2 ring-emerald-400/60 cursor-crosshair hover:ring-emerald-400",
          d.__searchMatch && "ring-2 ring-emerald-400/70 search-match-pulse",
          isInMultiSelect && !selected && "ring-2 ring-sky-400/60",
        )}
        style={{
          boxShadow: persona
            ? `0 8px 24px -8px ${persona.color}30, 0 0 0 1px ${persona.color}20`
            : undefined,
          ["--persona-color" as string]: persona?.color ?? "oklch(0.6 0.19 285)",
        }}
      >
        {/* Gradient top accent */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: persona
              ? `linear-gradient(90deg, ${persona.color}, ${persona.color}40, ${persona.color})`
              : undefined,
          }}
        />

        {/* Left Handle (target) — enhanced with ring, pulse, glow */}
        <Tooltip open={hoveredHandle === "left"}>
          <TooltipTrigger asChild>
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
              onMouseEnter={() => setHoveredHandle("left")}
              onMouseLeave={() => setHoveredHandle(null)}
            >
              <Handle
                type="target"
                position={Position.Left}
                className={cn(
                  "!w-[10px] !h-[10px] !border-2 !rounded-full !transition-all !duration-150",
                  handlePulseClass,
                  targetGlow,
                )}
                style={{
                  background: persona?.color ?? "oklch(0.6 0.19 285)",
                  borderColor: persona ? `${persona.color}80` : "oklch(0.16 0.02 55)",
                  boxShadow: isConnectTargetCandidate
                    ? `0 0 8px ${persona?.color ?? "#10b981"}80`
                    : `0 0 0 2px ${persona?.color ?? "oklch(0.6 0.19 285)"}30`,
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px]">
            {isConnectTargetCandidate ? "Drop to connect" : "Drag to connect"}
          </TooltipContent>
        </Tooltip>

        {/* Right Handle (source) — enhanced with ring, pulse, glow */}
        <Tooltip open={hoveredHandle === "right"}>
          <TooltipTrigger asChild>
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10"
              onMouseEnter={() => setHoveredHandle("right")}
              onMouseLeave={() => setHoveredHandle(null)}
            >
              <Handle
                type="source"
                position={Position.Right}
                className={cn(
                  "!w-[10px] !h-[10px] !border-2 !rounded-full !transition-all !duration-150",
                  handlePulseClass,
                  sourceGlow,
                )}
                style={{
                  background: persona?.color ?? "oklch(0.6 0.19 285)",
                  borderColor: persona ? `${persona.color}80` : "oklch(0.16 0.02 55)",
                  boxShadow: isConnectSource
                    ? `0 0 8px ${persona?.color ?? "#f59e0b"}80`
                    : `0 0 0 2px ${persona?.color ?? "oklch(0.6 0.19 285)"}30`,
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-[10px]">
            {isConnectSource ? "Now pick a target" : "Drag to connect"}
          </TooltipContent>
        </Tooltip>

        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl"
          style={{
            background: `linear-gradient(135deg, ${persona?.color}18, transparent)`,
          }}
        >
          <div className="relative">
            {/* Avatar ring that rotates slowly when running */}
            {isRunning && (
              <span
                className="avatar-ring-spin absolute -inset-1 rounded-lg border-2 border-dashed"
                style={{ borderColor: persona?.color ? `${persona.color}60` : "oklch(0.6 0.19 285 / 0.4)" }}
              />
            )}
            <div
              className={cn(
                "size-7 rounded-md flex items-center justify-center text-white text-xs font-bold shadow relative",
                isRunning && "persona-glyph-active",
              )}
              style={{ background: persona?.color }}
            >
              {persona?.glyph ?? <Bot className="size-4" />}
              {/* Checkmark overlay when status is done */}
              {d.status === "done" && (
                <span
                  className="checkmark-overlay absolute -bottom-1 -right-1 size-3.5 rounded-full bg-emerald-500 flex items-center justify-center"
                  style={{ boxShadow: "0 0 0 1.5px oklch(0.16 0.02 55)" }}
                >
                  <Check className="size-2 text-white" strokeWidth={3} />
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight truncate flex items-center gap-1.5">
              {persona?.name ?? "Agent"}
              {d.__searchMatch && (
                <Search className="size-3 text-emerald-400 shrink-0" />
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {d.harness} · {d.model ?? "default"}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleOpen} className="gap-2">
                Open chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRun} className="gap-2">
                {isRunning ? "Re-run" : "Run now"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleStartConnect} className="gap-2">
                <Cable className="size-3.5" />
                Connect to…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDuplicate} className="gap-2">
                <Copy className="size-3.5" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSettingsNode(id)}
                className="gap-2"
              >
                <Settings2 className="size-3.5" />
                Settings…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewHistory} className="gap-2">
                <History className="size-3.5" />
                View history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => removeNode(id)}
                className="gap-2 text-rose-400"
              >
                <Trash2 className="size-3.5" />
                Remove agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Body — subtle gradient background using persona color */}
        <div
          className="px-3 py-2.5 space-y-2"
          style={{
            background: persona
              ? `linear-gradient(135deg, ${persona.color}08, transparent 60%)`
              : undefined,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 rounded-full",
                status.dot,
                (d.status === "working" || d.status === "thinking") && "status-dot-glow",
              )}
            />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {status.label}
            </span>
            {lastActiveRel && (
              <span className="text-[9px] text-muted-foreground/50 font-mono">{lastActiveRel}</span>
            )}
            <div className="flex-1" />
            {peerCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-[9px] text-muted-foreground/70"
                title={`${peerCount} peer${peerCount === 1 ? "" : "s"} connected`}
              >
                <Cable className="size-2.5" />
                {peerCount}
              </span>
            )}
            {d.effort && (
              <Badge variant="outline" className="text-[9px] h-4 px-1">
                {d.effort}
              </Badge>
            )}
          </div>

          <div className="text-xs text-muted-foreground italic line-clamp-2 min-h-[2.5rem]">
            {lastText || "Standing by."}
          </div>

          {/* Working shimmer (when status is working/thinking but not streaming a message) */}
          {(d.status === "working" || d.status === "thinking") && !lastMsg?.streaming && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-300/90">
              <div className="flex items-center gap-0.5">
                <span className="thinking-dot size-1 rounded-full bg-violet-400" />
                <span className="thinking-dot size-1 rounded-full bg-violet-400" />
                <span className="thinking-dot size-1 rounded-full bg-violet-400" />
              </div>
              <span className="text-[9px] uppercase tracking-wider">
                {d.status === "thinking" ? "thinking" : "working"}
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-amber-500/40 via-amber-500/10 to-transparent rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-amber-400/80 shimmer-slide" />
              </div>
            </div>
          )}

          {/* Message preview / typing indicator */}
          {lastMsg?.streaming ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
              <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
              <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
              <span className="ml-1">streaming…</span>
            </div>
          ) : d.messages.length > 0 ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <MessageSquare className="size-2.5" />
              <span>
                {d.messages.length} message{d.messages.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 italic">
              <MessageSquare className="size-2.5" />
              <span>no messages yet — click Run to start</span>
            </div>
          )}

          {/* Tool-use badge strip — shows which tools the agent has used */}
          {toolBadges.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider mr-0.5">
                tools
              </span>
              {toolBadges.map((badge) => (
                <span
                  key={badge.name}
                  className={cn(
                    "inline-flex items-center gap-0.5 h-4 px-1 rounded text-[8px] font-medium border tool-badge-enter",
                    badge.color,
                  )}
                >
                  <badge.icon className="size-2" />
                  {badge.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-2 py-2 border-t border-border/40 flex items-center gap-1 rounded-b-xl">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] gap-1 flex-1"
            onClick={handleOpen}
          >
            Open chat
          </Button>
          <Button
            size="sm"
            variant={isRunning ? "secondary" : "default"}
            className="h-7 text-[11px] gap-1"
            onClick={handleRun}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Square className="size-3" /> Running
              </>
            ) : (
              <>
                <Play className="size-3" /> Run
              </>
            )}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Relative time helper for ChatNode "last active" timestamp */
function relTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
