// Autumn — CanvasView (react-flow canvas).
// Hosts the 7 node types + 2 edge types, with bus traffic visualization,
// auto-arrange, minimap (togglable), controls, and persistence of position changes.

"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAutumnStore } from "@/lib/autumn/store";
import type { NodeKind } from "@/lib/autumn/types";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { ChatNode } from "./nodes/ChatNode";
import {
  TerminalNode,
  ScreenNode,
  StickyNode,
  AnalyticsNode,
  BrowserNode,
  RemotionNode,
} from "./nodes/OtherNodes";
import { BusEdge, NavigationEdge } from "./edges/Edges";
import { CanvasToolbar } from "./CanvasToolbar";
import { MinimapPanel } from "./MinimapPanel";
import { CanvasBackgroundLayer } from "./CanvasBackgroundLayer";
import { CanvasContextMenu, INITIAL_CONTEXT_MENU, type CanvasContextMenuState } from "./CanvasContextMenu";
import { EdgeInspector } from "./EdgeInspector";
import { QuickSpawnMenu } from "./QuickSpawnMenu";
import { Cable, Sparkles, Bot, Terminal } from "lucide-react";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const nodeTypes = {
  chat: ChatNode,
  terminal: TerminalNode,
  screen: ScreenNode,
  sticky: StickyNode,
  analytics: AnalyticsNode,
  youtube: BrowserNode,
  remotion: RemotionNode,
};

const edgeTypes = {
  bus: BusEdge,
  navigation: NavigationEdge,
};

const MINIMAP_COLORS: Record<NodeKind, string> = {
  chat: "#a855f7",
  terminal: "#22c55e",
  screen: "#3b82f6",
  sticky: "#fbbf24",
  analytics: "#f59e0b",
  youtube: "#8b5cf6",
  remotion: "#0b84f3",
};

// Sticky notes store a named color ("amber"/"rose"/"emerald"/"violet"/"cyan")
// that maps to a tailwind class on the canvas. Mirror those exact hues here so
// the minimap square matches the sticky note's actual color.
const STICKY_HEX: Record<string, string> = {
  amber: "#FFF9E6", // soft cream (matches the reference image bg)
  rose: "#ffe4e6", // bg-rose-100
  emerald: "#d1fae5", // bg-emerald-100
  violet: "#ede9fe", // bg-violet-100
  cyan: "#cffafe", // bg-cyan-100
};

// Resolve the on-canvas color of a node for the minimap.
// - chat (agents): use the persona's hex color (Atlas=emerald, Apollo=rose, …)
//   so each named agent shows up in the minimap with the same color it wears
//   on the canvas.
// - sticky: use the per-note color field (amber/rose/emerald/violet/cyan).
// - others: fall back to the kind-level default.
function minimapNodeColor(n: { type?: string; data?: unknown }): string {
  const kind = (n.type ?? "") as NodeKind;
  if (kind === "chat") {
    const data = n.data as { personaId?: string } | undefined;
    const persona = data?.personaId ? PERSONA_BY_ID[data.personaId] : undefined;
    return persona?.color ?? MINIMAP_COLORS.chat;
  }
  if (kind === "sticky") {
    const data = n.data as { color?: string } | undefined;
    return STICKY_HEX[data?.color ?? "amber"] ?? STICKY_HEX.amber;
  }
  return MINIMAP_COLORS[kind] ?? "#888";
}

