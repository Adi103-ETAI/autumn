// Autumn — ChatNode component (agent node on the canvas).
// The most complex node type: shows persona, harness, status, doing, message
// preview, and supports sending a task. Click to expand chat in the right panel.

"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { ChatNodeData } from "@/lib/autumn/types";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const isRunning = useAutumnStore((s) => s.isAgentRunning[id] ?? false);
  const connectMode = useAutumnStore((s) => s.connectMode);
  const isConnectSource = connectMode?.from === id;
  const isConnectTargetCandidate =
    connectMode?.from !== null && connectMode?.from !== undefined && connectMode?.from !== id;
  const isInMultiSelect = useAutumnStore((s) => s.selectedNodeIds.includes(id));

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

  return (
    <div
      className={cn(
        "w-[280px] rounded-xl border bg-card/95 backdrop-blur shadow-xl transition-all relative overflow-hidden",
        selected
          ? "border-amber-500/70 ring-2 ring-amber-500/30"
          : "border-border/60 hover:border-border",
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
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: persona?.color }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: persona?.color }}
      />

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl"
        style={{
          background: `linear-gradient(135deg, ${persona?.color}18, transparent)`,
        }}
      >
        <div
          className={cn(
            "size-7 rounded-md flex items-center justify-center text-white text-xs font-bold shadow relative",
            isRunning && "persona-glyph-active",
          )}
          style={{ background: persona?.color }}
        >
          {persona?.glyph ?? <Bot className="size-4" />}
          {isRunning && (
            <span
              className="absolute -inset-0.5 rounded-md ring-2 ring-offset-0"
              style={{
                borderColor: persona?.color,
                boxShadow: `0 0 0 2px ${persona?.color}40`,
              }}
            />
          )}
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

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {status.label}
          </span>
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
              <span className="thinking-dot size-1 rounded-full bg-amber-400" />
              <span className="thinking-dot size-1 rounded-full bg-amber-400" />
              <span className="thinking-dot size-1 rounded-full bg-amber-400" />
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
            <span className="typing-dot size-1.5 rounded-full bg-amber-400" />
            <span className="typing-dot size-1.5 rounded-full bg-amber-400" />
            <span className="typing-dot size-1.5 rounded-full bg-amber-400" />
            <span className="ml-1">streaming…</span>
          </div>
        ) : (
          d.messages.length > 0 && (
            <div className="text-[10px] text-muted-foreground/70">
              {d.messages.length} message{d.messages.length === 1 ? "" : "s"}
            </div>
          )
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
  );
}
