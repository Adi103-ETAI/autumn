// Autumn — Zustand store (client).
// Holds canvas state, task board, pulses, commander chat history, recent actions.
// Mirrors October's `useAppStore` (see 09-renderer-deep-dive.md) but trimmed to
// the parts we actually need for the web demo.

"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  AgentMessage,
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
    | "canvas_cleared";
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
  pulses: BusPulse[];
  tasks: AutumnTask[];
  taskSeq: number;

  // commander chat
  commanderMessages: CommanderChatMessage[];
  recentActions: string[];
  isCommanderThinking: boolean;
  isAgentRunning: Record<string, boolean>; // nodeId -> running

  // ui
  rightPanelTab: "commander" | "tasks" | "bus";
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
  pendingCommand: string | null; // when set, CommanderPanel will auto-send this command
  connectMode: { from: string | null } | null; // when active, next clicked chat node becomes the target
  activityLog: ActivityEntry[]; // global append-only activity timeline

  // ---- actions ----
  setCanvasName: (name: string) => void;
  setSelectedNode: (id: string | null) => void;
  setRightPanelTab: (t: "commander" | "tasks" | "bus") => void;
  setListening: (v: boolean) => void;
  setShowHelp: (v: boolean) => void;
  setSettingsNode: (id: string | null) => void;
  setShowCanvasSwitcher: (v: boolean) => void;
  setShowCommandPalette: (v: boolean) => void;
  setShowExportDialog: (v: boolean) => void;
  setShowActivityLog: (v: boolean) => void;
  setPendingCommand: (cmd: string | null) => void;
  setConnectMode: (m: { from: string | null } | null) => void;
  pushActivity: (e: Omit<ActivityEntry, "id" | "ts">) => void;
  clearActivity: () => void;
  pushCommandHistory: (cmd: string) => void;
  arrangeNodes: () => void;
  clearCanvas: () => void;
  saveCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  duplicateCanvas: (id: string) => Promise<void>;
  exportCanvas: () => string; // returns JSON string
  importCanvas: (json: string) => boolean; // returns success

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

  pushCommanderMessage: (m: Omit<CommanderChatMessage, "id" | "ts">) => string;
  updateCommanderMessage: (id: string, patch: Partial<CommanderChatMessage>) => void;
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
  setPendingCommand: (cmd) => set({ pendingCommand: cmd }),
  setConnectMode: (m) => set({ connectMode: m }),

  pushActivity: (e) =>
    set((s) => ({
      activityLog: [
        ...s.activityLog,
        { ...e, id: `act-${nanoid(8)}`, ts: Date.now() },
      ].slice(-200),
    })),
  clearActivity: () => set({ activityLog: [] }),

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
    set({ nodes: [], edges: [], tasks: [], taskSeq: 0, pulses: [], selectedNodeId: null });
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
        selectedNodeId: null,
        isSaving: false,
        lastSavedAt: Date.now(),
      });
      get().pushActivity({
        kind: "canvas_loaded",
        text: `Loaded "${j.name ?? "Untitled Canvas"}" from the database.`,
      });
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
    set((s) => ({ pulses: [...s.pulses, pulse].slice(-50) }));
    // auto-clear after 3.5s
    setTimeout(() => {
      set((s) => ({ pulses: s.pulses.filter((x) => x.id !== pulse.id) }));
    }, 3500);
  },

  clearPulses: () => set({ pulses: [] }),

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
