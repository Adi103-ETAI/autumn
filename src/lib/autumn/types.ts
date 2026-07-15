// Autumn — core domain types
// Mirrors October Desktop's canvas data model (see 14-renderer-canvas.md §1).

export type NodeKind =
  | "chat" // AI coding agent (Claude Code, Codex, etc.)
  | "terminal"
  | "screen" // desktop | phone preview
  | "sticky" // note
  | "analytics"
  | "youtube" // embedded browser
  | "remotion"; // video editor

export type EdgeKind = "bus" | "navigation";

export type AgentHarness =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "cursor"
  | "grok"
  | "hermes"
  | "pi"
  | "cline";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "done"
  | "error"
  | "offline";

export type PermissionLevel = "ask" | "auto" | "yolo";

// A bus-edge traffic pulse (a message_peer packet flowing along the edge)
export interface BusPulse {
  id: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  text: string;
  kind: "message_peer" | "task" | "notify";
  ts: number;
}

// Per-kind node data. Stored as JSON in Prisma `data`.
export interface ChatNodeData {
  harness: AgentHarness;
  personaId: string; // atlas | apollo | orion | juno | ...
  model?: string;
  effort?: "low" | "medium" | "high";
  permission?: PermissionLevel;
  status: AgentStatus;
  doing?: string; // current task summary
  route?: string; // dev-server route
  worktreePath?: string;
  branch?: string;
  busyTaskId?: string | null;
  messages: AgentMessage[];
}

export interface TerminalNodeData {
  agent?: string;
  dir?: string;
  status: AgentStatus;
  port?: number;
  lines: TerminalLine[];
}

export interface ScreenNodeData {
  screenKind: "desktop" | "phone";
  name: string;
  route?: string;
  url?: string;
}

export interface StickyNodeData {
  text: string;
  color?: "amber" | "rose" | "emerald" | "violet" | "cyan";
}

export interface AnalyticsNodeData {
  title: string;
  metrics: { label: string; value: string; delta?: string }[];
}

export interface YoutubeNodeData {
  url: string;
  name: string;
}

export interface RemotionNodeData {
  name: string;
  crew: string[];
  status: AgentStatus;
}

export type NodeData =
  | ChatNodeData
  | TerminalNodeData
  | ScreenNodeData
  | StickyNodeData
  | AnalyticsNodeData
  | YoutubeNodeData
  | RemotionNodeData;

export interface AutumnNode {
  id: string;
  kind: NodeKind;
  name: string;
  data: NodeData;
  position: { x: number; y: number };
  createdAt: number;
}

export interface AutumnEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "peer" | "commander";
  text: string;
  authorName?: string;
  ts: number;
  streaming?: boolean;
}

export interface TerminalLine {
  text: string;
  kind?: "stdout" | "stderr" | "command" | "info";
  ts: number;
}

// Shared task board (Octoplan / "the board")
export interface AutumnTask {
  id: string; // task cuid
  seq: number; // t1, t2, ...
  canvasId: string;
  description: string;
  status: "open" | "blocked" | "in_progress" | "done";
  assigneeId?: string | null; // node id
  afterIds: number[]; // dependency seq numbers
  note?: string;
  createdAt: number;
  updatedAt: number;
}

// Commander output (parsed from LLM JSON)
export interface CommanderStep {
  action: string; // DO_ACTIONS verb, e.g. "add_chat"
  args: Record<string, unknown>;
}

export interface CommanderPlan {
  kind: "steps";
  steps: CommanderStep[];
  say: string;
  listen?: boolean;
}

export interface CommanderAsk {
  kind: "ask";
  ask: string;
  options?: string[];
}

export type CommanderResult = CommanderPlan | CommanderAsk;

// A canvas snapshot serialized for the Commander prompt
export interface CanvasSnapshotNode {
  id: string;
  kind: NodeKind;
  name: string;
  status?: string;
  harness?: string;
  doing?: string;
  route?: string;
}

export interface CanvasSnapshot {
  nodes: CanvasSnapshotNode[];
  connections: { from: string; to: string }[];
}
