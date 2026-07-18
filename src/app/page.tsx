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
import { ProjectChatDock } from "@/components/autumn/ProjectChatDock";
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
import { VoiceSetupModal } from "@/components/autumn/VoiceSetupModal";
import { AiFinderOverlay } from "@/components/autumn/AiFinderOverlay";
import { AppsIntegrationModal } from "@/components/autumn/AppsIntegrationModal";
import { TipCard } from "@/components/autumn/TipCard";
import { PanelRightClose, PanelRightOpen, ListChecks, Radio, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  useKeyboardShortcuts();

  const appStage = useAutumnStore((s) => s.appStage);
  const initAppStage = useAutumnStore((s) => s.initAppStage);
  const showAgentSetup = useAutumnStore((s) => s.showAgentSetup);
  const tab = useAutumnStore((s) => s.rightPanelTab);
  const setTab = useAutumnStore((s) => s.setRightPanelTab);
  const rightPanelOpen = useAutumnStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useAutumnStore((s) => s.setRightPanelOpen);
  const toggleRightPanel = useAutumnStore((s) => s.toggleRightPanel);
  const tasks = useAutumnStore((s) => s.tasks);
  const showHelp = useAutumnStore((s) => s.showHelp);
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
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
  // (Project chat now lives in the floating ProjectChatDock above the dock.)

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <MenuBar />
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">
        <Dock />
        <LeftSidebar />
        <main className="flex-1 min-w-0 relative overflow-hidden">
          <CanvasView />
          <TipCard />
          <ProjectChatDock />
        </main>
        {/* ---- Right panel: always-visible 48px icon rail + conditional 380px content ---- */}
        <div className="flex shrink-0">
          {/* Content panel (380px, conditional) */}
          {rightPanelOpen && (
            <aside className="w-[380px] border-l border-border/50 bg-sidebar/40 backdrop-blur-sm flex flex-col">
              <RightPanelTabs />
              <div className="flex-1 overflow-hidden flex flex-col">
                {tab === "tasks" ? (
                  <TaskBoard />
                ) : tab === "stats" ? (
                  <StatsDashboard />
                ) : (
                  <BusTrafficPanel />
                )}
              </div>
            </aside>
          )}
          {/* Icon rail (48px, always visible) — mirrors the left sidebar rail */}
          <div className="flex w-12 shrink-0 flex-col items-center justify-between border-l border-border/40 bg-sidebar/40 py-2">
            <div className="flex flex-col items-center gap-1">
              {([
                { id: "tasks", label: "Tasks", icon: ListChecks },
                { id: "bus", label: "Bus", icon: Radio },
                { id: "stats", label: "Stats", icon: BarChart3 },
              ] as const).map((t) => {
                const Icon = t.icon;
                const isActive = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      setRightPanelOpen(true);
                    }}
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-lg transition-all duration-200 hover:bg-accent/50",
                      isActive &&
                        rightPanelOpen &&
                        "ring-1 ring-inset ring-amber-500/30 bg-amber-500/15",
                    )}
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={isActive}
                  >
                    <Icon
                      className={cn(
                        "size-5 transition-colors",
                        isActive && rightPanelOpen
                          ? "text-amber-300"
                          : "text-muted-foreground",
                      )}
                    />
                    {t.id === "tasks" && tasks.length > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white shadow-sm">
                        {tasks.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Collapse / expand toggle */}
            <button
              onClick={toggleRightPanel}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground"
              title={rightPanelOpen ? "Collapse" : "Expand"}
              aria-label={
                rightPanelOpen ? "Collapse right panel" : "Expand right panel"
              }
            >
              {rightPanelOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </button>
          </div>
        </div>
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
