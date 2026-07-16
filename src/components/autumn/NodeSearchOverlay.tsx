// Autumn — Node search overlay (⌘F).
// A compact floating panel that filters canvas nodes by name / kind / status.
// Matching nodes get an emerald ring on the canvas; clicking a result
// selects + centers the node.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { useReactFlow } from "@xyflow/react";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Bot,
  TerminalSquare,
  MonitorSmartphone,
  StickyNote,
  BarChart3,
  Globe,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeKind } from "@/lib/autumn/types";

const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }>> = {
  chat: Bot,
  terminal: TerminalSquare,
  screen: MonitorSmartphone,
  sticky: StickyNote,
  analytics: BarChart3,
  youtube: Globe,
  remotion: Clapperboard,
};

export function NodeSearchOverlay() {
  const open = useAutumnStore((s) => s.showNodeSearch);
  const setOpen = useAutumnStore((s) => s.setShowNodeSearch);
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const searchQuery = useAutumnStore((s) => s.searchQuery);
  const setSearchQuery = useAutumnStore((s) => s.setSearchQuery);
  const searchMatchIds = useAutumnStore((s) => s.searchMatchIds);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Local copy of the input value so typing feels instant.
  const [localQ, setLocalQ] = useState(searchQuery);

  useEffect(() => {
    if (open) {
      setLocalQ(searchQuery);
      // Focus the input shortly after opening.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, searchQuery]);

  // Sync local input → store (debounced via React's batching).
  useEffect(() => {
    if (localQ !== searchQuery) setSearchQuery(localQ);
    setActiveIdx(0);
  }, [localQ, setSearchQuery, searchQuery]);

  const matches = useMemo(
    () => nodes.filter((n) => searchMatchIds.includes(n.id)),
    [nodes, searchMatchIds],
  );

  const close = () => setOpen(false);

  const jumpTo = (id: string) => {
    setSelectedNode(id);
    const n = nodes.find((x) => x.id === id);
    if (n?.kind === "chat") setRightPanelTab("commander");
    // Center the node in the viewport.
    if (n) {
      // Dispatch a custom event the CanvasView can listen to.
      window.dispatchEvent(
        new CustomEvent("autumn:center-node", {
          detail: { id, x: n.position.x, y: n.position.y },
        }),
      );
    }
    close();
  };

  // Keyboard nav inside the overlay.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[activeIdx];
      if (m) jumpTo(m.id);
    }
  };

  if (!open) return null;

  return (
    <div
      className="absolute top-16 left-1/2 -translate-x-1/2 z-30 w-[460px] max-w-[90vw] fade-in-up"
      role="dialog"
      aria-label="Search canvas nodes"
    >
      <div className="rounded-xl border border-violet-500/40 bg-card/95 backdrop-blur-xl shadow-2xl shadow-violet-500/10 overflow-hidden">
        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
          <Search className="size-4 text-violet-400" />
          <Input
            ref={inputRef}
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search agents, notes, screens, status…"
            className="h-7 border-0 bg-transparent px-0 focus-visible:ring-0 text-sm"
          />
          <Badge variant="outline" className="text-[9px] h-5 px-1.5 font-mono">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            onClick={close}
            aria-label="Close search"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto autumn-scroll">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <Search className="size-6 text-muted-foreground/30 mb-2" />
              <div className="text-sm text-muted-foreground">
                {localQ.trim()
                  ? "No nodes match your query."
                  : "Type to search across the canvas."}
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-1">
                Searches name, kind, harness, model, status, and note text.
              </div>
            </div>
          ) : (
            <ul className="py-1">
              {matches.map((n, i) => {
                const Icon = KIND_ICON[n.kind];
                const persona =
                  n.kind === "chat"
                    ? PERSONA_BY_ID[
                        (n.data as { personaId?: string }).personaId ?? ""
                      ]
                    : null;
                const peerCount = edges.filter(
                  (e) => e.kind === "bus" && (e.source === n.id || e.target === n.id),
                ).length;
                return (
                  <li key={n.id}>
                    <button
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => jumpTo(n.id)}
                      className={cn(
                        "w-full text-left flex items-center gap-2.5 px-3 py-1.5 transition-colors",
                        i === activeIdx
                          ? "bg-violet-500/15 ring-1 ring-violet-500/30"
                          : "hover:bg-accent/30",
                      )}
                    >
                      <div
                        className="size-6 shrink-0 rounded-md flex items-center justify-center border border-border/40"
                        style={
                          persona
                            ? { background: `${persona.color}25`, color: persona.color }
                            : undefined
                        }
                      >
                        {persona ? (
                          <span className="text-[10px] font-bold">{persona.glyph}</span>
                        ) : (
                          <Icon className="size-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{n.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {n.kind === "chat"
                            ? `${(n.data as { harness?: string }).harness ?? "agent"} · ${
                                (n.data as { status?: string }).status ?? "idle"
                              }`
                            : n.kind}
                        </div>
                      </div>
                      {peerCount > 0 && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1">
                          {peerCount} peer{peerCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {i === activeIdx && (
                        <CornerDownLeft className="size-3 text-violet-400" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border/50 flex items-center gap-3 text-[9px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <ArrowUp className="size-2.5" />
            <ArrowDown className="size-2.5" />
            navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-2.5" />
            jump to node
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono">esc</kbd>
            close
          </span>
          <div className="flex-1" />
          <span className="font-mono">⌘F</span>
        </div>
      </div>
    </div>
  );
}
