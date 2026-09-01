// Autumn — ChatNode component (Autumn UI Clone Specification).
// Fully implemented according to autumn_ui_analysis.md:
// - Common window container shell with macOS traffic lights, title & shortcut badge.
// - 4 Cardinal connection anchors (top, bottom, left, right) in bright neon green (#22c55e).
// - "Ready when you are" idle state view with workspace metadata.
// - Active chat view with user message pills and markdown assistant output.
// - In-node interactive prompt box ("Ask anything... @ to reference").
// - Agent engine & profile footer bar with 16 integration engines.
// - Pinned Auto-reply status pill with tooltip.

"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps, NodeResizer } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import type { AgentHarness, PermissionLevel } from "@/lib/autumn/types";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { cn } from "@/lib/utils";
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
  ChevronDown,
  Paperclip,
  ArrowUp,
  Maximize2,
  Minus,
  X,
  Sparkles,
  Zap,
  Cpu,
  Layers,
  Globe,
  Folder,
  Send,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import ReactMarkdown from "react-markdown";

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  idle: { dot: "bg-zinc-500", label: "Idle", text: "text-zinc-400" },
  thinking: { dot: "bg-amber-400 animate-pulse", label: "Thinking", text: "text-amber-400" },
  working: { dot: "bg-emerald-400 animate-pulse", label: "Working", text: "text-emerald-400" },
  waiting: { dot: "bg-sky-400", label: "Waiting", text: "text-sky-400" },
  done: { dot: "bg-zinc-400", label: "Done", text: "text-zinc-400" },
  error: { dot: "bg-rose-500", label: "Error", text: "text-rose-400" },
  offline: { dot: "bg-zinc-700", label: "Offline", text: "text-zinc-500" },
};

// Supported runtime backend engines (from Autumn Registry Table 4.2)
const AGENT_ENGINES: { id: AgentHarness; label: string; desc: string; category: string }[] = [
  { id: "opencode", label: "opencode", desc: "Default lightweight open agent runner", category: "Open Spec" },
  { id: "claude-code", label: "claude code", desc: "Anthropic Claude code execution & refactoring", category: "LLM Engine" },
  { id: "codex", label: "codex", desc: "OpenAI Codex code synthesis", category: "LLM Engine" },
  { id: "cursor", label: "cursor", desc: "IDE-level automated edit engine", category: "Code Agent" },
  { id: "grok", label: "grok", desc: "xAI Grok code & context processing", category: "LLM Engine" },
  { id: "hermes", label: "hermes", desc: "Nous Hermes reasoning model", category: "LLM Engine" },
  { id: "gemini", label: "gemini", desc: "Google Gemini multimodal reasoning", category: "LLM Engine" },
  { id: "pi", label: "pi", desc: "Personal intelligence agent engine", category: "AI Engine" },
  { id: "cline", label: "cline", desc: "Autonomous CLI coding assistant", category: "Agent Tool" },
];

const EXTENDED_ENGINES = [
  { id: "lovable", label: "lovable", desc: "Full-stack app scaffolding", category: "Web Builder" },
  { id: "figma", label: "figma", desc: "UI component & frame inspection", category: "Design" },
  { id: "shortcut", label: "shortcut", desc: "Project management ticket sync", category: "Task System" },
  { id: "post-bridge", label: "post bridge", desc: "API webhooks & external bridge", category: "Messaging" },
  { id: "browser-use", label: "browser use", desc: "Browser automation & scraping", category: "Automation" },
  { id: "manus", label: "manus", desc: "General autonomous workflow agent", category: "Agent Platform" },
];

