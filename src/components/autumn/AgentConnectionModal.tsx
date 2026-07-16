// Autumn — Agent Connection Modal.
// Full-screen overlay shown after onboarding. Lets the user connect coding agents.
// Clones October Desktop's "Set up October" agent picker (NOTES.md §2, images 09–11).

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, LogIn, ArrowRight, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import {
  CODING_AGENTS,
  useAutumnStore,
  type AgentConnectionStatus,
} from "@/lib/autumn/store";

// Vendor-ish brand colors for the agent icon squares.
// Keyed by agent id. NO pure blue — Gemini uses sky-500 (only allowed blue exception).
const AGENT_ICON_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-500/20 text-orange-300",
  codex: "bg-emerald-500/20 text-emerald-300",
  cursor: "bg-amber-500/20 text-amber-300",
  grok: "bg-zinc-500/20 text-zinc-300",
  opencode: "bg-amber-500/20 text-amber-300",
  hermes: "bg-rose-500/20 text-rose-300",
  cline: "bg-teal-500/20 text-teal-300",
  pi: "bg-fuchsia-500/20 text-fuchsia-300",
  gemini: "bg-sky-500/20 text-sky-300",
};

function agentInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function AgentConnectionModal() {
  const show = useAutumnStore((s) => s.showAgentSetup);
  const connectedAgents = useAutumnStore((s) => s.connectedAgents);
  const setShowAgentSetup = useAutumnStore((s) => s.setShowAgentSetup);
  const connectAgent = useAutumnStore((s) => s.connectAgent);
  const disconnectAgent = useAutumnStore((s) => s.disconnectAgent);
  const setAppStage = useAutumnStore((s) => s.setAppStage);

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
          {/* Backdrop: pure black (pointer-events-none so clicks reach the card) */}
          <div className="absolute inset-0 pointer-events-none bg-black/80" />

          {/* Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Set up Autumn"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-[#1a202c] border border-white/5 shadow-2xl shadow-black/40 overflow-hidden"
          >
            {/* Header */}
            <header className="flex items-start gap-3 p-6 pb-4 border-b border-border/50">
              <AutumnLogo size={32} glow />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-foreground">
                    Set up Autumn
                  </h2>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-medium",
                      hasConnected
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-border/60 text-muted-foreground",
                    )}
                  >
                    {connectedCount}/{CODING_AGENTS.length} connected
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Connect your agents and tools to get started.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground shrink-0"
                onClick={handleClose}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 min-h-0 autumn-scroll">
              {/* Success banner */}
              <AnimatePresence>
                {hasConnected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      <span className="text-sm font-medium text-emerald-300">
                        You&apos;re set — continue to your workspace.
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Agent grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CODING_AGENTS.map((agent, i) => {
                  const status: AgentConnectionStatus =
                    connectedAgents[agent.id] ?? "not_yet";
                  return (
                    <motion.div
                      key={agent.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 + i * 0.03, duration: 0.25 }}
                    >
                      <AgentCard
                        id={agent.id}
                        name={agent.name}
                        vendor={agent.vendor}
                        description={agent.description}
                        status={status}
                        onSignIn={() => connectAgent(agent.id)}
                        onDisconnect={() => disconnectAgent(agent.id)}
                      />
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <footer className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 p-6 pt-4 border-t border-border/50 bg-card/60">
              <div className="space-y-1 max-w-sm">
                <p className="text-xs text-muted-foreground">
                  Connect at least one coding agent to continue.
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  Signing in to an Autumn account isn&apos;t required —
                  that&apos;s separate.
                </p>
              </div>
              <Button
                size="lg"
                disabled={!hasConnected}
                onClick={handleContinue}
                className={cn(
                  "gap-2 px-6 shrink-0",
                  hasConnected
                    ? "bg-amber-500 hover:bg-amber-600 text-white border-0"
                    : "bg-white/5 text-white/30 border-0",
                )}
              >
                <Leaf className="size-4" />
                Continue to workspace
                <ArrowRight className="size-4" />
              </Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AgentCard({
  id,
  name,
  vendor,
  description,
  status,
  onSignIn,
  onDisconnect,
}: {
  id: string;
  name: string;
  vendor: string;
  description: string;
  status: AgentConnectionStatus;
  onSignIn: () => void;
  onDisconnect: () => void;
}) {
  const iconColor = AGENT_ICON_COLORS[id] ?? "bg-zinc-500/20 text-zinc-300";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 hover:border-border/70 transition-colors p-3 h-full">
      {/* Agent icon: colored square with initial */}
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-bold",
          iconColor,
        )}
        aria-hidden
      >
        {agentInitial(name)}
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-foreground truncate">
            {name}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {vendor}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {description}
        </p>
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
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-1.5 border-amber-500/40 text-amber-300 bg-amber-500/10 shrink-0 cursor-wait"
      >
        <Loader2 className="size-3.5 animate-spin" />
        Waiting...
      </Button>
    );
  }

  if (status === "connected") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors shrink-0"
            aria-label="Disconnect"
          >
            <Check className="size-3.5" />
            Connected
          </button>
        </TooltipTrigger>
        <TooltipContent>Disconnect</TooltipContent>
      </Tooltip>
    );
  }

  // not_yet
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSignIn}
      className="gap-1.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/15 hover:text-amber-200 shrink-0"
    >
      <LogIn className="size-3.5" />
      Sign in
    </Button>
  );
}
