// Autumn — Zustand store (client).
// Holds canvas state, task board, pulses, commander chat history, recent actions.
// Mirrors October's `useAppStore` (see 09-renderer-deep-dive.md) but trimmed to
// the parts we actually need for the web demo.

"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import type {
  AgentMessage,
  AgentRunDuration,
  AutumnEdge,
  AutumnNode,
  AutumnTask,
  BusPulse,
  CommanderResult,
  NodeKind,
} from "./types";
import {
  PERSONA_BY_ID,
  nextPersona,
  personaByName,
  resolvePersonaName,
} from "./personas";
import { defaultModelFor } from "./harness-meta";
import { buildSeedCanvas } from "./seed";

export interface ActivityEntry {
  id: string;
  ts: number;
  kind:
    | "commander_plan"
    | "agent_status"
    | "agent_message"
    | "bus_message_peer"
    | "task_claim"
    | "task_complete"
    | "task_add"
    | "node_added"
    | "node_removed"
    | "edge_added"
    | "edge_removed"
    | "canvas_saved"
    | "canvas_loaded"
    | "canvas_cleared"
    | "duplicate_node"
    | "search"
    | "agent_session_start"
    | "agent_session_stop";
  text: string;
  nodeId?: string;
  meta?: Record<string, unknown>;
}

export interface CommanderChatMessage {
  id: string;
  role: "user" | "commander";
  text: string;
  ts: number;
  plan?: CommanderResult;
  pending?: boolean;
  error?: string;
}

export interface AutumnStore {
  // canvas
  canvasId: string;
  canvasName: string;
  nodes: AutumnNode[];
  edges: AutumnEdge[];
  selectedNodeId: string | null;
  pulses: BusPulse[]; // transient edge animations (auto-clear after 3.5s)
  busHistory: BusPulse[]; // persistent log of all bus traffic (capped at 100)
  tasks: AutumnTask[];
  taskSeq: number;

  // commander chat
  commanderMessages: CommanderChatMessage[];
  recentActions: string[];
  isCommanderThinking: boolean;
  isAgentRunning: Record<string, boolean>; // nodeId -> running

  // ui
  rightPanelTab: "commander" | "tasks" | "bus" | "stats";
  isListening: boolean; // voice
  showHelp: boolean;
  commandHistory: string[]; // recent user commands for quick-chips
  isSaving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  settingsNodeId: string | null; // chat node currently being edited in settings dialog
  showCanvasSwitcher: boolean;
  showCommandPalette: boolean;
  showExportDialog: boolean;
  showActivityLog: boolean;
  shortcutHelpOpen: boolean;
  pendingCommand: string | null; // when set, CommanderPanel will auto-send this command
  connectMode: { from: string | null } | null; // when active, next clicked chat node becomes the target
  activityLog: ActivityEntry[]; // global append-only activity timeline

  // multi-select + search (Round 4 additions)
  selectedNodeIds: string[]; // for bulk operations (Shift+click)
  searchQuery: string; // active node search query
  showNodeSearch: boolean; // node search overlay open?
  searchMatchIds: string[]; // ids that match the current query

  // per-agent execution history panel (Task 2-a)
  agentHistoryOpen: boolean;
  agentHistoryFor: string | null; // nodeId currently being viewed in the history panel

  // agent run duration tracking
  agentRunDurations: Record<string, AgentRunDuration[]>; // nodeId → array of {start, end?}

  // minimap + edge labels (Task 4-c)
  showMinimap: boolean;

  // Round 9 — canvas themes + bus message detail dialog
  canvasTheme: "autumn" | "midnight" | "forest" | "neon";
  selectedBusMessageId: string | null; // when set, BusMessageDetailDialog shows this entry
  isRunAllInProgress: boolean; // true while "Run All" is dispatching agents sequentially

  // ---- actions ----
  setCanvasName: (name: string) => void;
  setSelectedNode: (id: string | null) => void;
  setRightPanelTab: (t: "commander" | "tasks" | "bus" | "stats") => void;
  setListening: (v: boolean) => void;
  setShowHelp: (v: boolean) => void;
  setSettingsNode: (id: string | null) => void;
  setShowCanvasSwitcher: (v: boolean) => void;
  setShowCommandPalette: (v: boolean) => void;
  setShowExportDialog: (v: boolean) => void;
  setShowActivityLog: (v: boolean) => void;
  setShortcutHelpOpen: (v: boolean) => void;
  setPendingCommand: (cmd: string | null) => void;
  setConnectMode: (m: { from: string | null } | null) => void;
  pushActivity: (e: Omit<ActivityEntry, "id" | "ts">) => void;
  clearActivity: () => void;
  loadActivity: (canvasId: string) => Promise<void>;
  pushCommandHistory: (cmd: string) => void;
  arrangeNodes: () => void;
  clearCanvas: () => void;
  saveCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  duplicateCanvas: (id: string) => Promise<void>;
  exportCanvas: () => string; // returns JSON string
  importCanvas: (json: string) => boolean; // returns success
  importCanvasState: (state: {
    nodes: AutumnNode[];
    edges: AutumnEdge[];
    tasks: AutumnTask[];
    canvasName: string;
  }) => void;
  // multi-select + search actions
  addToSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
  setShowNodeSearch: (v: boolean) => void;
  duplicateNode: (id: string) => string | null;
  removeNodes: (ids: string[]) => void;

  // per-agent execution history panel (Task 2-a)
  setAgentHistoryOpen: (v: boolean) => void;
  setAgentHistoryFor: (id: string | null) => void;

  // agent run duration tracking
  recordRunStart: (nodeId: string) => void;
  recordRunEnd: (nodeId: string) => void;
  getAgentRunDurations: (nodeId: string) => AgentRunDuration[];
  getAvgRunDuration: (nodeId: string) => number | null; // avg ms, null if no completed runs

