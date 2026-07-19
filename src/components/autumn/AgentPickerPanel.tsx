// Autumn — Agent Picker Panel.
// Popover that opens above the bottom dock when the Agent app-tile is clicked.
// Mirrors October Desktop's agent + app picker layout:
//   - "CODING AGENTS" grid (4-col) of brand-logo tiles
//   - "APPS" grid (4-col) of integration-platform tiles (with EARLY ACCESS badges)
//   - Bottom bar: "Agents" (manage) | "Set up voice"
// Clicking an agent tile spawns a chat node with that agent's harness.
// Clicking an app tile opens the Apps Integration modal.

"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, ChevronRight } from "lucide-react";
import {
  useAutumnStore,
  CODING_AGENTS,
  THIRD_PARTY_APPS,
} from "@/lib/autumn/store";
import { getAgentBrand } from "./AgentLogos";
import type { AgentHarness } from "@/lib/autumn/types";
import { nextPersona } from "@/lib/autumn/personas";
import { defaultModelFor } from "@/lib/autumn/harness-meta";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";

// Per-app brand gradient + icon-bg for the APPS section tiles.
const APP_BRAND: Record<
  string,
  { tile: string; emoji: string }
> = {
  shopify: { tile: "from-emerald-500 to-green-600", emoji: "🛍️" },
  lovable: { tile: "from-rose-400 to-pink-600", emoji: "💖" },
  figma: { tile: "from-fuchsia-500 to-purple-600", emoji: "🎨" },
  shortcut: { tile: "from-green-400 to-emerald-600", emoji: "❌" },
  "post-bridge": { tile: "from-amber-400 to-orange-600", emoji: "⏰" },
  canvas: { tile: "from-sky-400 to-blue-600", emoji: "🖼️" },
};

export function AgentPickerPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addNode = useAutumnStore((s) => s.addNode);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const connectAgent = useAutumnStore((s) => s.connectAgent);
  const setShowAgentSetup = useAutumnStore((s) => s.setShowAgentSetup);
  const setAppsModalOpen = useAutumnStore(
    (s) => s.setAppsModalOpen,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer by a tick so the opening click doesn't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onEsc);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  const spawnAgent = (agentId: string, agentName: string) => {
    const harness = agentId as AgentHarness;
    const persona = nextPersona();
    const model = defaultModelFor(harness);
    const id = addNode({
      kind: "chat",
      name: agentName,
      data: {
        harness,
        personaId: persona.id,
        model,
        effort: "medium",
        permission: "ask",
        status: "idle",
        doing: `Ready — ${agentName}`,
        messages: [
          {
            id: `m-${nanoid(6)}`,
            role: "system",
            text: `${agentName} online · ${harness}/${model}`,
            ts: Date.now(),
          },
        ],
      },
    });
    setSelectedNode(id);
    setRightPanelTab("commander");
    connectAgent(agentId);
    onClose();
  };

  const openAppsModal = () => {
    setAppsModalOpen(true);
    onClose();
  };

  const openAgentSetup = () => {
    setShowAgentSetup(true);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="Agent and app picker"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[520px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-100px)] overflow-y-auto autumn-scroll rounded-2xl border border-white/10 bg-[#1c1f26]/95 backdrop-blur-2xl shadow-2xl shadow-black/50"
        >
          {/* ---- CODING AGENTS section ---- */}
          <div className="px-5 pt-4 pb-2">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Coding Agents
            </h3>
            <div className="grid grid-cols-4 gap-x-3 gap-y-4">
              {CODING_AGENTS.map((agent) => {
                const brand = getAgentBrand(agent.id);
                const Logo = brand.Logo;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => spawnAgent(agent.id, agent.name)}
                    className="group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-white/5"
                    title={agent.description}
                    aria-label={`Add ${agent.name} agent`}
                  >
                    <span
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl ring-1 ring-inset ring-white/10 transition-transform group-hover:scale-105 group-active:scale-95",
                        brand.bg,
                      )}
                    >
                      <Logo
                        className={cn(
                          "size-6",
                          brand.color,
                        )}
                      />
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-zinc-200 text-center">
                      {agent.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="mx-5 h-px bg-white/10" />

          {/* ---- APPS section ---- */}
          <div className="px-5 pt-3 pb-2">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Apps
            </h3>
            <div className="grid grid-cols-4 gap-x-3 gap-y-4">
              {THIRD_PARTY_APPS.map((app) => {
                const brand =
                  APP_BRAND[app.id] ?? {
                    tile: "from-zinc-600 to-zinc-800",
                    emoji: app.icon,
                  };
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={openAppsModal}
                    className="group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-white/5"
                    title={app.description}
                    aria-label={`Connect ${app.name}`}
                  >
                    <span
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl bg-gradient-to-br text-lg shadow-md ring-1 ring-inset ring-white/15 transition-transform group-hover:scale-105 group-active:scale-95",
                        brand.tile,
                      )}
                    >
                      <span aria-hidden>{brand.emoji}</span>
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-zinc-200 text-center">
                      {app.name}
                    </span>
                    {app.earlyAccess ? (
                      <span className="text-[8px] font-medium uppercase tracking-wide text-zinc-500">
                        Early Access
                      </span>
                    ) : (
                      <span className="text-[8px] font-medium uppercase tracking-wide text-transparent">
                        ·
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="mx-5 h-px bg-white/10" />

          {/* ---- Bottom bar: Agents | Set up voice ---- */}
          <div className="flex items-center justify-between px-5 py-3">
            <button
              type="button"
              onClick={openAgentSetup}
              className="flex items-center gap-1 text-xs font-medium text-zinc-300 transition-colors hover:text-white"
            >
              Agents
              <ChevronRight className="size-3 text-zinc-500" />
            </button>
            <button
              type="button"
              onClick={openAgentSetup}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 transition-colors hover:text-white"
            >
              <Mic className="size-3 text-zinc-500" />
              Set up voice
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
