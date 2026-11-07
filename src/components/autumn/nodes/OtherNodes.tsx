// Autumn — Node components (Terminal/Apollo, Screen, Sticky, Analytics, Browser, Remotion).
// Fully styled according to Autumn UI architecture (autumn_ui_analysis.md).

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps, NodeResizer } from "@xyflow/react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID, PERSONAS } from "@/lib/autumn/personas";
import { cn } from "@/lib/utils";
import { api } from "@/lib/autumn/bridge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// @ts-ignore - xterm css has no types but Next handles it
import "xterm/css/xterm.css";
import {
  TerminalSquare,
  MonitorSmartphone,
  BarChart3,
  Globe,
  Clapperboard,
  X,
  Smartphone,
  Monitor,
  Folder,
  Terminal,
  Search,
  RotateCcw,
  Home,
  Maximize2,
  FolderPlus,
  Play,
  CheckSquare,
  Square,
  Sliders,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  Minus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

function CommonNodeFrame({
  id,
  selected,
  title,
  subtitle,
  icon,
  children,
  width = "w-[320px]",
  onExpand,
}: {
  id: string;
  selected?: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  onExpand?: () => void;
}) {
  const removeNode = useAutumnStore((s) => s.removeNode);

  return (
    <div className="relative group">
      {/* Free-resize handles - visible when selected */}
      <NodeResizer
        isVisible={!!selected}
        minWidth={260}
        minHeight={180}
        handleClassName="!size-3 !bg-blue-500 !border-white !rounded-sm shadow"
        lineClassName="!border-blue-500/40"
      />
      {/* 4 Cardinal Connection Anchors */}
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

      <div
        className={cn(
          `${width} autumn-window-frame overflow-hidden flex flex-col transition-all`,
          selected && "autumn-node-selected",
        )}
      >
        {/* October-style window chrome: traffic lights left, controls right */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a] bg-[#18181b]/80 select-none">
          {/* macOS traffic lights */}
          <div className="flex items-center gap-1.5 mr-1.5 shrink-0" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]/90" />
            <span className="size-2.5 rounded-full bg-[#febc2e]/90" />
            <span className="size-2.5 rounded-full bg-[#28c840]/90" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1.5 mr-2">
            {icon}
            <span className="text-xs font-semibold text-zinc-200 truncate">{title}</span>
            {subtitle && <span className="text-[10px] text-zinc-500 truncate">· {subtitle}</span>}
          </div>

          <div className="flex items-center gap-0.5 ml-2">
            <button
              onClick={onExpand}
              className="size-7 flex items-center justify-center hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              title="Minimize"
            >
              <Minus className="size-3" />
            </button>
            <button
              onClick={onExpand}
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

        <div className="relative flex-1 flex flex-col min-h-0">{children}</div>
      </div>
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

// -----------------------------------------------------------------------------
// TerminalNode (Real PTY via xterm.js + bridge output stream)
// -----------------------------------------------------------------------------
export function TerminalNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as TerminalData & {
    harness?: string;
    boundChatId?: string;
    shell?: string;
  };
  const canvasId = useAutumnStore((s) => s.canvasId);
  const workspaces = useAutumnStore((s) => s.workspaces);
  const currentWs = workspaces.find((w) => w.id === canvasId);
  const wsDir = currentWs?.kind === "folder" && currentWs.source ? currentWs.source : undefined;
  const updateNodeData = useAutumnStore((s) => s.updateNodeData);
  const [viewMode, setViewMode] = useState<"launcher" | "terminal">(
    (d.lines && d.lines.length > 0) || !!d.harness ? "terminal" : "launcher",
  );
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  // Holds the terminal.onData unsubscribe (live PTY output stream).
  const esRef = useRef<(() => void) | null>(null);
  const dir = d.dir || wsDir || "";
  const isAgentTerm = !!d.harness;
  const nodeTitle = d.agent ? `${d.agent} · Terminal` : isAgentTerm ? "Agent · CLI" : "Terminal";
  const boundChat = useAutumnStore((s) => s.nodes.find((n) => n.id === d.boundChatId));
  const personaForIcon = boundChat
    ? PERSONA_BY_ID[(boundChat.data as { personaId?: string }).personaId ?? ""]
    : PERSONAS.find((p) => p.name === d.agent);
  const leafIcon = personaForIcon?.icon;

  const sendResize = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    try {
      const fit = fitAddonRef.current;
      if (fit) fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      await api.terminal.resize({ node: id, cols, rows });
    } catch {}
  }, [id]);

  const connectLive = useCallback(async () => {
    if (esRef.current) return;
    setError(null);
    try {
      // Subscribe to PTY output before starting so no early chunks are missed;
      // the harness-not-installed warning arrives as a normal ANSI chunk here.
      const unsub = api.terminal.onData((chunk) => {
        if (chunk.node !== id) return;
        termRef.current?.write(chunk.data);
      });
      esRef.current = unsub;
      await api.terminal.start({
        node: id,
        dir,
        ...(isAgentTerm ? { harness: d.harness!, canvas: canvasId } : {}),
      });
      // start resolving REPLACES the old "ready" event — session is live
      setLive(true);
    } catch (e) {
      esRef.current?.();
      esRef.current = null;
      setError(e instanceof Error ? e.message : "failed to connect");
      setLive(false);
    }
  }, [id, dir, isAgentTerm, d.harness, canvasId]);

  // xterm init
  useEffect(() => {
    if (viewMode !== "terminal") return;
    if (!containerRef.current) return;
    let disposed = false;
    let term: import("xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      if (disposed || !containerRef.current) return;
      // Simple wait for layout
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (disposed || !containerRef.current) return;
      try {
        term = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        theme: { background: "#0a0a0c", foreground: "#e4e4e7", cursor: "#22c55e" },
        convertEol: true,
        scrollback: 2000,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(containerRef.current!);
      try {
        fitAddon.fit();
      } catch {}
      // Nudge PTY to new size after fit
      setTimeout(() => {
        try {
          fitAddon?.fit();
          const cols = term!.cols;
          const rows = term!.rows;
          if (cols > 0 && rows > 0) {
            api.terminal.resize({ node: id, cols, rows }).catch(() => {});
          }
        } catch {}
      }, 100);
      } catch (e) {
        setError(e instanceof Error ? e.message : "xterm init failed");
      }

      // Per-key input -> PTY via bridge
      term.onData((data) => {
        api.terminal.input({ node: id, data }).catch(() => {});
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Handle resize
      const ro = new ResizeObserver(() => {
        try {
          fitAddon?.fit();
          const cols = term!.cols;
          const rows = term!.rows;
          api.terminal.resize({ node: id, cols, rows }).catch(() => {});
        } catch {}
      });
      ro.observe(containerRef.current!);

      // Store cleanup
      (term as unknown as { _ro?: ResizeObserver })._ro = ro;

      // Connect the live output stream after terminal ready
      connectLive();
    };

    init();

    return () => {
      disposed = true;
      try {
        const ro = (termRef.current as unknown as { _ro?: ResizeObserver })?._ro;
        ro?.disconnect();
      } catch {}
      try {
        term?.dispose();
      } catch {}
      termRef.current = null;
      fitAddonRef.current = null;
      esRef.current?.();
      esRef.current = null;
      api.terminal.kill({ node: id }).catch(() => {});
      setLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Reconnect if dir/harness changes while in terminal mode
  useEffect(() => {
    if (viewMode === "terminal" && !live && !error) {
      const t = setTimeout(() => connectLive(), 300);
      return () => clearTimeout(t);
    }
  }, [viewMode, live, error, connectLive]);

  const handleChooseFolder = async () => {
    try {
      const w = window as unknown as { autumn?: { openFileDialog: (opts: unknown) => Promise<string[] | null> } };
      if (w.autumn?.openFileDialog) {
        const picked = await w.autumn.openFileDialog({ title: "Choose workspace folder", directory: true });
        if (picked && picked[0]) {
          updateNodeData(id, { dir: picked[0] });
          // Kill old PTY so next connect uses new cwd
          await api.terminal.kill({ node: id }).catch(() => {});
          esRef.current?.();
          esRef.current = null;
          setLive(false);
          setViewMode("terminal");
          termRef.current?.writeln(`\r\n\x1b[33m> workspace: ${picked[0]}\x1b[0m`);
          if (dontAskAgain && typeof window !== "undefined") {
            try {
              localStorage.setItem("autumn-terminal-dontAsk", "1");
            } catch {}
          }
          setTimeout(() => connectLive(), 200);
          return;
        }
      } else {
        // Fallback: no electron bridge -> prompt for path
        const path = window.prompt("Enter workspace path (e.g. /tmp or ~/autumn)", dir);
        if (path) {
          updateNodeData(id, { dir: path });
          esRef.current?.();
          esRef.current = null;
          setLive(false);
          setTimeout(() => connectLive(), 200);
        }
      }
    } catch {}
  };

  const handleLaunchIn = (_target: string) => {
    if (dontAskAgain && typeof window !== "undefined") {
      try {
        localStorage.setItem("autumn-terminal-dontAsk", "1");
      } catch {}
    }
    setViewMode("terminal");
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  return (
    <CommonNodeFrame
      id={id}
      selected={selected}
      title={nodeTitle}
      subtitle={isAgentTerm ? d.harness : "workspace"}
      icon={
        leafIcon ? (
          <img src={leafIcon} alt={personaForIcon?.name ?? "agent"} className="size-4 rounded-sm object-cover shrink-0" />
        ) : (
          <TerminalSquare className="size-3 text-emerald-400" />
        )
      }
      width="w-[600px]"
    >
      {viewMode === "launcher" ? (
        <div className="p-4 space-y-3 bg-[#121214] text-zinc-200">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-zinc-300">Open terminal in...</div>
            <div className="flex items-center gap-1">
              <span className={cn("size-2 rounded-full", live ? "bg-emerald-500" : "bg-zinc-600")} />
              <span className="text-[10px] text-zinc-500">{live ? "live" : "idle"}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleLaunchIn("Website (Next.js)")}
              className="p-2.5 rounded-lg border border-[#27272a] bg-[#18181b] hover:bg-[#202025] hover:border-blue-500/50 transition-all text-left group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Folder className="size-4 text-blue-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-medium text-zinc-100">Website</span>
              </div>
              <div className="text-[10px] text-zinc-500">Next.js</div>
            </button>

            <button
              onClick={() => handleLaunchIn("untitled-workspace")}
              className="p-2.5 rounded-lg border border-[#27272a] bg-[#18181b] hover:bg-[#202025] hover:border-blue-500/50 transition-all text-left group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Folder className="size-4 text-blue-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-medium text-zinc-100">This workspace</span>
              </div>
              <div className="text-[10px] text-zinc-500 truncate">{dir}</div>
            </button>
          </div>

          <button
            onClick={handleChooseFolder}
            className="w-full py-1.5 px-3 rounded-lg border border-blue-900/60 bg-blue-950/40 hover:bg-blue-900/50 text-blue-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-[0_0_12px_rgba(30,58,138,0.2)]"
          >
            <FolderPlus className="size-3.5" />
            <span>+ Choose folder...</span>
          </button>

          <div className="flex items-center gap-2 py-0.5">
            <div className="flex-1 h-px bg-[#27272a]" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">or</span>
            <div className="flex-1 h-px bg-[#27272a]" />
          </div>

          <button
            onClick={() => handleLaunchIn("Normal Terminal")}
            className="w-full py-2 px-3 rounded-lg bg-[#27272a] hover:bg-[#323238] text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow"
          >
            <Terminal className="size-3.5 text-emerald-400" />
            <span>&gt;_ Open a normal terminal</span>
          </button>

          <div className="space-y-1.5 pt-1 text-[11px] text-zinc-400">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 text-blue-600 size-3.5"
              />
              <span>Don&apos;t ask again — open new terminals instantly</span>
            </label>
          </div>
        </div>
      ) : (
        <div className="bg-[#0a0a0c] flex flex-col">
          {error && (
            <div className="px-3 py-1.5 text-[11px] text-rose-300 bg-rose-950/30 border-b border-rose-900/50">
              {error}
            </div>
          )}
          <div
            ref={containerRef}
            className="h-[380px] w-full overflow-hidden nodrag nopan"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ touchAction: "none" }}
          />
        </div>
      )}

      {/* Attached Control Dock (Bottom Toolbar) */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#141418] border-t border-[#27272a] text-[10px] text-zinc-400 select-none">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode(viewMode === "launcher" ? "terminal" : "launcher")}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-200 transition-colors flex items-center gap-1"
          >
            <Sliders className="size-2.5" />
            <span>{viewMode === "launcher" ? "Terminal" : "Launcher"}</span>
          </button>
          <button
            onClick={handleChooseFolder}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-200 transition-colors flex items-center gap-1"
          >
            <Home className="size-2.5" />
            <span>Folder</span>
          </button>
          <button
            onClick={sendResize}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-200 transition-colors flex items-center gap-1"
          >
            <Search className="size-2.5" />
            <span>Fit</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={clearTerminal}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => {
              esRef.current?.();
              esRef.current = null;
              setLive(false);
              api.terminal.kill({ node: id }).catch(() => {});
              termRef.current?.writeln("\r\n\x1b[33m[restarted]\x1b[0m");
              setTimeout(() => connectLive(), 300);
            }}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-200 transition-colors flex items-center gap-1"
            title="Restart terminal session"
          >
            <RotateCcw className="size-2.5" />
            <span>Restart</span>
          </button>
        </div>
      </div>
    </CommonNodeFrame>
  );
}

// -----------------------------------------------------------------------------
// ScreenNode (Desktop / Mobile Preview)
// -----------------------------------------------------------------------------
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
    <CommonNodeFrame
      id={id}
      selected={selected}
      title={d.name || "Preview"}
      subtitle={d.route || "live route"}
      icon={isPhone ? <Smartphone className="size-3 text-blue-400" /> : <Monitor className="size-3 text-blue-400" />}
      width={isPhone ? "w-[220px]" : "w-[300px]"}
    >
      <div
        className={cn(
          "bg-gradient-to-br from-blue-500/10 to-indigo-500/5 flex flex-col items-center justify-center p-4 border-b border-[#27272a]",
          isPhone ? "h-52" : "h-40",
        )}
      >
        <MonitorSmartphone className="size-8 text-blue-400/40 mb-2 animate-pulse" />
        <div className="text-xs font-semibold text-zinc-300">{d.name}</div>
        <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">{d.route || "/"}</div>
        <div className="mt-3 px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[9px] border border-blue-500/30">
          Live Surface
        </div>
      </div>
    </CommonNodeFrame>
  );
}

// -----------------------------------------------------------------------------
// StickyNode (Note)
// -----------------------------------------------------------------------------
interface StickyData {
  text: string;
  color?: string;
}

export function StickyNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as StickyData;
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

  const commit = () => {
    updateNodeData(id, { text: draft.trim() || "New note" });
    setEditing(false);
  };

  return (
    <div className="relative group">
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={120}
        handleClassName="!size-3 !bg-blue-500 !border-white !rounded-sm shadow"
        lineClassName="!border-blue-500/40"
      />
      {/* 4 Cardinal Handles */}
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

      <div
        className={cn(
          "w-[240px] min-w-[200px] min-h-[100px] rounded-2xl border border-amber-300/40 bg-[#FFF9E6] text-amber-950 shadow-xl transition-all resize overflow-hidden",
          selected && "ring-2 ring-blue-500 ring-offset-2 ring-offset-black",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-300/40 select-none">
          <span className="text-sm">🍂</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900/80">Note</span>
          <button
            onClick={() => removeNode(id)}
            className="ml-auto rounded-md p-0.5 text-amber-900/50 hover:bg-amber-200/60 hover:text-amber-900"
          >
            <X className="size-3" />
          </button>
        </div>

        <div className="p-3">
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
              }}
              className="w-full bg-white/60 border border-black/15 rounded-lg p-2 text-xs leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-black/20 min-h-[70px]"
            />
          ) : (
            <div
              onDoubleClick={() => {
                setDraft(d.text);
                setEditing(true);
              }}
              className="text-xs leading-relaxed cursor-text"
              title="Double-click to edit note"
            >
              <ReactMarkdown>{d.text}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// AnalyticsNode (Dashboard / Metrics)
// -----------------------------------------------------------------------------
interface AnalyticsData {
  title: string;
  metrics: { label: string; value: string; delta?: string }[];
}

export function AnalyticsNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as AnalyticsData;
  return (
    <CommonNodeFrame
      id={id}
      selected={selected}
      title={d.title || "Analytics"}
      icon={<BarChart3 className="size-3 text-amber-400" />}
      width="w-[280px]"
    >
      <div className="p-3 grid grid-cols-2 gap-2 bg-[#121214]">
        {d.metrics.map((m, i) => (
          <div key={i} className="rounded-lg bg-[#18181b] border border-[#27272a] p-2">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">{m.label}</div>
            <div className="text-base font-bold text-zinc-100 mt-0.5">{m.value}</div>
            {m.delta && <div className="text-[10px] text-emerald-400 font-medium">{m.delta}</div>}
          </div>
        ))}
      </div>
    </CommonNodeFrame>
  );
}

// -----------------------------------------------------------------------------
// BrowserNode (Embedded Browser / Web Viewer)
// -----------------------------------------------------------------------------
interface BrowserData {
  url: string;
  name: string;
}

export function BrowserNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as BrowserData;
  return (
    <CommonNodeFrame
      id={id}
      selected={selected}
      title={d.name || "Browser View"}
      subtitle={d.url}
      icon={<Globe className="size-3 text-violet-400" />}
      width="w-[320px]"
    >
      <div className="px-3 py-1.5 border-b border-[#27272a] bg-[#141418] flex items-center gap-1.5">
        <div className="flex-1 text-[10px] text-zinc-400 font-mono bg-[#1c1c22] rounded px-2 py-0.5 border border-[#27272a] truncate">
          {d.url || "https://www.youtube.com/"}
        </div>
      </div>
      <div className="h-36 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 flex flex-col items-center justify-center p-4">
        <Globe className="size-8 text-violet-400/40 mb-2 animate-pulse" />
        <span className="text-xs text-zinc-400 font-medium">Embedded Web Surface</span>
      </div>
    </CommonNodeFrame>
  );
}

// -----------------------------------------------------------------------------
// RemotionNode (Video Generation Crew)
// -----------------------------------------------------------------------------
interface RemotionData {
  name: string;
  crew: string[];
  status: string;
}

export function RemotionNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as RemotionData;
  return (
    <CommonNodeFrame
      id={id}
      selected={selected}
      title={d.name || "Remotion Video"}
      subtitle={d.status}
      icon={<Clapperboard className="size-3 text-blue-400" />}
      width="w-[280px]"
    >
      <div className="p-3 space-y-2 bg-[#121214]">
        <div className="aspect-video rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/10 border border-blue-500/30 flex items-center justify-center">
          <Clapperboard className="size-7 text-blue-400/60" />
        </div>
        {d.crew.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.crew.map((c, i) => (
              <Badge key={i} variant="outline" className="text-[9px] h-4 px-1.5 border-zinc-700 bg-zinc-800 text-zinc-300">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </CommonNodeFrame>
  );
}
