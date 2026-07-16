// Autumn — Agent Connection Modal.
// Full-screen overlay shown after onboarding. Lets the user connect coding agents.
// Clones October Desktop's "Set up October" agent picker: a vertical centered
// list of agent rows (logo + name + description + Sign in), with a
// collapse/expand toggle ("See N more agents" ↔ "See fewer agents").
// Amber/orange Autumn theme preserved.

"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import { getAgentBrand } from "@/components/autumn/AgentLogos";
import {
  CODING_AGENTS,
  useAutumnStore,
  type AgentConnectionStatus,
} from "@/lib/autumn/store";

// Number of agents shown in the collapsed state (matches October reference).
const COLLAPSED_COUNT = 3;

export function AgentConnectionModal() {
  const show = useAutumnStore((s) => s.showAgentSetup);
  const connectedAgents = useAutumnStore((s) => s.connectedAgents);
  const setShowAgentSetup = useAutumnStore((s) => s.setShowAgentSetup);
  const connectAgent = useAutumnStore((s) => s.connectAgent);
  const disconnectAgent = useAutumnStore((s) => s.disconnectAgent);
  const setAppStage = useAutumnStore((s) => s.setAppStage);

  const [expanded, setExpanded] = useState(false);

  const connectedCount = Object.values(connectedAgents).filter(
    (s) => s === "connected",
  ).length;
  const hasConnected = connectedCount > 0;

  const handleContinue = () => {
    setShowAgentSetup(false);
    setAppStage("workspace");
  };

  const handleClose = () => {
    setShowAgentSetup(false);
  };

  // Agents to render: collapsed shows first N, expanded shows all.
  const visibleAgents = expanded
    ? CODING_AGENTS
    : CODING_AGENTS.slice(0, COLLAPSED_COUNT);
  const hiddenCount = CODING_AGENTS.length - COLLAPSED_COUNT;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80" />

          {/* Card — tall, centered, narrow (matches October's vertical list) */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Set up Autumn"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl bg-[#0a0d12] border border-white/10 shadow-2xl shadow-black/60 overflow-hidden"
          >
            {/* Header — centered title, close button top-right */}
            <header className="relative flex flex-col items-center text-center pt-7 pb-5 px-6">
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
              <AutumnLogo size={28} />
              <h2 className="mt-3 text-xl font-semibold text-foreground tracking-tight">
                Set up Autumn
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect your agents and tools to get started.
              </p>
            </header>

            {/* Body — vertical list of agent rows */}
            <div className="flex-1 overflow-y-auto px-3 pb-2 min-h-0 autumn-scroll">
              <AnimatePresence initial={false}>
                {visibleAgents.map((agent, i) => {
                  const status: AgentConnectionStatus =
                    connectedAgents[agent.id] ?? "not_yet";
                  return (
                    <motion.div
                      key={agent.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ delay: expanded ? 0 : 0.04 * i, duration: 0.2 }}
                    >
                      <AgentRow
                        id={agent.id}
                        name={agent.name}
                        description={agent.description}
                        status={status}
                        onSignIn={() => connectAgent(agent.id)}
                        onDisconnect={() => disconnectAgent(agent.id)}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Expand / collapse toggle */}
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expanded ? (
                    <>
                      See fewer agents
                      <ChevronUp className="size-3.5" />
                    </>
                  ) : (
                    <>
                      See {hiddenCount} more agents
                      <ChevronDown className="size-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Footer — note + Continue button */}
            <footer className="flex flex-col items-center gap-3 px-6 pt-4 pb-6 border-t border-white/5 bg-black/40">
              {hasConnected ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <Check className="size-3.5" />
                  <span>
                    {connectedCount} of {CODING_AGENTS.length} agents connected.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center">
                  Connect at least one coding agent to continue.
                </p>
              )}
              <Button
                size="lg"
                disabled={!hasConnected}
                onClick={handleContinue}
                className={cn(
                  "w-full gap-2 px-6 border-0",
                  hasConnected
                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                    : "bg-white/5 text-white/30",
                )}
              >
                Continue to workspace
                <ArrowRight className="size-4" />
              </Button>
              <p className="text-[11px] text-muted-foreground/60 text-center max-w-xs">
                Signing in to an Autumn account isn&apos;t required —
                that&apos;s separate.
              </p>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- Agent row (logo + name/desc + sign-in) --------------------------------

function AgentRow({
  id,
  name,
  description,
  status,
  onSignIn,
  onDisconnect,
}: {
  id: string;
  name: string;
  description: string;
  status: AgentConnectionStatus;
  onSignIn: () => void;
  onDisconnect: () => void;
}) {
  const brand = getAgentBrand(id);
  const { Logo } = brand;

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03] transition-colors group">
      {/* Circular logo */}
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          brand.bg,
        )}
        aria-hidden
      >
        <Logo className={cn("size-5", brand.color)} />
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {name}
        </div>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>

      {/* Status button */}
      <StatusButton
        status={status}
        onSignIn={onSignIn}
        onDisconnect={onDisconnect}
      />
    </div>
  );
}

// ---- Status button ----------------------------------------------------------

function StatusButton({
  status,
  onSignIn,
  onDisconnect,
}: {
  status: AgentConnectionStatus;
  onSignIn: () => void;
  onDisconnect: () => void;
}) {
  if (status === "waiting") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 cursor-wait shrink-0"
      >
        <Loader2 className="size-3.5 animate-spin" />
        Waiting...
      </button>
    );
  }

  if (status === "connected") {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors shrink-0"
        aria-label={`Disconnect (currently connected)`}
        title="Click to disconnect"
      >
        <Check className="size-3.5" />
        Connected
      </button>
    );
  }

  // not_yet — "Sign in" with amber accent
  return (
    <button
      type="button"
      onClick={onSignIn}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/15 hover:text-amber-200 hover:border-amber-500/60 transition-colors shrink-0"
    >
      Sign in
      <ArrowRight className="size-3" />
    </button>
  );
}
