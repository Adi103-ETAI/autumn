// Autumn — page shell.
// Single-route app: a spatial canvas workshop with a Commander panel.

"use client";

import { useEffect } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { useKeyboardShortcuts } from "@/lib/autumn/use-keyboard-shortcuts";
import { TopBar } from "@/components/autumn/TopBar";
import { Dock } from "@/components/autumn/Dock";
import { CanvasView } from "@/components/autumn/CanvasView";
import { CommanderPanel } from "@/components/autumn/CommanderPanel";
import { AgentChatPanel } from "@/components/autumn/AgentChatPanel";
import { TaskBoard } from "@/components/autumn/TaskBoard";
import { BusTrafficPanel } from "@/components/autumn/BusTrafficPanel";
import { StatusBar } from "@/components/autumn/StatusBar";
import { HelpDialog } from "@/components/autumn/HelpDialog";
import { AgentSettingsDialog } from "@/components/autumn/AgentSettingsDialog";
import { CanvasSwitcher } from "@/components/autumn/CanvasSwitcher";
import { CommandPalette } from "@/components/autumn/CommandPalette";
import { ExportImportDialog } from "@/components/autumn/ExportImportDialog";
import { ActivityTimeline } from "@/components/autumn/ActivityTimeline";
import { RightPanelTabs } from "@/components/autumn/RightPanelTabs";

export default function Home() {
  useKeyboardShortcuts();

  const tab = useAutumnStore((s) => s.rightPanelTab);
  const showHelp = useAutumnStore((s) => s.showHelp);
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
  const selectedNodeId = useAutumnStore((s) => s.selectedNodeId);
  const selectedNode = useAutumnStore((s) =>
    s.nodes.find((n) => n.id === s.selectedNodeId),
  );
  const settingsNodeId = useAutumnStore((s) => s.settingsNodeId);
  const setSettingsNode = useAutumnStore((s) => s.setSettingsNode);
  const showCanvasSwitcher = useAutumnStore((s) => s.showCanvasSwitcher);
  const setShowCanvasSwitcher = useAutumnStore((s) => s.setShowCanvasSwitcher);
  const showActivityLog = useAutumnStore((s) => s.showActivityLog);
  const setShowActivityLog = useAutumnStore((s) => s.setShowActivityLog);

  // Open help on first visit.
  useEffect(() => {
    const seen =
      typeof window !== "undefined" && localStorage.getItem("autumn-seen");
    if (!seen) {
      setShowHelp(true);
      localStorage.setItem("autumn-seen", "1");
    }
  }, [setShowHelp]);

  // Show agent chat panel when a chat node is selected AND we're on the commander tab.
  const showAgentChat =
    tab === "commander" && selectedNodeId && selectedNode?.kind === "chat";

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <Dock />
        <main className="flex-1 relative overflow-hidden">
          <CanvasView />
        </main>
        <aside className="w-[380px] border-l border-border/50 bg-sidebar/40 backdrop-blur-sm flex flex-col">
          <RightPanelTabs />
          <div className="flex-1 overflow-hidden flex flex-col">
            {showAgentChat && selectedNodeId ? (
              <AgentChatPanel nodeId={selectedNodeId} />
            ) : tab === "commander" ? (
              <CommanderPanel />
            ) : tab === "tasks" ? (
              <TaskBoard />
            ) : (
              <BusTrafficPanel />
            )}
          </div>
        </aside>
      </div>
      <StatusBar />
      {showHelp && <HelpDialog />}
      <AgentSettingsDialog
        nodeId={settingsNodeId}
        open={settingsNodeId !== null}
        onOpenChange={(v) => !v && setSettingsNode(null)}
      />
      <CanvasSwitcher
        open={showCanvasSwitcher}
        onOpenChange={setShowCanvasSwitcher}
      />
      <CommandPalette />
      <ExportImportDialog />
      <ActivityTimeline
        open={showActivityLog}
        onOpenChange={setShowActivityLog}
      />
    </div>
  );
}
