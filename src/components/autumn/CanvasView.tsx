// Autumn — CanvasView (react-flow canvas).
// Hosts the 7 node types + 2 edge types, with bus traffic visualization,
// auto-arrange, minimap, controls, and persistence of position changes.

"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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

  // Convert Autumn domain model → react-flow nodes/edges.
  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position,
        data: n.data,
      })),
    [nodes],
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
      // Apply position changes back to the store.
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          moveNode(c.id, c.position.x, c.position.y);
        }
        if (c.type === "select") {
          setSelectedNode(c.selected ? c.id : null);
        }
        if (c.type === "remove") {
          useAutumnStore.getState().removeNode(c.id);
        }
      }
    },
    [moveNode, setSelectedNode],
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
  }, [setSelectedNode]);

  return (
    <div className="absolute inset-0 autumn-canvas">
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
