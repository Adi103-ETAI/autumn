// Autumn — Right panel tab switcher (always visible at the top of the aside).
// Extracted so it stays visible even when the AgentChatPanel is open.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, ListChecks, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export function RightPanelTabs() {
  const tab = useAutumnStore((s) => s.rightPanelTab);
  const setTab = useAutumnStore((s) => s.setRightPanelTab);
  const tasks = useAutumnStore((s) => s.tasks);
  const pulses = useAutumnStore((s) => s.pulses);
  const selectedNodeId = useAutumnStore((s) => s.selectedNodeId);

  return (
    <div className="border-b border-border/50 px-2 py-2 bg-sidebar/30">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "commander" | "tasks" | "bus")}
      >
        <TabsList className="grid w-full grid-cols-3 bg-muted/30 h-9">
          <TabsTrigger value="commander" className="text-xs gap-1.5">
            <Sparkles className="size-3" />
            <span>Commander</span>
            {selectedNodeId && tab !== "commander" && (
              <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs gap-1.5">
            <ListChecks className="size-3" />
            <span>Tasks</span>
            <span
              className={cn(
                "text-[9px] tabular-nums rounded-full px-1 ml-0.5",
                tasks.length > 0
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-muted-foreground/50",
              )}
            >
              {tasks.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="bus" className="text-xs gap-1.5">
            <Radio className="size-3" />
            <span>Bus</span>
            {pulses.length > 0 && (
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
