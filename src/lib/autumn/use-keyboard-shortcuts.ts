// Autumn — keyboard shortcuts hook.
// Wires up the global keyboard shortcuts:
//   ⌘K / Ctrl+K     → open command palette
//   ⌘S / Ctrl+S     → save canvas
//   ⌘/ / Ctrl+/     → toggle help
//   ⌘F / Ctrl+F     → open node search overlay
//   Delete / Backspace → remove selected node (if not editing text)
//                      → if multi-select active, removes all selected
//   Shift+D         → duplicate selected node
//   Escape          → deselect / close dialogs / cancel connect mode / close search
//   ⌘1 / ⌘2 / ⌘3 / ⌘4 → switch right panel tab (commander / tasks / bus / stats)
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

      // ? — Toggle shortcut help overlay (without modifier)
      if (e.key === "?" && !mod && !isEditableTarget(e.target)) {
        e.preventDefault();
        s.setShortcutHelpOpen(!s.shortcutHelpOpen);
        return;
      }

      // ⌘F — Open node search overlay
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        s.setShowNodeSearch(true);
        return;
      }

      // ⌘1 / ⌘2 / ⌘3 / ⌘4 — panel tabs
      if (mod && (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4")) {
        e.preventDefault();
        const map = { "1": "commander", "2": "tasks", "3": "bus", "4": "stats" } as const;
        s.setRightPanelTab(map[e.key as "1" | "2" | "3" | "4"]);
        return;
      }

      // Escape — layered: search → palette → dialog → connect mode → deselect
      if (e.key === "Escape") {
        if (s.shortcutHelpOpen) {
          s.setShortcutHelpOpen(false);
          return;
        }
        if (s.showNodeSearch) {
          s.setShowNodeSearch(false);
          return;
        }
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
        if (s.selectedNodeIds.length > 0) {
          s.clearSelection();
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

      // Delete / Backspace — remove selected node(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        // Multi-select takes priority if active.
        if (s.selectedNodeIds.length > 0) {
          e.preventDefault();
          const count = s.selectedNodeIds.length;
          s.removeNodes(s.selectedNodeIds);
          toast.info(`Removed ${count} node${count === 1 ? "" : "s"}`);
          return;
        }
        if (s.selectedNodeId) {
          e.preventDefault();
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          s.removeNode(s.selectedNodeId);
          if (n) toast.info(`Removed "${n.name}"`);
          return;
        }
      }

      // Shift+D — Duplicate selected node
      if (e.shiftKey && e.key.toLowerCase() === "d") {
        if (s.selectedNodeId) {
          e.preventDefault();
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          const newId = s.duplicateNode(s.selectedNodeId);
          if (newId && n) toast.success(`Duplicated "${n.name}"`);
          return;
        }
      }

      // C — connect mode
      if (e.key.toLowerCase() === "c" && !mod && !e.shiftKey) {
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
      if (e.key.toLowerCase() === "r" && !mod && !e.shiftKey) {
        if (s.selectedNodeId) {
          const n = s.nodes.find((x) => x.id === s.selectedNodeId);
          if (n && n.kind === "chat") {
            void runAgentForNode(s.selectedNodeId);
            return;
          }
        }
      }

      // A — arrange nodes
      if (e.key.toLowerCase() === "a" && !mod && !e.shiftKey) {
        s.arrangeNodes();
        toast.info("Nodes arranged");
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
