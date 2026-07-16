// Autumn — agent personas.
// Named agents are the heart of the October UX: Atlas, Apollo, Orion, Juno.
// Each persona has a color, a default harness, and a one-line character.
// The Commander picks the next persona in rotation when spawning a new chat node.

import type { AgentHarness } from "./types";

export interface Persona {
  id: string;
  name: string;
  color: string; // hex
  accent: string; // tailwind-ish class fragment, e.g. "emerald"
  glyph: string; // single char or emoji used as avatar
  harness: AgentHarness;
  tagline: string; // one-line character
  specialty: string; // what they're good at
}

// 7 named personas — the original October crew + 3 more for variety.
export const PERSONAS: Persona[] = [
  {
    id: "atlas",
    name: "Atlas",
    color: "#10b981", // emerald
    accent: "emerald",
    glyph: "A",
    harness: "claude-code",
    tagline: "Holds up the sky — full-stack architecture.",
    specialty: "Architecture, scaffolding, dev-server setup.",
  },
  {
    id: "apollo",
    name: "Apollo",
    color: "#f43f5e", // rose
    accent: "rose",
    glyph: "Ω",
    harness: "claude-code",
    tagline: "God of light — pixel-perfect UI.",
    specialty: "Frontend, design systems, polish.",
  },
  {
    id: "orion",
    name: "Orion",
    color: "#a855f7", // violet
    accent: "violet",
    glyph: "O",
    harness: "codex",
    tagline: "The hunter — backend & data layers.",
    specialty: "Backend, APIs, databases, schema.",
  },
  {
    id: "juno",
    name: "Juno",
    color: "#f59e0b", // amber
    accent: "amber",
    glyph: "J",
    harness: "claude-code",
    tagline: "Queen of gods — tests, CI, quality.",
    specialty: "Testing, e2e, CI/CD, type-safety.",
  },
  {
    id: "vega",
    name: "Vega",
    color: "#06b6d4", // cyan
    accent: "cyan",
    glyph: "V",
    harness: "gemini",
    tagline: "Falling star — research & docs.",
    specialty: "Research, docs, migrations.",
  },
  {
    id: "lyra",
    name: "Lyra",
    color: "#ec4899", // pink
    accent: "pink",
    glyph: "L",
    harness: "cursor",
    tagline: "Lyre of Orpheus — animations & motion.",
    specialty: "Motion, transitions, micro-interactions.",
  },
  {
    id: "nero",
    name: "Nero",
    color: "#6366f1", // indigo
    accent: "indigo",
    glyph: "N",
    harness: "grok",
    tagline: "Emperor of edge cases — security & infra.",
    specialty: "Security, infra, edge cases.",
  },
];

export const PERSONA_BY_ID: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p]),
);

let personaCursor = 0;
export function nextPersona(): Persona {
  const p = PERSONAS[personaCursor % PERSONAS.length];
  personaCursor += 1;
  return p;
}

export function personaByName(name: string): Persona | undefined {
  const lower = name.toLowerCase().trim();
  return PERSONAS.find(
    (p) => p.name.toLowerCase() === lower || p.id.toLowerCase() === lower,
  );
}

// STT-robustness: map mangled names back to canonical personas.
// Mirrors the Commander rule: "appollo"→Apollo, "her mez"→Hermes.
const NAME_ALIASES: Record<string, string> = {
  atlas: "atlas",
  apollo: "apollo",
  appollo: "apollo",
  apolo: "apollo",
  orion: "orion",
  oreon: "orion",
  juno: "juno",
  vega: "vega",
  lyra: "lyra",
  nero: "nero",
};

export function resolvePersonaName(raw: string): string | undefined {
  const lower = raw.toLowerCase().trim();
  if (NAME_ALIASES[lower]) return NAME_ALIASES[lower];
  // try first token
  const first = lower.split(/\s+/)[0];
  return NAME_ALIASES[first];
}

// STT-robustness: harness aliases.
const HARNESS_ALIASES: Record<string, AgentHarness> = {
  "claude code": "claude-code",
  "clod code": "claude-code",
  cloud: "claude-code",
  clock: "claude-code",
  claude: "claude-code",
  codex: "codex",
  "co dex": "codex",
  opencode: "opencode",
  "open code": "opencode",
  gemini: "gemini",
  cursor: "cursor",
  grok: "grok",
  hermes: "hermes",
  "her mez": "hermes",
  pi: "pi",
  cline: "cline",
};

export function resolveHarness(raw: string): AgentHarness | undefined {
  const lower = raw.toLowerCase().trim();
  return HARNESS_ALIASES[lower];
}
