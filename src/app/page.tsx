// Autumn — page shell.
// Single-route app with a 3-stage flow:
//   onboarding → home (workspace launcher) → workspace (spatial canvas)
// The stage is driven by the Zustand store (`appStage`) and persisted to
// localStorage so returning users land on Home instead of re-onboarding.

"use client";

import { useEffect } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { decodeCanvasFromHash } from "@/lib/autumn/share-canvas";
import { useKeyboardShortcuts } from "@/lib/autumn/use-keyboard-shortcuts";
import { TopBar } from "@/components/autumn/TopBar";
import { Dock } from "@/components/autumn/Dock";
import { CanvasView } from "@/components/autumn/CanvasView";
import { CommanderPanel } from "@/components/autumn/CommanderPanel";
import { AgentChatPanel } from "@/components/autumn/AgentChatPanel";
import { TaskBoard } from "@/components/autumn/TaskBoard";
import { BusTrafficPanel } from "@/components/autumn/BusTrafficPanel";
import { StatsDashboard } from "@/components/autumn/StatsDashboard";
import { StatusBar } from "@/components/autumn/StatusBar";
import { HelpDialog } from "@/components/autumn/HelpDialog";
import { AgentSettingsDialog } from "@/components/autumn/AgentSettingsDialog";
import { CanvasSwitcher } from "@/components/autumn/CanvasSwitcher";
import { CommandPalette } from "@/components/autumn/CommandPalette";
import { ExportImportDialog } from "@/components/autumn/ExportImportDialog";
import { ActivityTimeline } from "@/components/autumn/ActivityTimeline";
import { RightPanelTabs } from "@/components/autumn/RightPanelTabs";
import { NodeSearchOverlay } from "@/components/autumn/NodeSearchOverlay";
import { ShortcutHelpOverlay } from "@/components/autumn/ShortcutHelpOverlay";
import { AgentHistoryPanel } from "@/components/autumn/AgentHistoryPanel";
import { OnboardingWizard } from "@/components/autumn/OnboardingWizard";
import { HomeScreen } from "@/components/autumn/HomeScreen";
import { MenuBar } from "@/components/autumn/MenuBar";
import { AgentConnectionModal } from "@/components/autumn/AgentConnectionModal";
import { LeftSidebar } from "@/components/autumn/LeftSidebar";
import { FloatingTopBar } from "@/components/autumn/FloatingTopBar";
import { VoiceMicButton } from "@/components/autumn/VoiceMicButton";
import { VoiceSetupModal } from "@/components/autumn/VoiceSetupModal";
import { AiFinderOverlay } from "@/components/autumn/AiFinderOverlay";
import { AppsIntegrationModal } from "@/components/autumn/AppsIntegrationModal";

export default function Home() {
  useKeyboardShortcuts();

  const appStage = useAutumnStore((s) => s.appStage);
  const initAppStage = useAutumnStore((s) => s.initAppStage);
  const showAgentSetup = useAutumnStore((s) => s.showAgentSetup);
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

  // Initialize app stage from localStorage on first mount.
  // This decides whether we land on onboarding (first visit) or home (returning).
  useEffect(() => {
    initAppStage();
  }, [initAppStage]);

  // Show help dialog the first time the user enters the workspace stage
  // (after onboarding is completed). Replaces the old WelcomeSplash-gated logic.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (appStage !== "workspace") return;
    const onboardingDone = localStorage.getItem("autumn-onboarding-completed");
    const helpSeen = localStorage.getItem("autumn-seen");
    if (onboardingDone && !helpSeen) {
      setShowHelp(true);
      localStorage.setItem("autumn-seen", "1");
    }
  }, [setShowHelp, appStage]);

  // Load persisted activity log entries for the current canvas on mount.
  const loadActivity = useAutumnStore((s) => s.loadActivity);
  const canvasId = useAutumnStore((s) => s.canvasId);
  useEffect(() => {
    if (appStage !== "workspace") return;
    void loadActivity(canvasId);
  }, [loadActivity, canvasId, appStage]);

  // On mount: if the URL has a `#canvas=...` hash, decode it and import the
  // shared canvas state. This lets users share canvases by pasting a URL.
  const importCanvasState = useAutumnStore((s) => s.importCanvasState);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#canvas=")) return;
    const state = decodeCanvasFromHash(hash);
    if (!state) return;
    importCanvasState(state);
    // Clear the hash so a refresh doesn't re-import.
    window.history.replaceState(null, "", window.location.pathname);
  }, [importCanvasState]);

  // ---- STAGE: onboarding ----
  // First-time users see the 4-step wizard. The global MenuBar sits above it.
  if (appStage === "onboarding") {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
        <MenuBar />
        <div className="flex-1 min-h-0 overflow-auto">
          <OnboardingWizard />
        </div>
        {/* Global overlays reachable from the MenuBar */}
        {showHelp && <HelpDialog />}
        <ShortcutHelpOverlay />
        {showAgentSetup && <AgentConnectionModal />}
      </div>
    );
  }

  // ---- STAGE: home ----
  // Returning users (or those who just finished onboarding) see the workspace
  // launcher. The agent-connection modal overlays if open.
  if (appStage === "home") {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
        <MenuBar />
        <div className="flex-1 min-h-0 overflow-auto">
          <HomeScreen />
        </div>
        {/* Global overlays reachable from the MenuBar */}
        {showHelp && <HelpDialog />}
        <ShortcutHelpOverlay />
        {showAgentSetup && <AgentConnectionModal />}
      </div>
    );
  }

  // ---- STAGE: workspace ----
  // The spatial canvas with dock, right panel, and all the tooling.
  const showAgentChat =
    tab === "commander" && selectedNodeId && selectedNode?.kind === "chat";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <MenuBar />
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <Dock />
        <LeftSidebar />
        <main className="flex-1 min-w-0 relative overflow-hidden">
          <CanvasView />
          <FloatingTopBar />
          <VoiceMicButton />
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
            ) : tab === "stats" ? (
              <StatsDashboard />
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
      <NodeSearchOverlay />
      <ShortcutHelpOverlay />
      <AgentHistoryPanel />
      <AiFinderOverlay />
      <VoiceSetupModal />
      <AppsIntegrationModal />
      {showAgentSetup && <AgentConnectionModal />}
    </div>
  );
}
