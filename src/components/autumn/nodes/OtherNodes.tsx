// Autumn — simpler node components (terminal, screen, sticky, analytics, browser, remotion).
// Each is a compact card on the react-flow canvas.

"use client";

import { useState, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TerminalSquare,
  MonitorSmartphone,
  StickyNote,
  BarChart3,
  Globe,
  Clapperboard,
  X,
  Smartphone,
  Monitor,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const HANDLE_STYLE = { background: "oklch(0.6 0.19 285)" };

function NodeShell({
  id,
  selected,
  color,
  children,
  width = "w-[240px]",
}: {
  id: string;
  selected?: boolean;
  color: string;
  children: React.ReactNode;
  width?: string;
}) {
  const removeNode = useAutumnStore((s) => s.removeNode);
  return (
    <div
      className={cn(
        `${width} rounded-xl border bg-card/95 backdrop-blur shadow-lg transition-all`,
        selected
          ? "border-amber-500/60 ring-2 ring-amber-500/30"
          : "border-border/60 hover:border-border",
      )}
      style={{ boxShadow: `0 6px 16px -8px ${color}40` }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div className="relative">{children}</div>
      <button
        onClick={() => removeNode(id)}
        className="absolute top-1.5 right-1.5 size-5 rounded-md text-muted-foreground/50 hover:text-rose-400 hover:bg-rose-500/10 flex items-center justify-center transition-colors"
        aria-label="Remove node"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

interface TerminalData {
  agent?: string;
  dir?: string;
  status: string;
  port?: number;
  lines: { text: string; kind?: string; ts: number }[];
}

// Canned responses for the simulated shell. The real terminal (user-machine
// PTY) is deferred to the final phase — this keeps the node feeling alive.
function simulateCommand(cmd: string, dir: string): { text: string; kind?: string }[] {
  const c = cmd.trim().toLowerCase();
  if (c === "" ) return [];
  if (c === "clear" || c === "cls") return [{ text: "__clear__", kind: "system" }];
  if (c === "help") return [
    { text: "Available commands:", kind: "info" },
    { text: "  ls         list files", kind: "stdout" },
    { text: "  pwd        print working directory", kind: "stdout" },
    { text: "  npm <cmd>  run an npm script", kind: "stdout" },
    { text: "  git <cmd>  run a git command", kind: "stdout" },
    { text: "  echo <x>   print text", kind: "stdout" },
    { text: "  clear      clear the terminal", kind: "stdout" },
  ];
  if (c === "ls") return [
    { text: "README.md  package.json  src/  public/  prisma/  next.config.ts", kind: "stdout" },
  ];
  if (c === "pwd") return [{ text: dir || "/home/user/project", kind: "stdout" }];
  if (c === "npm run dev") return [
    { text: "> autumn@0.1.0 dev", kind: "info" },
    { text: "> next dev", kind: "info" },
    { text: "  ▲ Next.js 16.0.0", kind: "stdout" },
    { text: "  - Local:   http://localhost:3000", kind: "stdout" },
    { text: "  ✓ Ready in 1.2s", kind: "stdout" },
  ];
  if (c.startsWith("npm install") || c.startsWith("npm i")) return [
    { text: "added 312 packages in 4s", kind: "stdout" },
    { text: "✓ done", kind: "stdout" },
  ];
  if (c.startsWith("git status")) return [
    { text: "On branch main", kind: "stdout" },
    { text: "nothing to commit, working tree clean", kind: "stdout" },
  ];
  if (c.startsWith("git ")) return [{ text: "ok", kind: "stdout" }];
  if (c.startsWith("echo ")) return [{ text: cmd.slice(5), kind: "stdout" }];
  if (c === "whoami") return [{ text: "autumn-user", kind: "stdout" }];
  if (c === "date") return [{ text: new Date().toString(), kind: "stdout" }];
  return [{ text: `command not found: ${cmd.split(" ")[0]}`, kind: "stderr" }];
}

export function TerminalNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as TerminalData;
  const updateNodeData = useAutumnStore((s) => s.updateNodeData);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when lines change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [d.lines.length]);

  const dir = d.dir || "~/project";
  const prompt = `${dir}$`;

  const runCommand = () => {
    const cmd = input;
    setInput("");
    const out = simulateCommand(cmd, dir);
    const newLines = [...d.lines];
    // echo the command
    if (cmd.trim()) {
      newLines.push({ text: `${prompt} ${cmd}`, kind: "command", ts: Date.now() });
    }
    if (out.length && out[0].text === "__clear__") {
      updateNodeData(id, { lines: [] });
      return;
    }
    for (const line of out) {
      newLines.push({ text: line.text, kind: line.kind, ts: Date.now() });
    }
    updateNodeData(id, { lines: newLines.slice(-50) });
  };

  const isEmpty = d.lines.length === 0;

  return (
    <NodeShell id={id} selected={selected} color="#22c55e" width="w-[320px]">
      {/* Terminal title bar — macOS-style traffic lights + title */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 rounded-t-xl bg-zinc-900/80">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-500/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-[11px] font-medium text-zinc-300 ml-1 truncate">
          {d.agent ? `${d.agent} — bash` : "bash — plain shell"}
        </span>
        {d.port && (
          <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1 border-emerald-500/40 text-emerald-300">
            :{d.port}
          </Badge>
        )}
      </div>
      {/* Terminal body — near-black, monospace */}
      <div
        ref={scrollRef}
        className="px-3 py-2 font-mono text-[10.5px] leading-relaxed space-y-0.5 max-h-40 overflow-y-auto autumn-scroll bg-zinc-950/95"
      >
        {isEmpty && (
          <div className="text-zinc-500 italic">
            <span className="text-emerald-400">~$</span> click for a plain shell
          </div>
        )}
        {d.lines.slice(-20).map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              l.kind === "stderr" && "text-rose-400",
              l.kind === "command" && "text-amber-200",
              l.kind === "info" && "text-sky-300",
              l.kind === "system" && "text-zinc-500",
              (!l.kind || l.kind === "stdout") && "text-emerald-200/85",
            )}
          >
            {l.text}
          </div>
        ))}
        {/* Live prompt + input */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-emerald-400 shrink-0">{prompt}</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runCommand();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent outline-none border-none text-emerald-100 caret-emerald-400 placeholder:text-zinc-600"
            placeholder={isEmpty ? "type a command…" : ""}
            aria-label="Terminal input"
          />
          <span className="text-amber-300 animate-pulse">▌</span>
        </div>
      </div>
      {d.dir && (
        <div className="px-3 py-1 border-t border-border/40 text-[9px] text-muted-foreground/70 truncate font-mono">
          {d.dir}
        </div>
      )}
    </NodeShell>
  );
}