  // canvas presets
  createCanvasFromPreset: (presetName: string) => void;

  // minimap + edge labels (Task 4-c)
  setShowMinimap: (v: boolean) => void;
  updateEdgeLabel: (edgeId: string, label: string) => void;
  selectAllNodes: () => void;

  // Round 9 — canvas themes + bus message detail + run all
  setCanvasTheme: (theme: "autumn" | "midnight" | "forest" | "neon") => void;
  setSelectedBusMessage: (id: string | null) => void;
  setIsRunAllInProgress: (v: boolean) => void;

  addNode: (node: Partial<AutumnNode> & { kind: NodeKind }) => string;
  updateNode: (id: string, patch: Partial<AutumnNode>) => void;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, x: number, y: number) => void;
  renameNode: (id: string, name: string) => void;

  connectNodes: (from: string, to: string, kind?: "bus" | "navigation") => void;
  disconnectNodes: (from: string, to: string) => void;

  addTask: (description: string, afterIds?: number[]) => string;
  claimTask: (taskId: string, nodeId: string) => void;
  completeTask: (taskId: string, note?: string) => void;

  pushPulse: (p: Omit<BusPulse, "id" | "ts">) => void;
  clearPulses: () => void;
  clearBusHistory: () => void;
  removeBusHistoryEntry: (id: string) => void;

  pushCommanderMessage: (m: Omit<CommanderChatMessage, "id" | "ts">) => string;
  updateCommanderMessage: (id: string, patch: Partial<CommanderChatMessage>) => void;
  clearCommanderMessages: () => void;
  setCommanderThinking: (v: boolean) => void;
  pushRecentAction: (a: string) => void;

  appendAgentMessage: (nodeId: string, message: Omit<AgentMessage, "id" | "ts">) => string;
  updateAgentMessage: (nodeId: string, msgId: string, patch: Partial<AgentMessage>) => void;
  setAgentRunning: (nodeId: string, v: boolean) => void;
  setAgentStatus: (nodeId: string, status: string, doing?: string) => void;

  applyCommanderPlan: (plan: CommanderResult) => string[]; // returns created node ids (for @N refs)
  resolveNodeRef: (ref: string, createdIds: string[]) => string | null;

  resetCanvas: () => void;
}

const seed = buildSeedCanvas();