// Tool pattern detection for the tool-use badge strip
interface ToolBadgeInfo {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const TOOL_PATTERNS: { pattern: RegExp; badge: ToolBadgeInfo }[] = [
  { pattern: /\bTodoWrite\b|\bTodo\b/, badge: { name: "Todo", icon: Hash, color: "bg-amber-500/20 text-amber-300 border-amber-500/30" } },
  { pattern: /\bRead\b|\bread_file\b/, badge: { name: "Read", icon: FileText, color: "bg-amber-500/20 text-amber-300 border-amber-500/30" } },
  { pattern: /\bEdit\b|\bapply_patch\b/, badge: { name: "Edit", icon: Code2, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bWrite\b|\bwrite_file\b/, badge: { name: "Write", icon: FileText, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bBash\b|\bTerminal\b/, badge: { name: "Bash", icon: Terminal, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" } },
  { pattern: /\bGlob\b/, badge: { name: "Glob", icon: FolderSearch, color: "bg-sky-500/20 text-sky-300 border-sky-500/30" } },
  { pattern: /\bGrep\b/, badge: { name: "Grep", icon: FolderSearch, color: "bg-sky-500/20 text-sky-300 border-sky-500/30" } },
  { pattern: /\bWrench\b|\bTool\b/, badge: { name: "Tool", icon: Wrench, color: "bg-sky-500/20 text-sky-300 border-sky-500/30" } },
];

function extractToolBadges(messages: { role: string; text: string }[]): ToolBadgeInfo[] {
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
  harness: AgentHarness;
  personaId: string;
  status: string;
  doing?: string;
  messages: { id: string; role: string; text: string; authorName?: string; ts?: number; streaming?: boolean }[];
  model?: string;
  effort?: "low" | "medium" | "high";
  permission?: PermissionLevel;
  worktreePath?: string;
  autoReply?: boolean;
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
  const updateNodeData = useAutumnStore((s) => s.updateNodeData);
  const appendAgentMessage = useAutumnStore((s) => s.appendAgentMessage);
  const isRunning = useAutumnStore((s) => s.isAgentRunning[id] ?? false);
  const spawnAgentTerminal = useAutumnStore((s) => s.spawnAgentTerminal);
  const connectMode = useAutumnStore((s) => s.connectMode);
  const isConnectSource = connectMode?.from === id;
  const isConnectTargetCandidate =
    connectMode?.from !== null && connectMode?.from !== undefined && connectMode?.from !== id;
  const isInMultiSelect = useAutumnStore((s) => s.selectedNodeIds.includes(id));

  // Local prompt state
  const [promptText, setPromptText] = useState("");
  const [isEngineMenuOpen, setIsEngineMenuOpen] = useState(false);
  const [isEffortMenuOpen, setIsEffortMenuOpen] = useState(false);
  const [isPermissionMenuOpen, setIsPermissionMenuOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-reply state
  const autoReply = d.autoReply ?? true;

  // Run timer when agent is running
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isRunning) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isRunning]);

  // Scroll chat messages to bottom
  useEffect(() => {
    if (d.messages && d.messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [d.messages, isRunning]);

  const status = STATUS_STYLES[d.status] ?? STATUS_STYLES.idle;
  const peerCount = useAutumnStore(
    (s) =>
      s.edges.filter(
        (e) => e.kind === "bus" && (e.source === id || e.target === id),
      ).length,
  );

  const toolBadges = useMemo(() => extractToolBadges(d.messages ?? []), [d.messages]);
  const hasMessages = d.messages && d.messages.length > 0;
  const workspacePath = d.worktreePath || "autumn/untitled-workspace";

  const handleOpenPanel = () => {
    setSelectedNode(id);
    setRightPanelTab("commander");
  };

  const handleRun = () => {
    const termId = spawnAgentTerminal(id);
    if (!termId) {
      void runAgentForNode(id);
    }
  };

  const handleStop = () => {
    useAutumnStore.getState().setAgentRunning(id, false);
    useAutumnStore.getState().setAgentStatus(id, "idle", "Stopped by user.");
  };

  const handleSendMessage = () => {
    const text = promptText.trim();
    if (!text) return;
    setPromptText("");

    // Append user message to store
    appendAgentMessage(id, {
      role: "user",
      text,
    });

    // Run agent with the new prompt
    void runAgentForNode(id, text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleAutoReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNodeData(id, { autoReply: !autoReply });
  };

  const setHarness = (harness: AgentHarness) => {
    updateNodeData(id, { harness });
    setIsEngineMenuOpen(false);
  };

  const setEffort = (effort: "low" | "medium" | "high") => {
    updateNodeData(id, { effort });
    setIsEffortMenuOpen(false);
  };

  const setPermission = (permission: PermissionLevel) => {
    updateNodeData(id, { permission });
    setIsPermissionMenuOpen(false);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

    return (
    <TooltipProvider delayDuration={150}>
      <div className="relative group">
        <NodeResizer
          isVisible={!!selected}
          minWidth={300}
          minHeight={200}
          handleClassName="!size-3 !bg-blue-500 !border-white !rounded-sm shadow"
          lineClassName="!border-blue-500/40"
        />
        {/* Cardinal Connection Anchors: Top, Bottom, Left, Right */}
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          className="autumn-handle !top-0 !left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className="autumn-handle !left-0 !top-1/2 -translate-x-1/2 -translate-y-1/2"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="autumn-handle !right-0 !top-1/2 translate-x-1/2 -translate-y-1/2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          className="autumn-handle !bottom-0 !left-1/2 -translate-x-1/2 translate-y-1/2"
        />

        {/* Main Window Frame Shell */}
        <div
          className={cn(
            "w-[360px] autumn-window-frame overflow-hidden flex flex-col transition-all",
            selected && "autumn-node-selected",
            isConnectSource && "ring-2 ring-amber-400 animate-pulse",
            isConnectTargetCandidate && "ring-2 ring-emerald-400 cursor-crosshair",
            d.__searchMatch && "ring-2 ring-emerald-400/80",
            isInMultiSelect && !selected && "ring-2 ring-sky-400/70",
          )}
          style={{
            borderColor: selected ? "#3b82f6" : undefined,
          }}
        >
          {/* Header Bar - Windows style, controls on right */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a] bg-[#18181b]/80 select-none">
            {/* Left: Title & Subtitle Badge */}
            <div className="flex-1 min-w-0 flex items-center gap-1.5 mr-2">
              {persona?.icon ? (
                <img src={persona.icon} alt={persona.name} className="size-5 rounded-md object-cover shrink-0" />
              ) : (
                <div
                  className="size-4 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                  style={{ background: persona?.color ?? "#2563eb" }}
                >
                  {persona?.glyph ?? <Bot className="size-2.5" />}
                </div>
              )}
              <span className="text-xs font-semibold text-zinc-200 truncate">
                {persona?.name ?? "Atlas"}
              </span>
              {d.harness && <span className="text-[10px] text-zinc-500 truncate">· {d.harness}</span>}
              {peerCount > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[9px] text-emerald-400/80 bg-emerald-500/10 px-1 py-0.2 rounded"
                  title={`${peerCount} connected peer${peerCount > 1 ? "s" : ""}`}
                >
                  <Cable className="size-2.5" />
                  {peerCount}
                </span>
              )}
            </div>

            {/* Right: Windows controls + menu */}
            <div className="flex items-center gap-0.5 ml-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-zinc-400 hover:text-white hover:bg-white/10"
                  >
                    <MoreHorizontal className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-[#18181b] border-[#27272a] text-zinc-200">
                  <DropdownMenuItem onClick={handleOpenPanel} className="gap-2 text-xs">
                    <MessageSquare className="size-3.5" /> Open full chat
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRun} className="gap-2 text-xs">
                    <Play className="size-3.5" /> {isRunning ? "Re-run" : "Run agent"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setConnectMode({ from: id });
                    }}
                    className="gap-2 text-xs"
                  >
                    <Cable className="size-3.5" /> Connect to…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateNode(id)} className="gap-2 text-xs">
                    <Copy className="size-3.5" /> Duplicate node
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setAgentHistoryFor(id);
                      setAgentHistoryOpen(true);
                    }}
                    className="gap-2 text-xs"
                  >
                    <History className="size-3.5" /> View run history
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSettingsNode(id)} className="gap-2 text-xs">
                    <Settings2 className="size-3.5" /> Agent settings…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-[#27272a]" />
                  <DropdownMenuItem onClick={() => removeNode(id)} className="gap-2 text-xs text-rose-400">
                    <Trash2 className="size-3.5" /> Remove agent
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={handleOpenPanel}
                className="size-7 flex items-center justify-center hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                title="Minimize"
              >
                <Minus className="size-3" />
              </button>
              <button
                onClick={handleOpenPanel}
                className="size-7 flex items-center justify-center hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                title="Maximize"
              >
                <Square className="size-3" />
              </button>
              <button
                onClick={() => removeNode(id)}
                className="size-7 flex items-center justify-center hover:bg-red-600 text-zinc-400 hover:text-white transition-colors"
                title="Close"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Main Content Body */}
          <div className="p-3 flex-1 flex flex-col justify-between min-h-[160px] max-h-[280px] overflow-y-auto autumn-scroll bg-[#121214]">
            {!hasMessages ? (
              /* Idle / Empty State View */
              <div className="flex flex-col items-center justify-center py-5 text-center space-y-3 my-auto">
                <div
                  className="size-12 rounded-xl flex items-center justify-center shadow-lg relative border border-white/10"
                  style={{
                    background: `linear-gradient(135deg, ${persona?.color ?? "#2563eb"}30, #18181b)`,
                    boxShadow: `0 0 20px ${persona?.color ?? "#2563eb"}20`,
                  }}
                >
                  <div
                    className="size-8 rounded-lg flex items-center justify-center text-white text-base font-bold"
                    style={{ background: persona?.color ?? "#2563eb" }}
                  >
                    {persona?.glyph ?? <Bot className="size-5" />}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">Ready when you are</h4>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-500 mt-1 font-mono">
                    <span className="text-zinc-400">{d.model || "default model"}</span>
                    <span>•</span>
                    <span className="text-zinc-400">project-wide edits</span>
                  </div>
                  <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-600 mt-0.5 truncate max-w-[280px]">
                    <Folder className="size-2.5" />
                    <span className="truncate">{workspacePath}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Active Chat Message View */
              <div className="space-y-2.5 flex-1 flex flex-col justify-end">
                {d.messages.slice(-3).map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "text-xs leading-relaxed",
                      msg.role === "user" ? "flex justify-end" : "flex flex-col items-start",
                    )}
                  >
                    {msg.role === "user" ? (
                      <div className="autumn-user-bubble px-3 py-1.5 max-w-[85%] text-[11.5px]">
                        {msg.text}
                      </div>
                    ) : (
                      <div className="bg-[#1c1c20] text-zinc-200 border border-[#27272a] rounded-xl rounded-tl-sm px-3 py-2 max-w-[95%] space-y-1">
                        <div className="text-[11.5px] prose-invert max-w-none line-clamp-3">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Real-Time Execution Status Indicator */}
                {isRunning && (
                  <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-xs text-amber-300">
                    <div className="flex items-center gap-2">
                      <Zap className="size-3 text-amber-400 animate-bounce" />
                      <span className="font-mono text-[10px]">{formatTimer(elapsedSeconds)}</span>
                      <span className="text-[11px] truncate max-w-[180px]">
                        {d.doing || "Agent is working..."}
                      </span>
                    </div>
                    <button
                      onClick={handleStop}
                      className="size-5 rounded bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white flex items-center justify-center transition-colors"
                      title="Cancel execution"
                    >
                      <Square className="size-2.5 fill-current" />
                    </button>
                  </div>
                )}

                {/* Tool Badges Strip */}
                {toolBadges.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    <span className="text-[8px] text-zinc-500 uppercase tracking-wider mr-0.5">Tools:</span>
                    {toolBadges.map((b) => (
                      <span
                        key={b.name}
                        className={cn(
                          "inline-flex items-center gap-0.5 h-4 px-1 rounded text-[8px] font-medium border",
                          b.color,
                        )}
                      >
                        <b.icon className="size-2" />
                        {b.name}
                      </span>
                    ))}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Interactive In-Node Prompt Box */}
          <div className="p-2 bg-[#141417] border-t border-[#27272a]">
            <div className="autumn-prompt-container flex items-center gap-1.5 px-2.5 py-1.5">
              <span className="text-zinc-500 font-mono text-xs font-semibold select-none">&gt;</span>
              <input
                type="text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything... @ to reference"
                className="flex-1 bg-transparent border-none outline-none text-xs text-zinc-100 placeholder:text-zinc-500 focus:ring-0"
              />
              <button
                type="button"
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                title="Attach file (@ reference)"
                onClick={handleOpenPanel}
              >
                <Paperclip className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={!promptText.trim() || isRunning}
                className={cn(
                  "size-6 rounded-md flex items-center justify-center transition-all",
                  promptText.trim() && !isRunning
                    ? "bg-blue-600 text-white hover:bg-blue-500 shadow-md"
                    : "text-zinc-600 cursor-not-allowed",
                )}
                title="Send task"
              >
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Agent Engine & Controls Footer Bar */}
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#101012] border-t border-[#27272a] text-[10px] select-none">
            {/* Left: Engine Model Selector */}
            <Popover open={isEngineMenuOpen} onOpenChange={setIsEngineMenuOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors font-medium">
                  <Cpu className="size-3 text-blue-400" />
                  <span>{d.harness}</span>
                  <ChevronDown className="size-2.5 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-1.5 bg-[#18181b] border-[#27272a] text-zinc-200">
                <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-[#27272a] mb-1">
                  Supported AI Engines
                </div>
                <div className="max-h-56 overflow-y-auto autumn-scroll space-y-0.5">
                  {AGENT_ENGINES.map((eng) => (
                    <button
                      key={eng.id}
                      onClick={() => setHarness(eng.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs hover:bg-zinc-800 transition-colors",
                        d.harness === eng.id && "bg-blue-600/20 text-blue-300 font-semibold",
                      )}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span>{eng.label}</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                            {eng.category}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-500 leading-tight">{eng.desc}</div>
                      </div>
                      {d.harness === eng.id && <Check className="size-3 text-blue-400 shrink-0" />}
                    </button>
                  ))}
                  <div className="px-2 py-1 text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mt-1 border-t border-[#27272a]">
                    Tool Integrations
                  </div>
                  {EXTENDED_ENGINES.map((ext) => (
                    <div
                      key={ext.id}
                      className="px-2 py-1 text-[11px] text-zinc-400 flex items-center justify-between hover:bg-zinc-800/50 rounded"
                    >
                      <span>{ext.label}</span>
                      <span className="text-[9px] text-zinc-500">{ext.category}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Center: Execution Profile Selector */}
            <Popover open={isEffortMenuOpen} onOpenChange={setIsEffortMenuOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors">
                  <span>{d.effort ? `${d.effort} effort` : "default model"}</span>
                  <ChevronDown className="size-2.5 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-40 p-1 bg-[#18181b] border-[#27272a] text-zinc-200">
                {(["low", "medium", "high"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setEffort(lvl)}
                    className={cn(
                      "w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-zinc-800 capitalize",
                      d.effort === lvl && "text-blue-300 font-semibold",
                    )}
                  >
                    <span>{lvl} effort</span>
                    {d.effort === lvl && <Check className="size-3 text-blue-400" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Right: Permission / Run Mode */}
            <Popover open={isPermissionMenuOpen} onOpenChange={setIsPermissionMenuOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors">
                  <span className={cn(
                    d.permission === "yolo" ? "text-amber-400 font-medium" : "text-zinc-400"
                  )}>
                    {d.permission === "yolo" ? "auto run" : d.permission === "auto" ? "auto" : "ask mode"}
                  </span>
                  <ChevronDown className="size-2.5 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-36 p-1 bg-[#18181b] border-[#27272a] text-zinc-200">
                <button
                  onClick={() => setPermission("yolo")}
                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-zinc-800"
                >
                  <span>auto run</span>
                  {d.permission === "yolo" && <Check className="size-3 text-blue-400" />}
                </button>
                <button
                  onClick={() => setPermission("auto")}
                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-zinc-800"
                >
                  <span>auto</span>
                  {d.permission === "auto" && <Check className="size-3 text-blue-400" />}
                </button>
                <button
                  onClick={() => setPermission("ask")}
                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-zinc-800"
                >
                  <span>ask mode</span>
                  {d.permission === "ask" && <Check className="size-3 text-blue-400" />}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Pinned Auto-Reply Status Pill (Attached Beneath Node Window) */}
        <div className="flex justify-center mt-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleAutoReply}
                className={cn(
                  "autumn-autoreply-pill flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium border transition-all",
                  autoReply
                    ? "bg-[#18181b]/90 border-emerald-500/40 text-emerald-300 hover:border-emerald-500"
                    : "bg-[#18181b]/80 border-zinc-700/60 text-zinc-400 hover:border-zinc-600",
                )}
              >
                <Zap className={cn("size-3", autoReply ? "text-emerald-400" : "text-zinc-500")} />
                <span>Auto-reply {autoReply ? "ON" : "OFF"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-xs bg-[#18181b] border-[#27272a] text-zinc-300">
              {autoReply
                ? "Auto-reply is ON — this agent reads and acts on messages from connected nodes."
                : "Auto-reply is OFF — click to enable autonomous message replies."}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