function CanvasInner() {
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const moveNode = useAutumnStore((s) => s.moveNode);
  const connectNodes = useAutumnStore((s) => s.connectNodes);
  const connectMode = useAutumnStore((s) => s.connectMode);
  const setConnectMode = useAutumnStore((s) => s.setConnectMode);
  const addNode = useAutumnStore((s) => s.addNode);
  const resetCanvas = useAutumnStore((s) => s.resetCanvas);
  const clearSelection = useAutumnStore((s) => s.clearSelection);
  const searchMatchIds = useAutumnStore((s) => s.searchMatchIds);
  const showNodeSearch = useAutumnStore((s) => s.showNodeSearch);
  const showMinimap = useAutumnStore((s) => s.showMinimap);
  const { fitView, setCenter, getNode, screenToFlowPosition } = useReactFlow();
  const fromNode = connectMode?.from ? nodes.find((n) => n.id === connectMode.from) : null;
  const isEmpty = nodes.length === 0;
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);

  // Context menu state (right-click on pane or node).
  const [ctxMenu, setCtxMenu] = useState<CanvasContextMenuState>(INITIAL_CONTEXT_MENU);
  // Edge inspector state (double-click on bus edge label).
  const [inspectedEdge, setInspectedEdge] = useState<string | null>(null);
  // QuickSpawnMenu state (from context menu "Add agent here").
  const [quickSpawnState, setQuickSpawnState] = useState<{
    open: boolean;
    screenPos: { x: number; y: number } | undefined;
    canvasPos: { x: number; y: number } | undefined;
  }>({ open: false, screenPos: undefined, canvasPos: undefined });

  // Listen for "autumn:inspect-edge" custom events from the BusEdge label.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string } | undefined;
      if (detail?.id) setInspectedEdge(detail.id);
    };
    window.addEventListener("autumn:inspect-edge", handler);
    return () => window.removeEventListener("autumn:inspect-edge", handler);
  }, []);

  // Track whether Shift is currently held so onNodesChange can distinguish
  // multi-select clicks from single-select clicks. react-flow's NodeChange
  // doesn't include modifier state, so we maintain it ourselves.
  const shiftHeldRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = false;
    };
    const blur = () => {
      shiftHeldRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Listen for "autumn:fit-view" custom events from the Command Palette.
  useEffect(() => {
    const handler = () => fitView({ padding: 0.2, duration: 400 });
    window.addEventListener("autumn:fit-view", handler);
    return () => window.removeEventListener("autumn:fit-view", handler);
  }, [fitView]);

  // Listen for "autumn:center-node" events from the NodeSearchOverlay.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string } | undefined;
      if (!detail?.id) return;
      const n = getNode(detail.id);
      if (n) {
        // setCenter expects absolute coordinates.
        const x = n.position.x + 140;
        const y = n.position.y + 80;
        setCenter(x, y, { zoom: 1.1, duration: 400 });
      }
    };
    window.addEventListener("autumn:center-node", handler);
    return () => window.removeEventListener("autumn:center-node", handler);
  }, [setCenter, getNode]);

  // Convert Autumn domain model → react-flow nodes/edges.
  // Inject a `searchMatch` flag so node components can render an emerald ring.
  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position,
        data: {
          ...n.data,
          __searchMatch: showNodeSearch && searchMatchIds.includes(n.id),
        },
      })),
    [nodes, searchMatchIds, showNodeSearch],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.kind,
        animated: e.animated,
        data: { label: e.label },
      })),
    [edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const store = useAutumnStore.getState();
      // If we're in connect mode, intercept selection events to wire nodes.
      if (store.connectMode?.from) {
        for (const c of changes) {
          if (c.type === "select" && c.selected && c.id !== store.connectMode.from) {
            const targetNode = store.nodes.find((n) => n.id === c.id);
            if (targetNode && targetNode.kind === "chat") {
              store.connectNodes(store.connectMode.from, c.id, "bus");
              store.setConnectMode(null);
              return;
            }
          }
        }
      }
      // Apply position changes back to the store.
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "select") {
          if (c.selected) {
            if (shiftHeldRef.current) {
              // Multi-select: preserve the previous primary by adding it to
              // selectedNodeIds first (if not already there), then add the new one.
              const prevPrimary = store.selectedNodeId;
              if (prevPrimary && prevPrimary !== c.id && !store.selectedNodeIds.includes(prevPrimary)) {
                store.addToSelection(prevPrimary);
              }
              store.addToSelection(c.id);
              // Keep selectedNodeId on the newly-clicked node so the right panel
              // and chat panel can react to it.
              store.setSelectedNode(c.id);
            } else {
              // Single select: replace.
              store.clearSelection();
              store.setSelectedNode(c.id);
            }
          } else {
            // Deselecting: remove from multi-select; only clear primary if it
            // was the deselected one.
            if (store.selectedNodeId === c.id) store.setSelectedNode(null);
          }
        }
        if (c.type === "remove") {
          useAutumnStore.getState().removeNode(c.id);
        }
      }
    },
    [moveNode],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const store = useAutumnStore.getState();
    for (const c of changes) {
      if (c.type === "remove") {
        const edge = store.edges.find((e) => e.id === c.id);
        if (edge) store.disconnectNodes(edge.source, edge.target);
      }
    }
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) {
        connectNodes(conn.source, conn.target, "bus");
      }
    },
    [connectNodes],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    clearSelection();
  }, [setSelectedNode, clearSelection]);

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setCtxMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        canvasX: flowPos.x,
        canvasY: flowPos.y,
        nodeId: null,
        kind: "pane",
      });
    },
    [screenToFlowPosition],
  );

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      setCtxMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        canvasX: 0,
        canvasY: 0,
        nodeId: node.id,
        kind: "node",
      });
    },
    [],
  );

  // Handle "Add agent here" from context menu — open the QuickSpawnMenu
  const handleAddAgentHere = useCallback((canvasPosition: { x: number; y: number }) => {
    setQuickSpawnState({
      open: true,
      screenPos: { x: ctxMenu.x, y: ctxMenu.y },
      canvasPos: canvasPosition,
    });
  }, [ctxMenu.x, ctxMenu.y]);

  return (
    <div className="absolute inset-0 autumn-canvas">
      {/* Scenic photographic background layer (sits behind the react-flow canvas) */}
      <CanvasBackgroundLayer />
      {/* Empty state */}
      <AnimatePresence>
        {isEmpty && (
          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="text-center max-w-md px-6 pointer-events-auto">
              {/* Animated gradient border container */}
              <div className="relative rounded-2xl p-[2px] breathing-border bg-gradient-to-r from-amber-500/40 via-orange-500/20 to-amber-500/40">
                <div className="rounded-2xl bg-[#0a0d12] border border-white/5 px-8 py-10">
                  {/* Autumn maple-leaf logo */}
                  <AutumnLogo size={56} glow className="mx-auto mb-5" />
                  <h3 className="text-xl font-semibold mb-2">Your canvas is empty</h3>
                  <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                    Start by adding an agent or typing a command to the Commander.
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => addNode({ kind: "chat" })}
                    >
                      <Bot className="size-3.5" />
                      Add Agent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setRightPanelTab("commander")}
                    >
                      <Terminal className="size-3.5" />
                      Open Commander
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Connect-mode banner */}
      {connectMode?.from && fromNode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 fade-in-up">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 backdrop-blur-md px-3 py-1.5 shadow-lg">
            <Cable className="size-3.5 text-amber-300 animate-pulse" />
            <span className="text-xs text-amber-100">
              Click another agent to wire{" "}
              <strong className="font-semibold">{fromNode.name}</strong>{" "}
              → them
            </span>
            <button
              onClick={() => setConnectMode(null)}
              className="ml-1 text-[10px] text-amber-200/70 hover:text-amber-100 underline"
            >
              cancel
            </button>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
        defaultEdgeOptions={{ type: "bus" }}
        multiSelectionKeyCode={["Shift"]}
        selectNodesOnDrag={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="oklch(0.4 0.02 55 / 0.25)"
        />
        {showMinimap && (
          <MiniMap
            className="!bg-card/80 !border-border/50 !rounded-lg !shadow-lg"
            style={{ bottom: "92px", width: "150px", height: "110px" }}
            nodeColor={minimapNodeColor}
            maskColor="oklch(0.005 0.002 55 / 0.7)"
            pannable
            zoomable
          />
        )}
        {showMinimap && <MinimapPanel />}
        <CanvasToolbar />
      </ReactFlow>
      <CanvasContextMenu
        state={ctxMenu}
        onClose={() => setCtxMenu((s) => ({ ...s, open: false }))}
        onAddAgentHere={handleAddAgentHere}
      />
      <EdgeInspector
        edgeId={inspectedEdge}
        open={inspectedEdge !== null}
        onOpenChange={(v) => !v && setInspectedEdge(null)}
      />
      {/* QuickSpawnMenu from context menu "Add agent here" */}
      <QuickSpawnMenu
        open={quickSpawnState.open}
        onClose={() => setQuickSpawnState({ open: false, screenPos: undefined, canvasPos: undefined })}
        screenPosition={quickSpawnState.screenPos}
        canvasPosition={quickSpawnState.canvasPos}
      />
    </div>
  );
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