export const useAutumnStore = create<AutumnStore>((set, get) => ({
  canvasId: "default",
  canvasName: "Medical App Workshop",
  nodes: seed.nodes,
  edges: seed.edges,
  selectedNodeId: null,
  pulses: [],
  busHistory: [],
  tasks: seed.tasks,
  taskSeq: 3,

  commanderMessages: [
    {
      id: "cmd-intro",
      role: "commander",
      text: "Autumn Commander online. Atlas, Apollo and Orion are on the canvas and wired via the bus. Tell me what to build — try \"spawn Juno and have her wire up tests for the medical app\".",
      ts: Date.now(),
    },
  ],
  recentActions: [],
  isCommanderThinking: false,
  isAgentRunning: {},
  rightPanelTab: "commander",
  isListening: false,
  showHelp: false,
  commandHistory: [],
  isSaving: false,
  lastSavedAt: null,
  saveError: null,
  settingsNodeId: null,
  showCanvasSwitcher: false,
  showCommandPalette: false,
  showExportDialog: false,
  showActivityLog: false,
  shortcutHelpOpen: false,
  pendingCommand: null,
  connectMode: null,
  activityLog: [
    {
      id: "seed-act-1",
      ts: Date.now(),
      kind: "node_added",
      text: "Workshop seeded with Atlas, Apollo, Orion, and a screen preview.",
    },
  ],

  // multi-select + search (Round 4)
  selectedNodeIds: [],
  searchQuery: "",
  showNodeSearch: false,
  searchMatchIds: [],

  // per-agent execution history panel (Task 2-a)
  agentHistoryOpen: false,
  agentHistoryFor: null,

  // agent run duration tracking
  agentRunDurations: {},

  // minimap + edge labels (Task 4-c)
  showMinimap: true,

  // Round 9 — canvas themes + bus message detail + run all
  canvasTheme: "autumn",
  selectedBusMessageId: null,
  isRunAllInProgress: false,

  setCanvasName: (name) => set({ canvasName: name }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setRightPanelTab: (t) => set({ rightPanelTab: t }),
  setListening: (v) => set({ isListening: v }),
  setShowHelp: (v) => set({ showHelp: v }),
  setSettingsNode: (id) => set({ settingsNodeId: id }),
  setShowCanvasSwitcher: (v) => set({ showCanvasSwitcher: v }),
  setShowCommandPalette: (v) => set({ showCommandPalette: v }),
  setShowExportDialog: (v) => set({ showExportDialog: v }),
  setShowActivityLog: (v) => set({ showActivityLog: v }),
  setShortcutHelpOpen: (v) => set({ shortcutHelpOpen: v }),
  setPendingCommand: (cmd) => set({ pendingCommand: cmd }),
  setConnectMode: (m) => set({ connectMode: m }),

  pushActivity: (e) => {
    const entry: ActivityEntry = {
      ...e,
      id: `act-${nanoid(8)}`,
      ts: Date.now(),
    };
    set((s) => ({
      activityLog: [...s.activityLog, entry].slice(-200),
    }));
    // Fire-and-forget persist to DB (debounced batch).
    scheduleLogPersist(get().canvasId, entry);
  },
  clearActivity: () => {
    set({ activityLog: [] });
    // Also clear the persisted logs for the current canvas.
    const cid = get().canvasId;
    fetch(`/api/logs?canvas=${encodeURIComponent(cid)}`, { method: "DELETE" }).catch(
      () => {},
    );
  },
  loadActivity: async (canvasId) => {
    try {
      const r = await fetch(
        `/api/logs?canvas=${encodeURIComponent(canvasId)}&limit=200`,
        { method: "GET" },
      );
      if (!r.ok) return;
      const j = await r.json();
      const entries: ActivityEntry[] = (j.entries ?? []).map(
        (e: {
          id: string;
          ts: number;
          kind: ActivityEntry["kind"];
          text: string;
          nodeId?: string;
          meta?: Record<string, unknown>;
        }) => ({
          id: e.id,
          ts: e.ts,
          kind: e.kind,
          text: e.text,
          nodeId: e.nodeId,
          meta: e.meta,
        }),
      );
      // Merge persisted entries with the in-memory seed (dedup by id).
      set((s) => {
        const existingIds = new Set(s.activityLog.map((x) => x.id));
        const merged = [...s.activityLog, ...entries.filter((e) => !existingIds.has(e.id))];
        return { activityLog: merged.slice(-200) };
      });
    } catch {
      /* ignore — best-effort */
    }
  },

  // multi-select + search actions
  addToSelection: (id) =>
    set((s) => ({
      selectedNodeIds: s.selectedNodeIds.includes(id)
        ? s.selectedNodeIds
        : [...s.selectedNodeIds, id],
    })),
  toggleSelection: (id) =>
    set((s) => ({
      selectedNodeIds: s.selectedNodeIds.includes(id)
        ? s.selectedNodeIds.filter((x) => x !== id)
        : [...s.selectedNodeIds, id],
    })),
  clearSelection: () => set({ selectedNodeIds: [] }),
  setSearchQuery: (q) => {
    const query = q.trim().toLowerCase();
    set((s) => {
      if (!query) return { searchQuery: q, searchMatchIds: [] };
      const matches = s.nodes
        .filter((n) => {
          const haystack = `${n.name} ${n.kind}`.toLowerCase();
          if (n.kind === "chat") {
            const d = n.data as {
              harness?: string;
              personaId?: string;
              model?: string;
              doing?: string;
              status?: string;
            };
            return (
              haystack.includes(query) ||
              (d.harness ?? "").toLowerCase().includes(query) ||
              (d.model ?? "").toLowerCase().includes(query) ||
              (d.doing ?? "").toLowerCase().includes(query) ||
              (d.status ?? "").toLowerCase().includes(query)
            );
          }
          if (n.kind === "sticky") {
            return (n.data as { text?: string }).text?.toLowerCase().includes(query);
          }
          return haystack.includes(query);
        })
        .map((n) => n.id);
      return { searchQuery: q, searchMatchIds: matches };
    });
  },
  setShowNodeSearch: (v) =>
    set((s) => ({
      showNodeSearch: v,
      // Clear matches when closing the overlay.
      searchMatchIds: v ? s.searchMatchIds : [],
      searchQuery: v ? s.searchQuery : "",
    })),
  setAgentHistoryOpen: (v) => set({ agentHistoryOpen: v }),
  setAgentHistoryFor: (id) => set({ agentHistoryFor: id }),

  // Agent run duration tracking
  recordRunStart: (nodeId) =>
    set((s) => ({
      agentRunDurations: {
        ...s.agentRunDurations,
        [nodeId]: [...(s.agentRunDurations[nodeId] ?? []), { start: Date.now() }],
      },
    })),
  recordRunEnd: (nodeId) =>
    set((s) => {
      const runs = s.agentRunDurations[nodeId] ?? [];
      const lastRun = runs[runs.length - 1];
      if (!lastRun || lastRun.end) return s;
      return {
        agentRunDurations: {
          ...s.agentRunDurations,
          [nodeId]: [...runs.slice(0, -1), { ...lastRun, end: Date.now() }],
        },
      };
    }),
  getAgentRunDurations: (nodeId) => get().agentRunDurations[nodeId] ?? [],
  getAvgRunDuration: (nodeId) => {
    const runs = get().agentRunDurations[nodeId] ?? [];
    const completed = runs.filter((r) => r.end !== undefined);
    if (completed.length === 0) return null;
    const total = completed.reduce((sum, r) => sum + (r.end! - r.start), 0);
    return Math.round(total / completed.length);
  },

  // Canvas presets
  createCanvasFromPreset: (presetName) => {
    const now = Date.now();
    // First clear the canvas
    set({ nodes: [], edges: [], tasks: [], taskSeq: 0, pulses: [], busHistory: [], selectedNodeId: null });

    const canvasId = `canvas-${Date.now()}`;
    set({ canvasId, canvasName: presetName });

    if (presetName === "Empty Canvas") {
      // Nothing to add
      get().pushActivity({
        kind: "canvas_cleared",
        text: "Created an empty canvas.",
      });
      return;
    }

    if (presetName === "Pair Programming") {
      const id1 = get().addNode({ kind: "chat", name: "Atlas" });
      const id2 = get().addNode({ kind: "chat", name: "Orion" });
      get().connectNodes(id1, id2, "bus");
      get().pushActivity({
        kind: "commander_plan",
        text: "Created Pair Programming preset: 2 connected agents.",
      });
      return;
    }

    if (presetName === "Full Team") {
      const id1 = get().addNode({ kind: "chat", name: "Atlas" });
      const id2 = get().addNode({ kind: "chat", name: "Apollo" });
      const id3 = get().addNode({ kind: "chat", name: "Orion" });
      const id4 = get().addNode({ kind: "chat", name: "Juno" });
      const screenId = get().addNode({ kind: "screen", name: "Preview" });
      const stickyId = get().addNode({ kind: "sticky", name: "Sprint Notes", data: { text: "Full team sprint: architecture + UI + backend + tests", color: "amber" } });
      get().connectNodes(id1, id2, "bus");
      get().connectNodes(id1, id3, "bus");
      get().connectNodes(id3, id4, "bus");
      get().connectNodes(id2, screenId, "navigation");
      get().pushActivity({
        kind: "commander_plan",
        text: "Created Full Team preset: 4 agents + screen + sticky.",
      });
      // Auto-arrange after creating all nodes
      setTimeout(() => get().arrangeNodes(), 100);
      return;
    }
  },

  setShowMinimap: (v) => set({ showMinimap: v }),
  updateEdgeLabel: (edgeId, label) =>
    set((s) => ({
      edges: s.edges.map((e) => (e.id === edgeId ? { ...e, label } : e)),
    })),
  selectAllNodes: () =>
    set((s) => ({
      selectedNodeIds: s.nodes.map((n) => n.id),
      selectedNodeId: s.nodes.length > 0 ? s.nodes[0].id : null,
    })),

  // Round 9 — canvas themes + bus message detail + run all
  setCanvasTheme: (theme) => {
    set({ canvasTheme: theme });
    // Persist to localStorage so theme survives reloads.
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("autumn-canvas-theme", theme);
      } catch {
        /* ignore */
      }
    }
    toast.success(`Theme: ${theme}`, { duration: 1500 });
  },
  setSelectedBusMessage: (id) => set({ selectedBusMessageId: id }),
  setIsRunAllInProgress: (v) => set({ isRunAllInProgress: v }),

  duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return null;
    const newId = `node-${nanoid(8)}`;
    // Deep clone data (so messages don't get shared by reference).
    const clonedData = JSON.parse(JSON.stringify(node.data)) as typeof node.data;
    // For chat nodes, append a "(copy)" marker to the system message so it's clear.
    if (node.kind === "chat") {
      const d = clonedData as {
        messages: { id: string; role: string; text: string; ts: number }[];
        status: string;
        doing?: string;
      };
      d.status = "idle";
      d.doing = "Standing by (duplicate).";
      d.messages = [
        {
          id: `m-${nanoid(6)}`,
          role: "system",
          text: `${node.name} (duplicate) online · ready for tasks.`,
          ts: Date.now(),
        },
      ];
    }
    const newNode: AutumnNode = {
      ...node,
      id: newId,
      name: `${node.name} (copy)`,
      position: {
        x: node.position.x + 40,
        y: node.position.y + 40,
      },
      data: clonedData,
      createdAt: Date.now(),
    };
    set((s) => ({ nodes: [...s.nodes, newNode] }));
    get().pushActivity({
      kind: "duplicate_node",
      text: `Duplicated "${node.name}" → "${newNode.name}".`,
      nodeId: newId,
      meta: { sourceId: id },
    });
    return newId;
  },
  removeNodes: (ids) => {
    const idSet = new Set(ids);
    const removed = get().nodes.filter((n) => idSet.has(n.id));
    set((s) => ({
      nodes: s.nodes.filter((n) => !idSet.has(n.id)),
      edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      selectedNodeId: idSet.has(s.selectedNodeId ?? "") ? null : s.selectedNodeId,
      selectedNodeIds: s.selectedNodeIds.filter((x) => !idSet.has(x)),
    }));
    for (const n of removed) {
      get().pushActivity({
        kind: "node_removed",
        text: `Removed ${n.kind} node "${n.name}".`,
        nodeId: n.id,
      });
    }
  },

  pushCommandHistory: (cmd) =>
    set((s) => ({
      commandHistory: [cmd, ...s.commandHistory.filter((c) => c !== cmd)].slice(0, 8),
    })),

  arrangeNodes: () => {
    // Tiered auto-layout:
    //   Tier 0 — chat nodes with no incoming bus edges (roots)
    //   Tier 1 — chat nodes reached from tier 0 via bus edges
    //   Tier 2 — chat nodes reached from tier 1 (and so on)
    //   Tier 3+ — non-chat nodes (terminal, screen, sticky, analytics, browser, remotion)
    //             grouped by kind, in a grid below.
    const nodes = get().nodes;
    const edges = get().edges;
    const busEdges = edges.filter((e) => e.kind === "bus");

    const chatNodes = nodes.filter((n) => n.kind === "chat");
    const otherNodes = nodes.filter((n) => n.kind !== "chat");

    // Build adjacency for chat nodes via bus edges.
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const n of chatNodes) {
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    }
    for (const e of busEdges) {
      if (incoming.has(e.target) && outgoing.has(e.source)) {
        incoming.get(e.target)!.push(e.source);
        outgoing.get(e.source)!.push(e.target);
      }
    }

    // BFS tiers from roots (no incoming).
    const tierOf = new Map<string, number>();
    const roots = chatNodes.filter((n) => incoming.get(n.id)!.length === 0);
    let queue: string[] = roots.map((n) => n.id);
    roots.forEach((n) => tierOf.set(n.id, 0));
    while (queue.length) {
      const next: string[] = [];
      for (const id of queue) {
        const t = tierOf.get(id) ?? 0;
        for (const child of outgoing.get(id) ?? []) {
          if (!tierOf.has(child)) {
            tierOf.set(child, t + 1);
            next.push(child);
          }
        }
      }
      queue = next;
    }
    // Any disconnected chats go to tier 0.
    for (const n of chatNodes) if (!tierOf.has(n.id)) tierOf.set(n.id, 0);

    // Group chats by tier.
    const tiers = new Map<number, string[]>();
    for (const n of chatNodes) {
      const t = tierOf.get(n.id) ?? 0;
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t)!.push(n.id);
    }

    const updated: AutumnNode[] = [];
    const COL_W = 320;
    const ROW_H = 220;
    const PAD_X = 80;
    const PAD_Y = 80;

    // Place chats tier-by-tier (rows), spread horizontally within each tier.
    const tierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
    tierKeys.forEach((t) => {
      const ids = tiers.get(t)!;
      ids.forEach((id, i) => {
        const n = nodes.find((x) => x.id === id)!;
        updated.push({
          ...n,
          position: {
            x: PAD_X + i * COL_W,
            y: PAD_Y + t * ROW_H,
          },
        });
      });
    });

    // Non-chat nodes: grouped by kind, in a grid below all chat tiers.
    const NON_CHAT_ROW = PAD_Y + tierKeys.length * ROW_H + 40;
    const byKind = new Map<string, typeof otherNodes>();
    for (const n of otherNodes) {
      if (!byKind.has(n.kind)) byKind.set(n.kind, []);
      byKind.get(n.kind)!.push(n);
    }
    let col = 0;
    for (const [, group] of byKind) {
      group.forEach((n, i) => {
        updated.push({
          ...n,
          position: {
            x: PAD_X + col * (COL_W * 0.7),
            y: NON_CHAT_ROW + i * 100,
          },
        });
      });
      col += 1;
    }

    set({ nodes: updated });
    get().pushActivity({
      kind: "commander_plan",
      text: `Auto-arranged ${updated.length} node${updated.length === 1 ? "" : "s"} into a tiered layout.`,
    });
  },

  clearCanvas: () => {
    set({ nodes: [], edges: [], tasks: [], taskSeq: 0, pulses: [], busHistory: [], selectedNodeId: null });
    get().pushActivity({
      kind: "canvas_cleared",
      text: "Cleared all nodes, edges, and tasks from the canvas.",
    });
  },

  saveCanvas: async () => {
    const s = get();
    set({ isSaving: true, saveError: null });
    try {
      const payload = {
        id: s.canvasId,
        name: s.canvasName,
        state: JSON.stringify({
          nodes: s.nodes,
          edges: s.edges,
          tasks: s.tasks,
          taskSeq: s.taskSeq,
        }),
      };
      const r = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`save ${r.status}`);
      const j = await r.json();
      set({ isSaving: false, lastSavedAt: Date.now(), canvasId: j.id ?? s.canvasId });
      get().pushActivity({
        kind: "canvas_saved",
        text: `Saved "${s.canvasName}" to the local database.`,
      });
      // Subtle auto-save toast
      toast("Canvas auto-saved", { duration: 2000 });
    } catch (err) {
      set({
        isSaving: false,
        saveError: err instanceof Error ? err.message : "save failed",
      });
    }
  },

  loadCanvas: async (id) => {
    set({ isSaving: true, saveError: null });
    try {
      const r = await fetch(`/api/canvas?id=${encodeURIComponent(id)}`, { method: "GET" });
      if (!r.ok) throw new Error(`load ${r.status}`);
      const j = await r.json();
      const state = typeof j.state === "string" ? JSON.parse(j.state) : j.state;
      set({
        canvasId: j.id ?? id,
        canvasName: j.name ?? "Untitled Canvas",
        nodes: state.nodes ?? [],
        edges: state.edges ?? [],
        tasks: state.tasks ?? [],
        taskSeq: state.taskSeq ?? 0,
        pulses: [],
        busHistory: [],
        selectedNodeId: null,
        isSaving: false,
        lastSavedAt: Date.now(),
      });
      get().pushActivity({
        kind: "canvas_loaded",
        text: `Loaded "${j.name ?? "Untitled Canvas"}" from the database.`,
      });
      // Also load persisted activity log entries for this canvas.
      void get().loadActivity(j.id ?? id);
    } catch (err) {
      set({
        isSaving: false,
        saveError: err instanceof Error ? err.message : "load failed",
      });
    }
  },

  duplicateCanvas: async (id) => {
    try {
      const r = await fetch(`/api/canvas?id=${encodeURIComponent(id)}`, { method: "GET" });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const j = await r.json();
      const state = typeof j.state === "string" ? JSON.parse(j.state) : j.state;
      const newId = `canvas-${nanoid(10)}`;
      const newName = `${j.name ?? "Untitled Canvas"} (copy)`;
      const r2 = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId, name: newName, state: JSON.stringify(state) }),
      });
      if (!r2.ok) throw new Error(`dup ${r2.status}`);
      get().pushActivity({
        kind: "canvas_saved",
        text: `Duplicated canvas as "${newName}".`,
      });
    } catch (err) {
      set({
        saveError: err instanceof Error ? err.message : "duplicate failed",
      });
    }
  },

  exportCanvas: () => {
    const s = get();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "autumn",
      canvas: {
        id: s.canvasId,
        name: s.canvasName,
        nodes: s.nodes,
        edges: s.edges,
        tasks: s.tasks,
        taskSeq: s.taskSeq,
      },
    };
    return JSON.stringify(payload, null, 2);
  },

  importCanvas: (json) => {
    try {
      const parsed = JSON.parse(json);
      const c = parsed.canvas ?? parsed;
      if (!Array.isArray(c.nodes) || !Array.isArray(c.edges)) return false;
      set({
        canvasId: `canvas-${nanoid(10)}`,
        canvasName: c.name ?? "Imported Canvas",
        nodes: c.nodes,
        edges: c.edges,
        tasks: c.tasks ?? [],
        taskSeq: c.taskSeq ?? 0,
        pulses: [],
        busHistory: [],
        selectedNodeId: null,
      });
      get().pushActivity({
        kind: "canvas_loaded",
        text: `Imported canvas with ${c.nodes.length} nodes and ${c.edges.length} edges.`,
      });
      return true;
    } catch {
      return false;
    }
  },

  importCanvasState: (state) => {
    set({
      // Use a "shared-" prefix so we don't accidentally clobber the default
      // canvas id when the user pastes a share link.
      canvasId: `shared-${nanoid(6)}`,
      canvasName: state.canvasName,
      nodes: state.nodes,
      edges: state.edges,
      tasks: state.tasks,
      // taskSeq is intentionally NOT carried over from shared state — tasks
      // created on the shared canvas should continue numbering from the
      // highest existing seq in the imported tasks (or 0 if empty).
      taskSeq: state.tasks.reduce((max, t) => Math.max(max, t.seq), 0),
      pulses: [],
      busHistory: [],
      selectedNodeId: null,
      selectedNodeIds: [],
    });
    get().pushActivity({
      kind: "canvas_loaded",
      text: `Imported shared canvas: ${state.canvasName} (${state.nodes.length} nodes, ${state.edges.length} edges)`,
    });
  },

  addNode: (partial) => {
    const id = partial.id ?? `node-${nanoid(8)}`;
    const node: AutumnNode = {
      id,
      kind: partial.kind,
      name: partial.name ?? defaultNameForKind(partial.kind),
      position: partial.position ?? randomPosition(),
      data: partial.data ?? defaultDataForKind(partial.kind),
      createdAt: Date.now(),
    };
    set((s) => ({ nodes: [...s.nodes, node] }));
    get().pushActivity({
      kind: "node_added",
      text: `Added ${node.kind} node "${node.name}".`,
      nodeId: id,
    });
    // Toast: new agent spawned
    if (node.kind === "chat") {
      toast.success(`Agent ${node.name} deployed to the canvas`, { duration: 3000 });
    }
    return id;
  },

  updateNode: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as typeof n.data } : n,
      ),
    })),

  removeNode: (id) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === id);
      if (node) {
        // Defer the activity log to after the state set.
        queueMicrotask(() =>
          get().pushActivity({
            kind: "node_removed",
            text: `Removed ${node.kind} node "${node.name}".`,
            nodeId: id,
          }),
        );
      }
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      };
    }),

  moveNode: (id, x, y) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, position: { x, y } } : n,
      ),
    })),

  renameNode: (id, name) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
    })),

  connectNodes: (from, to, kind = "bus") => {
    if (from === to) return;
    const exists = get().edges.some(
      (e) =>
        (e.source === from && e.target === to) ||
        (e.source === to && e.target === from),
    );
    if (exists) return;
    const edge: AutumnEdge = {
      id: `edge-${nanoid(8)}`,
      kind,
      source: from,
      target: to,
      label: kind === "bus" ? "bus" : "nav",
      animated: kind === "bus",
    };
    set((s) => ({ edges: [...s.edges, edge] }));
    const fromName = get().nodes.find((n) => n.id === from)?.name ?? from;
    const toName = get().nodes.find((n) => n.id === to)?.name ?? to;
    get().pushActivity({
      kind: "edge_added",
      text: `Connected ${fromName} → ${toName} (${kind}).`,
    });
    // Toast: agents connected
    if (kind === "bus") {
      toast(`Bus edge: ${fromName} → ${toName}`, { duration: 2500 });
    }
  },

  disconnectNodes: (from, to) =>
    set((s) => ({
      edges: s.edges.filter(
        (e) =>
          !(
            (e.source === from && e.target === to) ||
            (e.source === to && e.target === from)
          ),
      ),
    })),

  addTask: (description, afterIds = []) => {
    const id = `task-${nanoid(8)}`;
    const seq = get().taskSeq + 1;
    const status = afterIds.some((s) =>
      get().tasks.some((t) => t.seq === s && t.status !== "done"),
    )
      ? "blocked"
      : "open";
    const task: AutumnTask = {
      id,
      seq,
      canvasId: get().canvasId,
      description,
      status,
      assigneeId: null,
      afterIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ tasks: [...s.tasks, task], taskSeq: seq }));
    get().pushActivity({
      kind: "task_add",
      text: `Added task t${seq}: "${description.slice(0, 60)}".`,
    });
    return id;
  },

  claimTask: (taskId, nodeId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? { ...t, assigneeId: nodeId, status: "in_progress", updatedAt: Date.now() }
          : t,
      ),
    })),

  completeTask: (taskId, note) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: "done", note, updatedAt: Date.now() }
          : t,
      ),
    })),

  pushPulse: (p) => {
    const pulse: BusPulse = { ...p, id: `pulse-${nanoid(8)}`, ts: Date.now() };
    set((s) => ({
      pulses: [...s.pulses, pulse].slice(-50),
      // Also push to the persistent bus history (capped at 100).
      busHistory: [...s.busHistory, pulse].slice(-100),
    }));
    // auto-clear the transient pulse after 3.5s (history stays).
    setTimeout(() => {
      set((s) => ({ pulses: s.pulses.filter((x) => x.id !== pulse.id) }));
    }, 3500);
  },

  clearPulses: () => set({ pulses: [] }),

  clearBusHistory: () => set({ busHistory: [], pulses: [] }),

  removeBusHistoryEntry: (id) =>
    set((s) => ({
      busHistory: s.busHistory.filter((p) => p.id !== id),
      pulses: s.pulses.filter((p) => p.id !== id),
    })),

  pushCommanderMessage: (m) => {
    const id = `cmd-${nanoid(8)}`;
    const msg: CommanderChatMessage = { ...m, id, ts: Date.now() };
    set((s) => ({ commanderMessages: [...s.commanderMessages, msg] }));
    return id;
  },

  updateCommanderMessage: (id, patch) =>
    set((s) => ({
      commanderMessages: s.commanderMessages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),

  clearCommanderMessages: () => set({ commanderMessages: [] }),

  setCommanderThinking: (v) => set({ isCommanderThinking: v }),

  pushRecentAction: (a) =>
    set((s) => ({ recentActions: [...s.recentActions, a].slice(-20) })),

  appendAgentMessage: (nodeId, message) => {
    const id = `msg-${nanoid(8)}`;
    const msg: AgentMessage = { ...message, id, ts: Date.now() };
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        if (n.kind !== "chat") return n;
        const data = n.data as { messages: AgentMessage[] };
        return { ...n, data: { ...data, messages: [...data.messages, msg] } };
      }),
    }));
    return id;
  },

  updateAgentMessage: (nodeId, msgId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== "chat") return n;
        const data = n.data as { messages: AgentMessage[] };
        return {
          ...n,
          data: {
            ...data,
            messages: data.messages.map((m) =>
              m.id === msgId ? { ...m, ...patch } : m,
            ),
          },
        };
      }),
    })),

  setAgentRunning: (nodeId, v) =>
    set((s) => ({ isAgentRunning: { ...s.isAgentRunning, [nodeId]: v } })),

  setAgentStatus: (nodeId, status, doing) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && n.kind === "chat"
          ? {
              ...n,
              data: {
                ...(n.data as Record<string, unknown>),
                status,
                doing: doing ?? (n.data as { doing?: string }).doing,
              } as typeof n.data,
            }
          : n,
      ),
    })),

  applyCommanderPlan: (plan) => {
    if (plan.kind !== "steps") return [];
    const createdIds: string[] = [];
    for (const [i, step] of plan.steps.entries()) {
      const createdId = executeStep(get, set, step, createdIds, i + 1);
      if (createdId) createdIds.push(createdId);
      get().pushRecentAction(`${step.action}(${JSON.stringify(step.args).slice(0, 60)})`);
    }
    get().pushActivity({
      kind: "commander_plan",
      text: `Commander executed ${plan.steps.length} action${plan.steps.length === 1 ? "" : "s"}: ${plan.steps.map((s) => s.action).join(", ")}.`,
    });
    return createdIds;
  },

  resolveNodeRef: (ref, createdIds) => {
    if (!ref) return null;
    if (typeof ref !== "string") return null;
    // @N
    const m = ref.match(/^@(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      return createdIds[idx] ?? null;
    }
    // existing node id
    const found = get().nodes.find((n) => n.id === ref);
    if (found) return found.id;
    // persona name
    const personaId = resolvePersonaName(ref);
    if (personaId) {
      const node = get().nodes.find(
        (n) => n.kind === "chat" && (n.data as { personaId?: string }).personaId === personaId,
      );
      if (node) return node.id;
    }
    // by name
    const byName = get().nodes.find(
      (n) => n.name.toLowerCase() === ref.toLowerCase(),
    );
    if (byName) return byName.id;
    return null;
  },

  resetCanvas: () => {
    const fresh = buildSeedCanvas();
    set({
      nodes: fresh.nodes,
      edges: fresh.edges,
      tasks: fresh.tasks,
      taskSeq: 3,
      pulses: [],
      busHistory: [],
      selectedNodeId: null,
    });
  },
}));

