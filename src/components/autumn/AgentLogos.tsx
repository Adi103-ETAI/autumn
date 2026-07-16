// Autumn — Official-style brand logos for coding agents.
// Each logo is an inline SVG component that accepts a className for sizing.
// Logos use their brand's signature color via `currentColor` where the
// container sets the text color, OR hardcoded brand fills for multi-color marks.
//
// Sources: recreated from official brand guidelines. Monochrome-friendly.

import type { SVGProps } from "react";

type LogoProps = SVGProps<SVGSVGElement> & { className?: string };

// ---- Claude Code (Anthropic) ------------------------------------------------
// Official Claude Code mark: a pixel-style robot face. Terracotta (#D97757).
export function ClaudeCodeLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
    </svg>
  );
}

// ---- GitHub Copilot ---------------------------------------------------------
// The Copilot emblem: two overlapping rounded shapes (goggles/face).
export function CopilotLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.75 5.5a3.5 3.5 0 0 0-3.5 3.5v.5a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 2.5 2.5 0 0 0 2.5 2.5h6A2.5 2.5 0 0 0 17.25 16.5a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3V9a3.5 3.5 0 0 0-3.5-3.5h-1zm-2 6a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2v.5a2 2 0 0 1-2 2h-4.5a2 2 0 0 1-2-2z"
      />
    </svg>
  );
}

// ---- GitHub (Octocat mark for GitHub CLI) -----------------------------------
export function GitHubLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.24-3.15-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.2a11.6 11.6 0 0 1 6 0c2.29-1.52 3.3-1.2 3.3-1.2.66 1.64.24 2.86.12 3.16.77.82 1.24 1.87 1.24 3.15 0 4.51-2.81 5.51-5.49 5.8.43.36.81 1.08.81 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.21.68.83.56A12.04 12.04 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

// ---- Codex (OpenAI) ---------------------------------------------------------
// The OpenAI hexagonal flower / spiral. Multi-petal symmetric.
export function OpenAILogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M22.28 10.05a5.7 5.7 0 0 0-.5-4.72 5.82 5.82 0 0 0-6.28-2.76A5.78 5.78 0 0 0 4.7 4.66a5.7 5.7 0 0 0-3.82 2.76 5.82 5.82 0 0 0 .72 6.84 5.7 5.7 0 0 0 .5 4.72 5.82 5.82 0 0 0 6.28 2.76 5.78 5.78 0 0 0 10.8-2.08 5.7 5.7 0 0 0 3.82-2.76 5.82 5.82 0 0 0-.72-6.85zm-9.02 12.6a4.3 4.3 0 0 1-2.76-1l.14-.08 4.58-2.64a.74.74 0 0 0 .38-.66v-6.46l1.94 1.12c.02.01.03.03.04.05v5.34a4.34 4.34 0 0 1-4.32 4.33zM4.3 17.44a4.3 4.3 0 0 1-.52-2.9l.14.09 4.58 2.64a.74.74 0 0 0 .76 0l5.59-3.22v2.24c0 .02 0 .04-.02.06l-4.63 2.67a4.34 4.34 0 0 1-5.9-1.58zM3.1 7.62a4.3 4.3 0 0 1 2.28-1.9v5.44a.74.74 0 0 0 .38.65l5.56 3.21-1.94 1.12a.07.07 0 0 1-.06 0L4.66 13.5a4.34 4.34 0 0 1-1.56-5.88zm15.86 3.66L13.38 8.06l1.93-1.12a.07.07 0 0 1 .07 0l4.63 2.67a4.34 4.34 0 0 1-.66 7.83v-5.44a.74.74 0 0 0-.39-.66zm1.93-2.9l-.14-.09-4.57-2.65a.74.74 0 0 0-.76 0L9.8 8.86V6.62c0-.02 0-.04.02-.06l4.63-2.67a4.34 4.34 0 0 1 6.44 4.49zM8.76 13.06l-1.93-1.12a.07.07 0 0 1-.04-.05V6.55a4.34 4.34 0 0 1 7.12-3.33l-.14.08L9.2 5.94a.74.74 0 0 0-.38.66zm1.05-2.27L12 9.56l2.2 1.27v2.54L12 14.64l-2.2-1.27z" />
    </svg>
  );
}

// ---- Cursor -----------------------------------------------------------------
// Official Cursor mark: a faceted cube/diamond shape with an inset V.
export function CursorLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  );
}

