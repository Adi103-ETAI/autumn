// Autumn — Canvas context menu.
// A floating context menu that appears at the cursor when right-clicking on
// the canvas pane or on a chat node. Supports quick-add nodes, run/connect/
// duplicate/remove, plus new canvas actions (select all, zoom to fit, toggle
// minimap) and node actions (copy node ID, focus on node).

"use client";

import { useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import type { NodeKind } from "@/lib/autumn/types";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { cn } from "@/lib/utils";
import {
  Bot,
  TerminalSquare,
  Monitor,
  StickyNote,
  BarChart3,
  Globe,
  Clapperboard,
  Play,
  Settings2,
  Cable,
  Copy,
  Trash2,
  MessageSquare,
  Search,
  CheckSquare,
  Maximize2,
  Map as MapIcon,
  Focus,
  Clipboard,
} from "lucide-react";

export interface CanvasContextMenuState {
  open: boolean;
  x: number;
  y: number;
  // canvas coords for placing a new node when adding via pane context menu
  canvasX: number;
  canvasY: number;
  // node id when right-clicking a node (null for pane)
  nodeId: string | null;
  kind: "pane" | "node";
}

export const INITIAL_CONTEXT_MENU: CanvasContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  canvasX: 0,
  canvasY: 0,
  nodeId: null,
  kind: "pane",
};

const PANE_ITEMS: {
  kind: NodeKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}[] = [
  { kind: "chat", label: "Add agent", icon: Bot, color: "text-amber-300" },
  { kind: "terminal", label: "Add terminal", icon: TerminalSquare, color: "text-emerald-400" },
  { kind: "screen", label: "Add screen", icon: Monitor, color: "text-sky-400" },
  { kind: "sticky", label: "Add note", icon: StickyNote, color: "text-amber-400" },
  { kind: "analytics", label: "Add analytics", icon: BarChart3, color: "text-orange-400" },
  { kind: "youtube", label: "Add browser", icon: Globe, color: "text-violet-400" },
  { kind: "remotion", label: "Add remotion", icon: Clapperboard, color: "text-blue-400" },
];

