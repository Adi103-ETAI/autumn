// autumn — the starter skill catalogue.
//
// Kept in its OWN dependency-free module (no React, no zustand, no sonner)
// because the Electron MAIN process reads it: the backend's skills handler
// mirrors these starters into its installed list. store.ts re-exports it for
// the renderer, so there is exactly ONE definition.

export interface StarterSkill {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

export const STARTER_SKILLS: StarterSkill[] = [
  {
    id: "website-cloner",
    name: "Website Cloner",
    description: "Pixel-perfect clone of any website into a real Next.js project (the /clone-website skill).",
    icon: "🌐",
    color: "text-sky-400",
  },
  {
    id: "gsd",
    name: "Get Shit Done (GSD)",
    description: "Set up GSD — a spec-driven workflow that plans a roadmap and ships phase by phase.",
    icon: "🚀",
    color: "text-amber-400",
  },
  {
    id: "screenshot-to-code",
    name: "Screenshot to Code",
    description: "Turn any screenshot into clean, responsive Tailwind + React components.",
    icon: "📸",
    color: "text-fuchsia-400",
  },
  {
    id: "api-designer",
    name: "API Designer",
    description: "Design, document, and scaffold REST/GraphQL APIs from a natural-language spec.",
    icon: "🔌",
    color: "text-emerald-400",
  },
];
