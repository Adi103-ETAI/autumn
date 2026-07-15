// Autumn — CanvasView (react-flow canvas).
// Hosts the 7 node types + 2 edge types, with bus traffic visualization,
// auto-arrange, minimap, controls, and persistence of position changes.

"use client";

import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
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
import { Cable, Sparkles, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const { fitView, setCenter, getNode } = useReactFlow();
  const fromNode = connectMode?.from ? nodes.find((n) => n.id === connectMode.from) : null;
  const isEmpty = nodes.length === 0;

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

  return (
    <div className="absolute inset-0 autumn-canvas">
      {/* Empty state */}
      {isEmpty && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-md px-6 pointer-events-auto fade-in-up">
            <div className="size-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/10">
              <Sparkles className="size-6 text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold mb-1.5">An empty workshop</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Add a node from the left dock, ask the Commander to spawn one, or reset to the seed canvas to get started.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => addNode({ kind: "chat" })}
              >
                <Bot className="size-3.5" />
                Add an agent
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resetCanvas()}
              >
                Reset to seed
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Connect-mode banner */}
      {connectMode?.from && fromNode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 fade-in-up">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/15 backdrop-blur-md px-3 py-1.5 shadow-lg">
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
        <Controls
          className="!bg-card/80 !border-border/50 !rounded-lg !shadow-lg !backdrop-blur"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-card/80 !border-border/50 !rounded-lg !shadow-lg"
          nodeColor={(n) =>
            MINIMAP_COLORS[n.type as NodeKind] ?? "#888"
          }
          maskColor="oklch(0.13 0.005 55 / 0.7)"
          pannable
          zoomable
        />
        <CanvasToolbar />
      </ReactFlow>
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