// ---- helpers ----

function defaultNameForKind(kind: NodeKind): string {
  switch (kind) {
    case "chat":
      return nextPersona().name;
    case "terminal":
      return "Terminal";
    case "screen":
      return "Screen";
    case "sticky":
      return "Note";
    case "analytics":
      return "Analytics";
    case "youtube":
      return "Browser";
    case "remotion":
      return "Remotion";
  }
}

function randomPosition(): { x: number; y: number } {
  return {
    x: 200 + Math.random() * 400,
    y: 120 + Math.random() * 280,
  };
}

function defaultDataForKind(kind: NodeKind): unknown {
  const now = Date.now();
  switch (kind) {
    case "chat": {
      const p = nextPersona();
      return {
        harness: p.harness,
        personaId: p.id,
        model: defaultModelFor(p.harness),
        effort: "medium" as const,
        permission: "ask" as const,
        status: "idle",
        doing: "Standing by.",
        messages: [
          {
            id: `m-${nanoid(6)}`,
            role: "system" as const,
            text: `${p.name} online · ${p.harness} · ${p.tagline}`,
            ts: now,
          },
        ],
      };
    }
    case "terminal":
      return {
        status: "idle",
        dir: "~/autumn",
        port: undefined,
        lines: [
          { text: "$ autumn shell ready", kind: "info" as const, ts: now },
        ],
      };
    case "screen":
      return { screenKind: "desktop", name: "Preview", route: "/", url: "/preview" };
    case "sticky":
      return { text: "New note", color: "amber" };
    case "analytics":
      return {
        title: "Canvas metrics",
        metrics: [
          { label: "Agents", value: "0" },
          { label: "Tasks done", value: "0" },
          { label: "Bus msgs", value: "0" },
        ],
      };
    case "youtube":
      return { url: "https://example.com", name: "Browser" };
    case "remotion":
      return { name: "Video", crew: [], status: "idle" };
  }
}

