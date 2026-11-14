// Autumn — agent personas.
// Named agents are the heart of the Autumn UX: Atlas, Apollo, Orion, Juno.
// Each persona has a color, a leaf icon, and a one-line character.
// Harness is NOT pre-defined — agents can run any harness (claude/codex/gemini/etc.)
// on demand via the terminal. The Commander picks harness at spawn time.

import type { AgentHarness } from "./types";

export interface Persona {
  id: string;
  name: string;
  color: string; // hex
  accent: string; // tailwind-ish class fragment, e.g. "emerald"
  glyph: string; // single char fallback
  icon: string; // leaf logo path e.g. /autumn-agents/atlas.png
  tagline: string; // one-line character
  specialty: string; // what they're good at
  /** The harness the persona prefers — the Commander may still pick another. */
  harness?: AgentHarness;
}

// 4 core personas — leaf icons in public/autumn-agents/*.png — add more later.
export const PERSONAS: Persona[] = [
  {
    id: "atlas",
    name: "Atlas",
    color: "#10b981", // emerald
    accent: "emerald",
    glyph: "A",
    icon: "/autumn-agents/atlas.png",
    tagline: "Holds up the sky — full-stack architecture.",
    specialty: "Architecture, scaffolding, dev-server setup.",
  },
  {
    id: "apollo",
    name: "Apollo",
    color: "#f43f5e", // rose
    accent: "rose",
    glyph: "Ω",
    icon: "/autumn-agents/apollo.png",
    tagline: "God of light — pixel-perfect UI.",
    specialty: "Frontend, design systems, polish.",
  },
  {
    id: "orion",
    name: "Orion",
    color: "#a855f7", // violet
    accent: "violet",
    glyph: "O",
    icon: "/autumn-agents/orion.png",
    tagline: "The hunter — backend & data layers.",
    specialty: "Backend, APIs, databases, schema.",
  },
  {
    id: "juno",
    name: "Juno",
    color: "#f59e0b", // amber
    accent: "amber",
    glyph: "J",
    icon: "/autumn-agents/juno.png",
    tagline: "Queen of gods — tests, CI, quality.",
    specialty: "Testing, e2e, CI/CD, type-safety.",
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

export function nextUnusedPersona(usedIds: Set<string> | string[]): Persona {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const unused = PERSONAS.find((p) => !used.has(p.id));
  if (unused) {
    // advance cursor to after the picked one for variety
    personaCursor = PERSONAS.indexOf(unused) + 1;
    return unused;
  }
  // all 4 used -> fallback to cycle (will duplicate, but we prefer distinct)
  return nextPersona();
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
