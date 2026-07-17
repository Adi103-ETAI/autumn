// Autumn — Official brand logos for coding agents.
//
// Logos come from two sources:
//   1. Inline SVG components (monochrome, use `currentColor`) — for agents
//      whose official mark is a single-color shape (Claude Code, Cursor,
//      GitHub CLI, Cline, Grok).
//   2. Static image files in /public/agents — for agents whose official mark
//      is multi-color or raster (Codex, Hermes, opencode, Gemini, Pi).
//
// The AGENT_BRANDS registry maps an agent id to { Logo, bg, color } where:
//   - Logo: a React component rendering the mark
//   - bg: Tailwind classes for the circular container background
//   - color: Tailwind text color class (used by inline-SVG logos via currentColor)

import type { SVGProps } from "react";

type LogoProps = SVGProps<SVGSVGElement> & { className?: string };

// ---- Inline SVG logos (monochrome, currentColor) ---------------------------

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

// ---- Cline ------------------------------------------------------------------
// Official Cline mark: a rounded-square robot head with two eye-holes + antenna.
export function ClineLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M17.035 3.991c2.75 0 4.98 2.24 4.98 5.003v1.667l1.45 2.896a1.01 1.01 0 01-.002.909l-1.448 2.864v1.668c0 2.762-2.23 5.002-4.98 5.002H7.074c-2.751 0-4.98-2.24-4.98-5.002V17.33l-1.48-2.855a1.01 1.01 0 01-.003-.927l1.482-2.887V8.994c0-2.763 2.23-5.003 4.98-5.003h9.962zM8.265 9.6a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 004.547 0v-4.042A2.274 2.274 0 008.265 9.6zm7.326 0a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 104.548 0v-4.042A2.274 2.274 0 0015.59 9.6z" />
      <path d="M12.054 5.558a2.779 2.779 0 100-5.558 2.779 2.779 0 000 5.558z" />
    </svg>
  );
}

// ---- Grok (xAI) -------------------------------------------------------------
// Official Grok mark: a stylized swoosh/slash.
export function GrokLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

// ---- Static-image logos (full-color, served from /public/agents) ------------
// These render an <img> pointing at the static file. The container circle
// uses a transparent/neutral background so the brand colors show through.

function StaticLogo({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden
      className={className}
      draggable={false}
    />
  );
}

// ---- Registry: agent id → logo + brand styling ------------------------------

export interface AgentBrand {
  Logo: (props: LogoProps | { className?: string }) => React.ReactElement;
  /** Background tint for the circular container. */
  bg: string;
  /** Text/icon color (inline-SVG logos use currentColor). */
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
    Logo: (props) => (
      <StaticLogo src="/agents/codex.webp" alt="Codex" {...props} />
    ),
    bg: "bg-transparent",
    color: "",
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
    Logo: (props) => (
      <StaticLogo src="/agents/opencode.webp" alt="opencode" {...props} />
    ),
    bg: "bg-transparent",
    color: "",
  },
  "cline": {
    Logo: ClineLogo,
    bg: "bg-teal-500/15",
    color: "text-teal-400",
  },
  "gemini": {
    Logo: (props) => (
      <StaticLogo src="/agents/gemini.svg" alt="Gemini" {...props} />
    ),
    bg: "bg-transparent",
    color: "",
  },
  "hermes": {
    Logo: (props) => (
      <StaticLogo src="/agents/hermesagent.webp" alt="Hermes" {...props} />
    ),
    bg: "bg-transparent",
    color: "",
  },
  "pi": {
    // pi.svg is white-on-transparent — needs a dark circle to be visible.
    Logo: (props) => (
      <StaticLogo src="/agents/pi.svg" alt="Pi" {...props} />
    ),
    bg: "bg-zinc-800",
    color: "",
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
