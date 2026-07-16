// Autumn — default model + harness metadata.
// Maps each harness to its default model name and a human label.

import type { AgentHarness } from "./types";

export const HARNESS_META: Record<
  AgentHarness,
  { label: string; defaultModel: string; models: string[]; color: string }
> = {
  "claude-code": {
    label: "Claude Code",
    defaultModel: "claude-sonnet-4",
    models: ["claude-sonnet-4", "claude-opus-4", "claude-haiku-4", "claude-sonnet-3.7"],
    color: "#f59e0b",
  },
  codex: {
    label: "Codex",
    defaultModel: "gpt-5-codex",
    models: ["gpt-5-codex", "gpt-4.1", "o4-mini"],
    color: "#10b981",
  },
  opencode: {
    label: "OpenCode",
    defaultModel: "openai/gpt-4.1",
    models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
    color: "#06b6d4",
  },
  gemini: {
    label: "Gemini CLI",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    color: "#8b5cf6",
  },
  cursor: {
    label: "Cursor Agent",
    defaultModel: "cursor-fast",
    models: ["cursor-fast", "gpt-4.1", "claude-sonnet-4"],
    color: "#ec4899",
  },
  grok: {
    label: "Grok CLI",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-3", "grok-2"],
    color: "#6366f1",
  },
  hermes: {
    label: "Hermes",
    defaultModel: "hermes-3",
    models: ["hermes-3", "hermes-2"],
    color: "#f43f5e",
  },
  pi: {
    label: "Pi",
    defaultModel: "pi-2",
    models: ["pi-2", "pi-1.5"],
    color: "#14b8a6",
  },
  cline: {
    label: "Cline",
    defaultModel: "anthropic/claude-sonnet-4",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4.1"],
    color: "#a855f7",
  },
};

export function defaultModelFor(harness: AgentHarness): string {
  return HARNESS_META[harness]?.defaultModel ?? "default";
}

export const HARNESS_LIST = Object.entries(HARNESS_META).map(
  ([id, meta]) => ({ id: id as AgentHarness, ...meta }),
);