export function CanvasContextMenu({
  state,
  onClose,
  onAddAgentHere,
}: {
  state: CanvasContextMenuState;
  onClose: () => void;
  onAddAgentHere?: (position: { x: number; y: number }) => void;
}) {
  const addNode = useAutumnStore((s) => s.addNode);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const setSettingsNode = useAutumnStore((s) => s.setSettingsNode);
  const setConnectMode = useAutumnStore((s) => s.setConnectMode);
  const duplicateNode = useAutumnStore((s) => s.duplicateNode);
  const removeNode = useAutumnStore((s) => s.removeNode);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const nodes = useAutumnStore((s) => s.nodes);
  const selectAllNodes = useAutumnStore((s) => s.selectAllNodes);
  const showMinimap = useAutumnStore((s) => s.showMinimap);
  const setShowMinimap = useAutumnStore((s) => s.setShowMinimap);

  const ref = useRef<HTMLDivElement>(null);
  // Position the menu so it never overflows the viewport.
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useEffect(() => {
    if (!state.open) return;
    // Adjust position to keep menu within viewport bounds.
    const menuW = 220;
    const menuH = state.kind === "pane" ? 420 : 360;
    let x = state.x;
    let y = state.y;
    if (x + menuW > window.innerWidth - 8) x = window.innerWidth - menuW - 8;
    if (y + menuH > window.innerHeight - 8) y = window.innerHeight - menuH - 8;
    setPos({ x, y });
  }, [state.open, state.x, state.y, state.kind]);

  // Close on outside click / Escape / scroll.
  useEffect(() => {
    if (!state.open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [state.open, onClose]);

  if (!state.open) return null;

  const node = state.nodeId ? nodes.find((n) => n.id === state.nodeId) : null;
  const persona =
    node?.kind === "chat"
      ? PERSONA_BY_ID[(node.data as { personaId?: string }).personaId ?? ""]
      : null;

  const addAt = (kind: NodeKind) => {
    const id = addNode({ kind, position: { x: state.canvasX, y: state.canvasY } });
    setSelectedNode(id);
    if (kind === "chat") setRightPanelTab("commander");
    onClose();
  };

  const handleCopyNodeId = async (nodeId: string) => {
    try {
      await navigator.clipboard.writeText(nodeId);
    } catch {
      // Fallback: no-op
    }
    onClose();
  };

  const handleFocusNode = (nodeId: string) => {
    // Dispatch a custom event that CanvasView listens to
    window.dispatchEvent(
      new CustomEvent("autumn:center-node", { detail: { id: nodeId } }),
    );
    onClose();
  };

  const handleZoomToFit = () => {
    window.dispatchEvent(new CustomEvent("autumn:fit-view"));
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-[220px] rounded-lg border border-border/60 bg-popover/95 backdrop-blur-md shadow-2xl py-1.5 ctx-menu-enter"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.kind === "pane" ? (
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
            Add node at cursor
          </div>
          <div className="h-px bg-border/40 my-0.5" />
          {/* Add agent here — opens QuickSpawnMenu */}
          <MenuItem
            icon={Bot}
            label="Add agent here…"
            shortcut="⌘⇧A"
            onClick={() => {
              if (onAddAgentHere) {
                onAddAgentHere({ x: state.canvasX, y: state.canvasY });
              } else {
                addAt("chat");
              }
            }}
            color="text-amber-300"
          />
          {PANE_ITEMS.filter((item) => item.kind !== "chat").map((item) => (
            <MenuItem
              key={item.kind}
              icon={item.icon}
              label={item.label}
              onClick={() => addAt(item.kind)}
              color={item.color}
            />
          ))}
          <div className="h-px bg-border/40 my-0.5" />
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
            Canvas
          </div>
          <MenuItem
            icon={Search}
            label="Search nodes"
            shortcut="⌘F"
            onClick={() => {
              setShowNodeSearch(true);
              onClose();
            }}
          />
          <MenuItem
            icon={CheckSquare}
            label="Select all nodes"
            shortcut="⌘A"
            onClick={() => {
              selectAllNodes();
              onClose();
            }}
          />
          <MenuItem
            icon={Maximize2}
            label="Zoom to fit"
            shortcut="⌘1"
            onClick={handleZoomToFit}
          />
          <MenuItem
            icon={MapIcon}
            label={showMinimap ? "Hide minimap" : "Show minimap"}
            shortcut="⌘M"
            onClick={() => {
              setShowMinimap(!showMinimap);
              onClose();
            }}
          />
        </>
      ) : (
        node && (
          <>
            <div className="px-2.5 py-1.5 flex items-center gap-2">
              <div
                className="size-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shadow"
                style={{ background: persona?.color ?? "#888" }}
              >
                {persona?.glyph ?? <Bot className="size-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{node.name}</div>
                <div className="text-[9px] text-muted-foreground truncate">
                  {node.kind === "chat"
                    ? `${(node.data as { harness?: string }).harness} · ${(node.data as { model?: string }).model ?? "default"}`
                    : node.kind}
                </div>
              </div>
            </div>
            <div className="h-px bg-border/40 my-0.5" />
            {node.kind === "chat" && (
              <>
                <MenuItem
                  icon={MessageSquare}
                  label="Open chat"
                  onClick={() => {
                    setSelectedNode(node.id);
                    setRightPanelTab("commander");
                    onClose();
                  }}
                />
                <MenuItem
                  icon={Play}
                  label="Run agent"
                  onClick={() => {
                    void runAgentForNode(node.id);
                    onClose();
                  }}
                />
                <MenuItem
                  icon={Cable}
                  label="Connect to…"
                  onClick={() => {
                    setConnectMode({ from: node.id });
                    onClose();
                  }}
                />
                <MenuItem
                  icon={Copy}
                  label="Duplicate"
                  shortcut="⇧D"
                  onClick={() => {
                    const newId = duplicateNode(node.id);
                    if (newId) setSelectedNode(newId);
                    onClose();
                  }}
                />
                <MenuItem
                  icon={Settings2}
                  label="Settings…"
                  onClick={() => {
                    setSettingsNode(node.id);
                    onClose();
                  }}
                />
              </>
            )}
            {node.kind !== "chat" && (
              <MenuItem
                icon={Copy}
                label="Duplicate"
                shortcut="⇧D"
                onClick={() => {
                  const newId = duplicateNode(node.id);
                  if (newId) setSelectedNode(newId);
                  onClose();
                }}
              />
            )}
            {/* Node-specific actions */}
            <div className="h-px bg-border/40 my-0.5" />
            <MenuItem
              icon={Focus}
              label="Focus on this node"
              shortcut="⌘L"
              onClick={() => handleFocusNode(node.id)}
            />
            <MenuItem
              icon={Clipboard}
              label="Copy node ID"
              onClick={() => void handleCopyNodeId(node.id)}
            />
            <div className="h-px bg-border/40 my-0.5" />
            <MenuItem
              icon={Trash2}
              label="Remove"
              variant="destructive"
              onClick={() => {
                removeNode(node.id);
                onClose();
              }}
            />
          </>
        )
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  shortcut,
  variant = "default",
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  shortcut?: string;
  variant?: "default" | "destructive";
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-xs hover:bg-accent/60 transition-colors text-left",
        variant === "destructive" && "text-rose-400 hover:bg-rose-500/10",
      )}
    >
      <Icon
        className={cn(
          "size-3.5",
          variant === "destructive"
            ? "text-rose-400"
            : color ?? "text-muted-foreground",
        )}
      />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-[9px] text-muted-foreground/60 font-mono">{shortcut}</span>
      )}
    </button>
  );
}
