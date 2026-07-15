// Autumn — keyboard shortcuts hook.
// Wires up the global keyboard shortcuts:
//   ⌘K / Ctrl+K     → open command palette
//   ⌘S / Ctrl+S     → save canvas
//   ⌘/ / Ctrl+/     → toggle help
//   Delete / Backspace → remove selected node (if not editing text)
//   Escape          → deselect / close dialogs / cancel connect mode
//   ⌘1 / ⌘2 / ⌘3    → switch right panel tab (commander / tasks / bus)
//   C               → enter connect mode (when a chat node is selected)
//   R               → run selected agent
//   A               → arrange nodes
//   F               → fit view (handled by react-flow context elsewhere)

"use client";

import { useEffect } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import { toast } from "sonner";

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const store = useAutumnStore.getState();
      const s = store;

      // ⌘K — Command palette
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setShowCommandPalette(true);
        return;
      }

      // ⌘S — Save canvas
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void s.saveCanvas().then(() => {
          const err = useAutumnStore.getState().saveError;
          if (err) toast.error(`Save failed: ${err}`);
          else toast.success("Canvas saved");
        });
        return;
      }

      // ⌘/ — Toggle help
      if (mod && e.key === "/") {
        e.preventDefault();
        s.setShowHelp(!s.showHelp);
        return;
      }

      // ⌘1 / ⌘2 / ⌘3 — panel tabs
      if (mod && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        const map = { "1": "commander", "2": "tasks", "3": "bus" } as const;
        s.setRightPanelTab(map[e.key]);
        return;
      }

      // Escape — layered: close palette / dialog / connect mode / deselect
      if (e.key === "Escape") {
        if (s.showCommandPalette) {
          s.setShowCommandPalette(false);
          return;
        }
        if (s.showExportDialog) {
          s.setShowExportDialog(false);
          return;
        }
        if (s.showCanvasSwitcher) {
          s.setShowCanvasSwitcher(false);
          return;
        }
        if (s.settingsNodeId) {
          s.setSettingsNode(null);
          return;
        }
        if (s.showHelp) {
          s.setShowHelp(false);
          return;
        }
        if (s.connectMode) {
          s.setConnectMode(null);
          toast.info("Connect mode cancelled");
          return;
        }
        if (s.selectedNodeId) {
          s.setSelectedNode(null);
          return;
        }
        return;
      }

      // After this point, ignore keys typed into inputs/textareas.
      if (isEditableTarget(e.target)) return;

      // Delete / Backspace — remove selected node
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedNodeId) {
          e.preventDefault();
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          s.removeNode(s.selectedNodeId);
          if (n) toast.info(`Removed "${n.name}"`);
          return;
        }
      }

      // C — connect mode
      if (e.key.toLowerCase() === "c" && !mod) {
        if (s.selectedNodeId) {
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          if (n && n.kind === "chat") {
            s.setConnectMode({ from: s.selectedNodeId });
            toast.info(`Connect mode: click another agent to wire ${n.name} → them`);
            return;
          }
        }
      }

      // R — run selected agent
      if (e.key.toLowerCase() === "r" && !mod) {
        if (s.selectedNodeId) {
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          if (n && n.kind === "chat") {
            void runAgentForNode(s.selectedNodeId);
            return;
          }
        }
      }

      // A — arrange nodes
      if (e.key.toLowerCase() === "a" && !mod) {
        s.arrangeNodes();
        toast.info("Nodes arranged");
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
