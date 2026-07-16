// Autumn — Agent chat panel (shown when a chat node is selected).
// Shows the agent's message history and lets the user send it a new task.

"use client";

import { useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Send,
  Play,
  Square,
  Bot,
  Sparkles,
  MessageSquare,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  History,
  Timer,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

export function AgentChatPanel({ nodeId }: { nodeId: string }) {
  const node = useAutumnStore((s) => s.nodes.find((n) => n.id === nodeId));
  const isRunning = useAutumnStore((s) => s.isAgentRunning[nodeId] ?? false);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const appendAgentMessage = useAutumnStore((s) => s.appendAgentMessage);
  const setAgentStatus = useAutumnStore((s) => s.setAgentStatus);
  const setAgentHistoryFor = useAutumnStore((s) => s.setAgentHistoryFor);
  const setAgentHistoryOpen = useAutumnStore((s) => s.setAgentHistoryOpen);
  const busHistory = useAutumnStore((s) => s.busHistory);
  const agentRunDurations = useAutumnStore((s) => s.agentRunDurations);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  const data = node?.data as {
    harness?: string;
    personaId?: string;
    status?: string;
    doing?: string;
    model?: string;
    effort?: string;
    messages: {
      id: string;
      role: string;
      text: string;
      authorName?: string;
      streaming?: boolean;
      ts: number;
    }[];
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [data?.messages.length, isRunning]);

  if (!node || node.kind !== "chat") {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        Select an agent to view its chat.
      </div>
    );
  }

  const persona = PERSONA_BY_ID[data.personaId ?? ""];

  // Stats: messages, handoffs sent, handoffs received, last activity.
  const userMsgs = data.messages.filter((m) => m.role === "user").length;
  const assistantMsgs = data.messages.filter((m) => m.role === "assistant").length;
  const peerMsgs = data.messages.filter((m) => m.role === "peer").length;
  const sentHandoffs = busHistory.filter((p) => p.fromNodeId === nodeId).length;
  const recvHandoffs = busHistory.filter((p) => p.toNodeId === nodeId).length;
  const lastActivity = data.messages.length > 0
    ? data.messages[data.messages.length - 1].ts
    : null;

  // Compute avg run duration from in-memory tracking
  const runDurations = agentRunDurations[nodeId] ?? [];
  const completedDurations = runDurations.filter((d) => d.end !== undefined);
  const avgRunMs = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((sum, d) => sum + (d.end! - d.start), 0) / completedDurations.length)
    : null;

  const send = async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    appendAgentMessage(nodeId, { role: "user", text, authorName: "You" });
    setAgentStatus(nodeId, "working", "Task received.");
    await runAgentForNode(nodeId, text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Gradient background strip using persona color */}
      <div
        className="agent-chat-gradient-strip"
        style={{
          background: persona
            ? `linear-gradient(90deg, ${persona.color}, ${persona.color}60, ${persona.color}20)`
            : "linear-gradient(90deg, oklch(0.78 0.18 55), oklch(0.78 0.18 55 / 0.4), transparent)",
        }}
      />

      {/* Header */}
      <div className="border-b border-border/50 px-3 py-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setSelectedNode(null)}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <div
          className="size-7 rounded-md flex items-center justify-center text-white text-xs font-bold shadow"
          style={{ background: persona?.color }}
        >
          {persona?.glyph ?? <Bot className="size-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight truncate">
            {persona?.name ?? node.name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.harness} · {data.model ?? "default"}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] gap-1 text-muted-foreground"
          onClick={() => {
            setAgentHistoryFor(nodeId);
            setAgentHistoryOpen(true);
          }}
          title="View this agent's execution history"
        >
          <History className="size-3" />
          History
        </Button>
        <Button
          size="sm"
          variant={isRunning ? "secondary" : "default"}
          className="h-7 text-[11px] gap-1"
          onClick={() => void runAgentForNode(nodeId)}
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

      {/* Persona tagline + stats card */}
      <div className="px-3 py-2 border-b border-border/50 bg-muted/20 space-y-2">
        <div className="text-[10px] text-muted-foreground italic">
          {persona?.tagline} · {persona?.specialty}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              data.status === "working" && "bg-emerald-400 animate-pulse",
              data.status === "thinking" && "bg-violet-400 animate-pulse",
              data.status === "done" && "bg-zinc-400",
              data.status === "idle" && "bg-zinc-500",
              data.status === "error" && "bg-rose-500",
            )}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {data.status ?? "idle"}
          </span>
          {data.doing && (
            <span className="text-[10px] text-muted-foreground/70 truncate">
              · {data.doing}
            </span>
          )}
        </div>
        {/* Stats row */}
        <div className="grid grid-cols-5 gap-1">
          <StatChip
            icon={MessageSquare}
            label="msgs"
            value={data.messages.length}
            color="text-violet-300"
          />
          <StatChip
            icon={ArrowUpRight}
            label="sent"
            value={sentHandoffs}
            color="text-emerald-300"
          />
          <StatChip
            icon={ArrowDownLeft}
            label="recv"
            value={recvHandoffs}
            color="text-sky-300"
          />
          <StatChip
            icon={Timer}
            label="avg run"
            value={avgRunMs !== null ? formatAvgDuration(avgRunMs) : "—"}
            color="text-violet-300"
            mono
          />
          <StatChip
            icon={Clock}
            label="last"
            value={lastActivity ? relTime(lastActivity) : "—"}
            color="text-muted-foreground"
            mono
          />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto autumn-scroll p-3 space-y-3"
      >
        {data.messages.map((m) => (
          <MessageBubble key={m.id} message={m} personaColor={persona?.color} isAgentRunning={isRunning} />
        ))}
        {/* Typing indicator when agent is working */}
        {isRunning && data.messages.length > 0 && !data.messages[data.messages.length - 1]?.streaming && (
          <div className="flex items-center gap-2 pl-1">
            <div
              className="size-6 shrink-0 rounded-md flex items-center justify-center text-white text-[10px] font-bold shadow"
              style={{ background: persona?.color }}
            >
              <Sparkles className="size-3" />
            </div>
            <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-muted/40 border border-border/40">
              <span className="typing-indicator-dot size-1.5 rounded-full bg-violet-400" />
              <span className="typing-indicator-dot size-1.5 rounded-full bg-violet-400" />
              <span className="typing-indicator-dot size-1.5 rounded-full bg-violet-400" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-3 space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Send a task to ${persona?.name ?? "this agent"}…`}
          className="min-h-[50px] max-h-[120px] resize-none bg-muted/30 border-border/50 text-sm"
          disabled={isRunning}
        />
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px] h-5 px-1.5">
            ⏎ send
          </Badge>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => void send()}
            disabled={isRunning || !input.trim()}
          >
            <Send className="size-3" />
            Send task
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  personaColor,
  isAgentRunning,
}: {
  message: {
    id: string;
    role: string;
    text: string;
    authorName?: string;
    streaming?: boolean;
    ts: number;
  };
  personaColor?: string;
  isAgentRunning?: boolean;
}) {
  const isUser = message.role === "user";
  const isPeer = message.role === "peer";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";

  if (isSystem) {
    return (
      <div className="text-center">
        <span className="text-[10px] text-muted-foreground/60 bg-muted/30 rounded-full px-2 py-0.5">
          {message.text}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2.5 message-bubble-hover",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div
        className={cn(
          "size-6 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold shadow",
          isUser
            ? "bg-zinc-700 text-zinc-100"
            : isPeer
              ? "bg-sky-500/80 text-white"
              : "text-white",
        )}
        style={
          !isUser && !isPeer && personaColor
            ? { background: personaColor }
            : undefined
        }
      >
        {isUser ? "You" : isPeer ? "↗" : <Sparkles className="size-3" />}
      </div>
      <div
        className={cn(
          "rounded-xl px-3 py-2 max-w-[85%] text-sm leading-relaxed relative",
          isUser
            ? "bg-zinc-700/60 text-zinc-100 border border-zinc-600/40"
            : isPeer
              ? "bg-sky-500/10 border border-sky-500/30"
              : "bg-muted/40 border border-border/40",
        )}
      >
        {message.authorName && !isUser && (
          <div className="text-[10px] font-semibold text-muted-foreground mb-0.5">
            {message.authorName}
            {isPeer && " → message_peer"}
          </div>
        )}
        <div className="prose prose-sm prose-invert max-w-none [&_code]:text-violet-300 [&_code]:bg-violet-500/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono [&_pre]:bg-muted/40 [&_pre]:border [&_pre]:border-border/40 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-[11px] [&_pre]:overflow-x-auto">
          <ReactMarkdown>{message.text || "…"}</ReactMarkdown>
        </div>
        {/* Message timestamp */}
        <div className="message-timestamp">{relTime(message.ts)}</div>
        {message.streaming && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
            <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
            <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
            <span className="typing-dot size-1.5 rounded-full bg-violet-400" />
          </div>
        )}
        {/* Copy message button on assistant messages */}
        {isAssistant && message.text && !message.streaming && (
          <button
            className="copy-message-btn absolute top-1.5 right-1.5 size-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
            onClick={() => void navigator.clipboard.writeText(message.text)}
            title="Copy message"
          >
            <Copy className="size-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  color,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md bg-muted/40 border border-border/40 px-1.5 py-1 flex flex-col items-center gap-0.5 hover:bg-muted/60 transition-colors">
      <div className={cn("flex items-center gap-0.5 text-[8px] uppercase tracking-wider", color)}>
        <Icon className="size-2.5" />
        <span>{label}</span>
      </div>
      <div className={cn("text-[11px] font-semibold leading-none", mono && "font-mono text-[10px] text-muted-foreground")}>
        {value}
      </div>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function formatAvgDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  return remSec === 0 ? `${totalMin}m` : `${totalMin}m${remSec}s`;
}