// Execute a single Commander step. Returns the created node id if applicable.
function executeStep(
  get: () => AutumnStore,
  set: (partial: Partial<AutumnStore>) => void,
  step: { action: string; args: Record<string, unknown> },
  createdIds: string[],
  stepNum: number,
): string | null {
  const store = get();
  const { action, args } = step;

  switch (action) {
    case "add_chat": {
      const personaArg = args.persona as string | undefined;
      const harnessArg = args.harness as string | undefined;
      const persona = personaArg
        ? PERSONA_BY_ID[resolvePersonaName(personaArg) ?? personaArg] ?? nextPersona()
        : nextPersona();
      const harness = harnessArg ?? persona.harness;
      const id = store.addNode({
        kind: "chat",
        name: args.name as string | undefined ?? persona.name,
        data: {
          harness,
          personaId: persona.id,
          model: defaultModelFor(harness),
          effort: "medium",
          permission: "ask",
          status: "idle",
          doing: "Standing by.",
          messages: [
            {
              id: `m-${nanoid(6)}`,
              role: "system",
              text: `${persona.name} online · ${harness} · ${persona.tagline}`,
              ts: Date.now(),
            },
          ],
        },
        position: randomPosition(),
      });
      return id;
    }
    case "add_agents": {
      const count = Math.max(1, Number(args.count ?? 1));
      const agent = args.agent as string | undefined;
      const surface = (args.surface as string | undefined) ?? "chat";
      let lastId: string | null = null;
      for (let i = 0; i < count; i++) {
        if (surface === "terminal") {
          lastId = store.addNode({ kind: "terminal" });
        } else {
          const persona = nextPersona();
          const harness = agent ?? persona.harness;
          lastId = store.addNode({
            kind: "chat",
            name: persona.name,
            data: {
              harness,
              personaId: persona.id,
              model: defaultModelFor(harness),
              effort: "medium",
              permission: "ask",
              status: "idle",
              doing: "Standing by.",
              messages: [
                {
                  id: `m-${nanoid(6)}`,
                  role: "system",
                  text: `${persona.name} online · ${harness} · ${persona.tagline}`,
                  ts: Date.now(),
                },
              ],
            },
            position: {
              x: 200 + i * 80 + Math.random() * 200,
              y: 120 + Math.random() * 280,
            },
          });
        }
      }
      return lastId;
    }
    case "add_terminal": {
      return store.addNode({ kind: "terminal", name: args.name as string | undefined });
    }
    case "add_screen": {
      const screenKind = (args.kind as "desktop" | "phone") ?? "desktop";
      return store.addNode({
        kind: "screen",
        name: args.name as string | undefined ?? `Preview · ${screenKind}`,
        data: {
          screenKind,
          name: args.name as string | undefined ?? "Preview",
          route: (args.route as string | undefined) ?? "/",
          url: "/preview",
        },
      });
    }
    case "add_note": {
      return store.addNode({
        kind: "sticky",
        name: "Note",
        data: {
          text: (args.text as string) ?? "New note",
          color: (args.color as "amber" | "rose" | "emerald" | "violet" | "cyan") ?? "amber",
        },
      });
    }
    case "add_browser": {
      const url = (args.url as string) ?? "https://example.com";
      return store.addNode({
        kind: "youtube",
        name: (args.name as string) ?? "Browser",
        data: { url, name: (args.name as string) ?? "Browser" },
      });
    }
    case "add_remotion": {
      return store.addNode({
        kind: "remotion",
        name: (args.name as string) ?? "Remotion",
        data: { name: "Remotion", crew: [], status: "idle" },
      });
    }
    case "connect_nodes": {
      const from = store.resolveNodeRef(args.from as string, createdIds);
      const to = store.resolveNodeRef(args.to as string, createdIds);
      if (from && to) store.connectNodes(from, to, "bus");
      return null;
    }
    case "disconnect_nodes": {
      const from = store.resolveNodeRef(args.from as string, createdIds);
      const to = store.resolveNodeRef(args.to as string, createdIds);
      if (from && to) store.disconnectNodes(from, to);
      return null;
    }
    case "rename_node": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      if (id) store.renameNode(id, args.name as string);
      return null;
    }
    case "move_node": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      if (id) store.moveNode(id, Number(args.x), Number(args.y));
      return null;
    }
    case "remove_node": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      if (id) store.removeNode(id);
      return null;
    }
    case "remove_nodes": {
      const ids = args.ids as string[] | undefined;
      const kind = args.kind as NodeKind | undefined;
      if (ids) ids.forEach((id) => store.removeNode(id));
      else if (kind) {
        get()
          .nodes.filter((n) => n.kind === kind)
          .forEach((n) => store.removeNode(n.id));
      }
      return null;
    }
    case "send_to_node": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      const text = args.text as string;
      if (id) {
        store.appendAgentMessage(id, { role: "user", text, authorName: "Commander" });
        store.setAgentStatus(id, "waiting", "Task received — queued.");
      }
      return null;
    }
    case "focus_node": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      if (id) store.setSelectedNode(id);
      return null;
    }
    case "add_task": {
      const description = (args.description as string) ?? "Untitled task";
      const afterIds = (args.after as number[]) ?? [];
      store.addTask(description, afterIds);
      return null;
    }
    case "set_chat_option": {
      const id = store.resolveNodeRef(args.id as string, createdIds);
      if (id) {
        const patch: Record<string, unknown> = {};
        if (args.model) patch.model = args.model;
        if (args.effort) patch.effort = args.effort;
        if (args.permission) patch.permission = args.permission;
        if (args.harness) {
          patch.harness = args.harness;
          // update model default when harness changes
          patch.model = defaultModelFor(args.harness as import("./types").AgentHarness);
        }
        store.updateNodeData(id, patch);
      }
      return null;
    }
    case "arrange_nodes":
    case "reload_screen":
    case "cancel_node":
    case "start_dev_server":
    case "stop_dev_server":
    case "go_home":
    case "open_settings":
    case "show_canvas":
    case "open_finder":
    case "find_files":
    case "import_sessions":
    case "expand_chat":
    case "set_auto_comm":
    case "set_chat_option":
    case "generate_variants":
      // UI-level actions, handled by components.
      return null;
    default:
      return null;
  }
}

// ---- activity log persistence (debounced batch POST) ----
// Maintains a pending buffer of entries and flushes to /api/logs every ~1.5s
// to avoid one HTTP request per activity event.
let pendingLogs: ActivityEntry[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleLogPersist(canvasId: string, entry: ActivityEntry) {
  pendingLogs.push(entry);
  if (logFlushTimer) clearTimeout(logFlushTimer);
  logFlushTimer = setTimeout(async () => {
    const batch = pendingLogs.slice();
    pendingLogs = [];
    logFlushTimer = null;
    if (batch.length === 0) return;
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasId,
          entries: batch.map((e) => ({
            kind: e.kind,
            text: e.text,
            nodeId: e.nodeId ?? "commander",
            meta: e.meta,
            ts: e.ts,
          })),
        }),
      });
    } catch {
      /* ignore — best-effort persistence */
    }
  }, 1500);
}