interface ScreenData {
  screenKind: "desktop" | "phone";
  name: string;
  route?: string;
  url?: string;
}
export function ScreenNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as ScreenData;
  const isPhone = d.screenKind === "phone";
  return (
    <NodeShell
      id={id}
      selected={selected}
      color="#3b82f6"
      width={isPhone ? "w-[180px]" : "w-[260px]"}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl bg-sky-500/5">
        {isPhone ? (
          <Smartphone className="size-3.5 text-sky-400" />
        ) : (
          <Monitor className="size-3.5 text-sky-400" />
        )}
        <span className="text-xs font-medium truncate">{d.name}</span>
        {d.route && (
          <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1">
            {d.route}
          </Badge>
        )}
      </div>
      <div
        className={cn(
          "bg-gradient-to-br from-sky-500/10 to-indigo-500/5 flex items-center justify-center",
          isPhone ? "h-44" : "h-32",
        )}
      >
        <div className="text-center">
          <MonitorSmartphone className="size-8 text-sky-400/40 mx-auto" />
          <div className="text-[10px] text-muted-foreground mt-1">
            preview surface
          </div>
        </div>
      </div>
    </NodeShell>
  );
}

interface StickyData {
  text: string;
  color?: string;
}
const STICKY_COLORS: Record<string, string> = {
  amber: "bg-amber-400/90 text-violet-950 border-amber-300",
  rose: "bg-rose-400/90 text-rose-950 border-rose-300",
  emerald: "bg-emerald-400/90 text-emerald-950 border-emerald-300",
  violet: "bg-amber-400/90 text-violet-950 border-amber-300",
  cyan: "bg-cyan-400/90 text-cyan-950 border-cyan-300",
};
const STICKY_ROTATIONS = ["-2deg", "1deg", "-1deg", "2deg", "0deg"];
export function StickyNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as StickyData;
  const colorClass = STICKY_COLORS[d.color ?? "amber"] ?? STICKY_COLORS.amber;
  const removeNode = useAutumnStore((s) => s.removeNode);
  const updateNodeData = useAutumnStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [editing]);

  // Stable rotation per node id.
  const rotation =
    STICKY_ROTATIONS[
      id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) %
        STICKY_ROTATIONS.length
    ];

  const commit = () => {
    updateNodeData(id, { text: draft.trim() || "New note" });
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "w-[200px] rounded-sm border shadow-md transition-all hover:rotate-0 hover:scale-[1.02]",
        colorClass,
        selected && "ring-2 ring-amber-500/40",
      )}
      style={{ transform: `rotate(${rotation})` }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5 opacity-70">
          <StickyNote className="size-3" />
          <span className="text-[10px] uppercase tracking-wider font-semibold">
            Note
          </span>
          <button
            onClick={() => removeNode(id)}
            className="ml-auto opacity-60 hover:opacity-100"
            aria-label="Remove note"
          >
            <X className="size-3" />
          </button>
        </div>
        {editing ? (
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft(d.text);
                setEditing(false);
              }
            }}
            className="w-full bg-white/40 border border-black/20 rounded-sm p-1 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-black/40 min-h-[60px]"
          />
        ) : (
          <div
            onDoubleClick={() => {
              setDraft(d.text);
              setEditing(true);
            }}
            className="text-xs leading-relaxed cursor-text sticky-markdown"
            title="Double-click to edit · supports **bold**, *italic*, `code`, # headings"
          >
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                code: ({ children }) => (
                  <code className="font-mono text-[10px] bg-black/20 px-0.5 py-0.5 rounded">
                    {children}
                  </code>
                ),
                h1: ({ children }) => <h3 className="font-bold text-sm mb-1">{children}</h3>,
                h2: ({ children }) => <h4 className="font-bold text-xs mb-1">{children}</h4>,
                h3: ({ children }) => <h5 className="font-semibold text-xs mb-0.5">{children}</h5>,
                ul: ({ children }) => <ul className="list-disc pl-3 mb-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-3 mb-1">{children}</ol>,
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
                a: ({ children, href }) => (
                  <a href={href} className="underline font-medium" target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-black/30 pl-1.5 italic opacity-80">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {d.text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

interface AnalyticsData {
  title: string;
  metrics: { label: string; value: string; delta?: string }[];
}
export function AnalyticsNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as AnalyticsData;
  return (
    <NodeShell id={id} selected={selected} color="#f59e0b" width="w-[260px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl bg-orange-500/5">
        <BarChart3 className="size-3.5 text-orange-400" />
        <span className="text-xs font-medium">{d.title || "Analytics"}</span>
      </div>
      <div className="p-3 grid grid-cols-2 gap-2">
        {d.metrics.map((m, i) => (
          <div
            key={i}
            className="rounded-md bg-muted/30 border border-border/40 px-2 py-1.5"
          >
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
              {m.label}
            </div>
            <div className="text-sm font-semibold">{m.value}</div>
            {m.delta && (
              <div className="text-[9px] text-emerald-400">{m.delta}</div>
            )}
          </div>
        ))}
      </div>
    </NodeShell>
  );
}

interface BrowserData {
  url: string;
  name: string;
}
export function BrowserNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as BrowserData;
  return (
    <NodeShell id={id} selected={selected} color="#8b5cf6" width="w-[260px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl bg-amber-500/5">
        <Globe className="size-3.5 text-amber-400" />
        <span className="text-xs font-medium truncate">{d.name || "Browser"}</span>
      </div>
      <div className="px-3 py-2 border-b border-border/40 flex items-center gap-1.5">
        <div className="size-1.5 rounded-full bg-rose-400" />
        <div className="size-1.5 rounded-full bg-violet-400" />
        <div className="size-1.5 rounded-full bg-emerald-400" />
        <div className="ml-2 flex-1 text-[9px] text-muted-foreground truncate bg-muted/30 rounded px-1.5 py-0.5">
          {d.url}
        </div>
      </div>
      <div className="h-28 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 flex items-center justify-center">
        <Globe className="size-8 text-amber-400/40" />
      </div>
    </NodeShell>
  );
}

interface RemotionData {
  name: string;
  crew: string[];
  status: string;
}
export function RemotionNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as RemotionData;
  return (
    <NodeShell id={id} selected={selected} color="#0b84f3" width="w-[240px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 rounded-t-xl bg-blue-500/5">
        <Clapperboard className="size-3.5 text-blue-400" />
        <span className="text-xs font-medium">{d.name || "Remotion"}</span>
        <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1">
          {d.status}
        </Badge>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="aspect-video rounded-md bg-gradient-to-br from-blue-500/20 to-cyan-500/10 border border-blue-400/20 flex items-center justify-center">
          <Clapperboard className="size-6 text-blue-400/40" />
        </div>
        {d.crew.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.crew.map((c, i) => (
              <Badge key={i} variant="outline" className="text-[9px] h-4 px-1">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
