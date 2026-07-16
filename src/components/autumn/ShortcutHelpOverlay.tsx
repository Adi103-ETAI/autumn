// Autumn — Keyboard shortcut help overlay.
// Press ? to open. Shows all global keyboard shortcuts in a styled dialog.

"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  Keyboard,
  Command,
  Search,
  Save,
  Delete,
  Copy,
  Cable,
  Play,
  Workflow,
  HelpCircle,
  PanelsTopLeft,
  ListTodo,
  Bus,
} from "lucide-react";

interface ShortcutGroup {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  items: { keys: string[]; label: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    icon: Command,
    color: "text-violet-300",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["⌘", "F"], label: "Search canvas nodes" },
      { keys: ["⌘", "S"], label: "Save canvas to database" },
      { keys: ["⌘", "/"], label: "Toggle help dialog" },
      { keys: ["?"], label: "Show this shortcut overlay" },
      { keys: ["Esc"], label: "Close / deselect / cancel" },
    ],
  },
  {
    title: "Panel tabs",
    icon: PanelsTopLeft,
    color: "text-sky-300",
    items: [
      { keys: ["⌘", "1"], label: "Switch to Commander tab" },
      { keys: ["⌘", "2"], label: "Switch to Tasks tab" },
      { keys: ["⌘", "3"], label: "Switch to Bus tab" },
      { keys: ["⌘", "4"], label: "Switch to Stats tab" },
    ],
  },
  {
    title: "Canvas",
    icon: Workflow,
    color: "text-violet-300",
    items: [
      { keys: ["A"], label: "Auto-arrange nodes (tiered layout)" },
      { keys: ["F"], label: "Fit view to all nodes" },
      { keys: ["C"], label: "Connect mode (click another agent)" },
      { keys: ["R"], label: "Run selected agent" },
      { keys: ["Shift", "D"], label: "Duplicate selected node" },
      { keys: ["Shift", "click"], label: "Multi-select nodes" },
      { keys: ["Del"], label: "Remove selected node(s)" },
      { keys: ["Right-click"], label: "Context menu (pane or node)" },
      { keys: ["Double-click edge"], label: "Open edge inspector" },
    ],
  },
];

export function ShortcutHelpOverlay() {
  const showHelp = useAutumnStore((s) => s.shortcutHelpOpen);
  const setShowHelp = useAutumnStore((s) => s.setShortcutHelpOpen);

  return (
    <Dialog open={showHelp} onOpenChange={setShowHelp}>
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur-md border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="size-4 text-violet-400" />
            <span>Keyboard shortcuts</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Autumn is keyboard-first. Press <kbd className="px-1 py-0.5 text-[10px] bg-muted/60 rounded border border-border/60 font-mono">?</kbd> anywhere to bring up this reference.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                <group.icon className={group.color} />
                <span>{group.title}</span>
              </div>
              <div className="space-y-1">
                {group.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md hover:bg-muted/30 px-1.5 py-1 transition-colors"
                  >
                    <div className="flex items-center gap-0.5">
                      {item.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="min-w-[20px] text-center text-[9px] font-mono bg-muted/60 border border-border/60 rounded px-1 py-0.5 text-foreground/90"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground ml-auto text-right">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <HelpCircle className="size-3" />
            <span>Tip: shortcuts work even when typing in inputs (except ⌘ keys).</span>
          </div>
          <Badge variant="outline" className="text-[9px] h-5 px-1.5">
            press <kbd className="font-mono ml-1">Esc</kbd> to close
          </Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}
