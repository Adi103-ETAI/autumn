// Autumn — Help / Onboarding dialog.
// Shows on first visit. Explains the spatial workshop metaphor + example commands.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Leaf, Sparkles, Mic, Bot, Cable, Terminal } from "lucide-react";

const EXAMPLES = [
  {
    text: "Spawn two Claude Code agents and connect them",
    desc: "Adds Atlas + Apollo chat nodes and wires a bus edge.",
  },
  {
    text: "Open a phone screen and connect it to Apollo",
    desc: "Adds a phone preview node + nav edge from Apollo.",
  },
  {
    text: "Spawn Atlas and Orion, connect them, and have Atlas build UI while Orion does backend for a medical app",
    desc: "Two agents, bus edge, two verbatim send_to_node tasks.",
  },
  {
    text: "Drop a sticky note saying ship it Friday",
    desc: "Single add_note action with the verbatim text.",
  },
];

export function HelpDialog() {
  const show = useAutumnStore((s) => s.showHelp);
  const setShow = useAutumnStore((s) => s.setShowHelp);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const setPendingCommand = useAutumnStore((s) => s.setPendingCommand);

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg">
              <Leaf className="size-4 text-white" />
            </div>
            <DialogTitle className="text-xl">Welcome to Autumn</DialogTitle>
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Autumn is a spatial canvas for orchestrating AI coding agents.
            Speak or type to the <strong>Commander</strong>; it spawns named
            agents (Atlas, Apollo, Orion, Juno, …) on the canvas, connects
            them with bus edges, and assigns each their part of the work.
            Connected agents coordinate via the{" "}
            <code className="text-amber-300">message_peer</code> bus tool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Feature
              icon={Sparkles}
              title="Commander"
              desc="Natural language → DO_ACTIONS plan. Try voice or text."
              color="text-amber-400"
            />
            <Feature
              icon={Bot}
              title="Named agents"
              desc="Atlas, Apollo, Orion, Juno + more — each with a specialty."
              color="text-fuchsia-400"
            />
            <Feature
              icon={Cable}
              title="Bus edges"
              desc="Wire agents together. Traffic flows as animated pulses."
              color="text-emerald-400"
            />
            <Feature
              icon={Terminal}
              title="Task board"
              desc="Shared Octoplan-style board with dependency edges."
              color="text-orange-400"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Try these commands
            </div>
            <div className="space-y-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setRightPanelTab("commander");
                    setPendingCommand(ex.text);
                    setShow(false);
                  }}
                  className="w-full text-left rounded-md border border-border/50 bg-muted/20 hover:bg-muted/40 hover:border-amber-500/40 px-3 py-2 transition-colors group"
                >
                  <div className="text-sm font-medium text-amber-200 group-hover:text-amber-100">
                    "{ex.text}"
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {ex.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-3 py-2">
            <Mic className="size-3.5 text-rose-400" />
            <span>
              Voice input uses your browser's Web Speech API (Chrome/Edge).
              STT-mangled words like "cloud code" are auto-resolved to claude-code.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Badge variant="outline" className="text-[10px] mr-auto">
            open clone of October Desktop
          </Badge>
          <Button onClick={() => setShow(false)} className="gap-1.5">
            <Leaf className="size-3.5" />
            Enter the workshop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`size-3.5 ${color}`} />
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <div className="text-[10px] text-muted-foreground leading-relaxed">
        {desc}
      </div>
    </div>
  );
}
