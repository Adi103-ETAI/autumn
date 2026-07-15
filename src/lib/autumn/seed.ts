// Autumn — seed canvas. Loaded on first visit so the user sees a working workshop
// instead of an empty canvas. Mirrors the October onboarding experience.

import type { AutumnNode, AutumnEdge, AutumnTask } from "./types";
import { PERSONA_BY_ID } from "./personas";

const now = Date.now();

export function buildSeedCanvas(): {
  nodes: AutumnNode[];
  edges: AutumnEdge[];
  tasks: AutumnTask[];
} {
  const atlas = PERSONA_BY_ID["atlas"];
  const apollo = PERSONA_BY_ID["apollo"];
  const orion = PERSONA_BY_ID["orion"];

  const n1: AutumnNode = {
    id: "node-atlas",
    kind: "chat",
    name: "Atlas",
    position: { x: 80, y: 120 },
    createdAt: now,
    data: {
      harness: "claude-code",
      personaId: "atlas",
      model: "claude-sonnet-4",
      effort: "high",
      permission: "auto",
      status: "idle",
      doing: "Ready to scaffold.",
      worktreePath: "~/autumn/worktrees/atlas",
      branch: "atlas/main",
      messages: [
        {
          id: "m1",
          role: "system",
          text: `${atlas.name} online · ${atlas.harness} · ${atlas.tagline}`,
          ts: now,
        },
      ],
    },
  };

  const n2: AutumnNode = {
    id: "node-apollo",
    kind: "chat",
    name: "Apollo",
    position: { x: 480, y: 80 },
    createdAt: now,
    data: {
      harness: "claude-code",
      personaId: "apollo",
      model: "claude-sonnet-4",
      effort: "medium",
      permission: "ask",
      status: "idle",
      doing: "Pixel-polishing standby.",
      worktreePath: "~/autumn/worktrees/apollo",
      branch: "apollo/ui",
      messages: [
        {
          id: "m2",
          role: "system",
          text: `${apollo.name} online · ${apollo.harness} · ${apollo.tagline}`,
          ts: now,
        },
      ],
    },
  };

  const n3: AutumnNode = {
    id: "node-orion",
    kind: "chat",
    name: "Orion",
    position: { x: 480, y: 320 },
    createdAt: now,
    data: {
      harness: "codex",
      personaId: "orion",
      model: "gpt-5-codex",
      effort: "high",
      permission: "auto",
      status: "idle",
      doing: "Backend hunter, standing by.",
      worktreePath: "~/autumn/worktrees/orion",
      branch: "orion/backend",
      messages: [
        {
          id: "m3",
          role: "system",
          text: `${orion.name} online · ${orion.harness} · ${orion.tagline}`,
          ts: now,
        },
      ],
    },
  };

  const screen: AutumnNode = {
    id: "node-screen",
    kind: "screen",
    name: "Preview · desktop",
    position: { x: 880, y: 180 },
    createdAt: now,
    data: {
      screenKind: "desktop",
      name: "Preview",
      route: "/",
      url: "/preview",
    },
  };

  const sticky: AutumnNode = {
    id: "node-sticky",
    kind: "sticky",
    name: "Note",
    position: { x: 80, y: 380 },
    createdAt: now,
    data: {
      text: "Try: \"spawn Atlas and Orion, connect them, and have Atlas build UI while Orion does backend for a medical app.\"",
      color: "amber",
    },
  };

  const edges: AutumnEdge[] = [
    {
      id: "edge-atlas-apollo",
      kind: "bus",
      source: "node-atlas",
      target: "node-apollo",
      label: "bus",
      animated: true,
    },
    {
      id: "edge-atlas-orion",
      kind: "bus",
      source: "node-atlas",
      target: "node-orion",
      label: "bus",
      animated: true,
    },
    {
      id: "edge-apollo-screen",
      kind: "navigation",
      source: "node-apollo",
      target: "node-screen",
      label: "nav",
    },
  ];

  const tasks: AutumnTask[] = [
    {
      id: "task-1",
      seq: 1,
      canvasId: "default",
      description: "Scaffold Next.js 16 + TypeScript project structure",
      status: "done",
      assigneeId: "node-atlas",
      afterIds: [],
      note: "Initialized in /worktrees/atlas",
      createdAt: now - 60000,
      updatedAt: now - 30000,
    },
    {
      id: "task-2",
      seq: 2,
      canvasId: "default",
      description: "Design medical app dashboard UI components",
      status: "in_progress",
      assigneeId: "node-apollo",
      afterIds: [1],
      createdAt: now - 30000,
      updatedAt: now - 5000,
    },
    {
      id: "task-3",
      seq: 3,
      canvasId: "default",
      description: "Build patient records API + Prisma schema",
      status: "open",
      assigneeId: null,
      afterIds: [1],
      createdAt: now - 10000,
      updatedAt: now - 10000,
    },
  ];

  return { nodes: [n1, n2, n3, screen, sticky], edges, tasks };
}