// ---- Grok (xAI) -------------------------------------------------------------
// The xAI / Grok mark: a stylized X.
export function GrokLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M18.9 2H21l-6.55 7.49L22 22h-6.8l-4.77-6.24L4.8 22H2.7l7.02-8.03L2 2h6.96l4.3 5.69L18.9 2zm-1.19 18h1.65L7.4 3.7H5.64L17.71 20z" />
    </svg>
  );
}

// ---- Gemini (Google) --------------------------------------------------------
// The Gemini 4-point sparkle / star.
export function GeminiLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M12 0c.66 0 1.21.5 1.27 1.15.46 4.6 2.98 7.12 7.58 7.58a1.28 1.28 0 0 1 0 2.54c-4.6.46-7.12 2.98-7.58 7.58a1.28 1.28 0 0 1-2.54 0c-.46-4.6-2.98-7.12-7.58-7.58a1.28 1.28 0 0 1 0-2.54c4.6-.46 7.12-2.98 7.58-7.58C10.79.5 11.34 0 12 0z" />
    </svg>
  );
}

// ---- opencode ---------------------------------------------------------------
// Open-source terminal coding agent: code brackets with a dot.
export function OpenCodeLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <polyline points="8 6 2 12 8 18" />
      <polyline points="16 6 22 12 16 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  );
}

// ---- Cline ------------------------------------------------------------------
// Open-source coding agent: a terminal cursor line.
export function ClineLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <polyline points="4 7 8 12 4 17" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// ---- Hermes (Nous Research) -------------------------------------------------
// Stylized "H" with wings.
export function HermesLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M5 3h2.5v7.5h9V3H19v18h-2.5v-8h-9v8H5V3z" />
    </svg>
  );
}

// ---- Pi (Inflection) --------------------------------------------------------
// The π symbol.
export function PiLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M3 6h18v2.5h-2.2v7.8c0 .9.4 1.2 1.2 1.2.4 0 .8-.1 1-.2v2c-.4.2-1 .3-1.8.3-2 0-2.9-1-2.9-3v-8.1H13v9.5h-2.5v-9.5H7.4c0 2.5-.2 4.5-.7 6-.4 1.3-1 2.3-1.9 3l-1.6-1.7c.7-.6 1.2-1.3 1.5-2.2.3-.9.4-2.3.4-4.1V8.5H3V6z" />
    </svg>
  );
}

// ---- Registry: agent id → logo component + brand color ----------------------

export interface AgentBrand {
  Logo: (props: LogoProps) => JSX.Element;
  /** Background tint for the circular container. */
  bg: string;
  /** Text/icon color (the logo uses currentColor). */
  color: string;
}

export const AGENT_BRANDS: Record<string, AgentBrand> = {
  "github-cli": {
    Logo: GitHubLogo,
    bg: "bg-zinc-800",
    color: "text-white",
  },
  "claude-code": {
    Logo: ClaudeCodeLogo,
    bg: "bg-[#D97757]/15",
    color: "text-[#D97757]",
  },
  "codex": {
    Logo: OpenAILogo,
    bg: "bg-zinc-800",
    color: "text-white",
  },
  "copilot": {
    Logo: CopilotLogo,
    bg: "bg-zinc-800",
    color: "text-white",
  },
  "cursor": {
    Logo: CursorLogo,
    bg: "bg-zinc-800",
    color: "text-white",
  },
  "grok": {
    Logo: GrokLogo,
    bg: "bg-zinc-900",
    color: "text-white",
  },
  "opencode": {
    Logo: OpenCodeLogo,
    bg: "bg-amber-500/15",
    color: "text-amber-400",
  },
  "hermes": {
    Logo: HermesLogo,
    bg: "bg-rose-500/15",
    color: "text-rose-400",
  },
  "cline": {
    Logo: ClineLogo,
    bg: "bg-teal-500/15",
    color: "text-teal-400",
  },
  "pi": {
    Logo: PiLogo,
    bg: "bg-fuchsia-500/15",
    color: "text-fuchsia-400",
  },
  "gemini": {
    Logo: GeminiLogo,
    bg: "bg-sky-500/15",
    color: "text-sky-400",
  },
};

export function getAgentBrand(id: string): AgentBrand {
  return (
    AGENT_BRANDS[id] ?? {
      Logo: ({ className, ...p }: LogoProps) => (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={className}
          aria-hidden
          {...p}
        >
          <circle cx="12" cy="12" r="6" />
        </svg>
      ),
      bg: "bg-zinc-800",
      color: "text-zinc-300",
    }
  );
}
