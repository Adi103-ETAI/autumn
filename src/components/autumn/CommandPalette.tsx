// Autumn — Command Palette (⌘K).
// A cmdk-based palette with all actions: add nodes, save, load, arrange,
// connect, run agents, switch tabs, open dialogs, examples.

"use client";

import { useState, useMemo, useEffect } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Bot,
  TerminalSquare,
  MonitorSmartphone,
  StickyNote,
  BarChart3,
  Globe,
  Clapperboard,
  Save,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Sparkles,
  ListChecks,
  Radio,
  HelpCircle,
  Download,
  Upload,
  Cable,
  Play,
  Trash2,
  RotateCcw,
  Copy,
  Plus,
  Settings2,
  Search,
} from "lucide-react";
import type { NodeKind } from "@/lib/autumn/types";
import { toast } from "sonner";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  group: string;
  run: () => void;
  keywords?: string;
}

export function CommandPalette() {
  const open = useAutumnStore((s) => s.showCommandPalette);
  const setOpen = useAutumnStore((s) => s.setShowCommandPalette);
  const addNode = useAutumnStore((s) => s.addNode);
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const resetCanvas = useAutumnStore((s) => s.resetCanvas);
  const saveCanvas = useAutumnStore((s) => s.saveCanvas);
  const setShowCanvasSwitcher = useAutumnStore((s) => s.setShowCanvasSwitcher);
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
  const setShowExportDialog = useAutumnStore((s) => s.setShowExportDialog);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const nodes = useAutumnStore((s) => s.nodes);
  const selectedNodeId = useAutumnStore((s) => s.selectedNodeId);
  const setSelectedNode = useAutumnStore((s) => s.setSelectedNode);
  const setSettingsNode = useAutumnStore((s) => s.setSettingsNode);
  const setConnectMode = useAutumnStore((s) => s.setConnectMode);
  const duplicateNode = useAutumnStore((s) => s.duplicateNode);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const exportCanvas = useAutumnStore((s) => s.exportCanvas);

  // Local seed for example commands (re-randomized each open)
  const [seed] = useState(() => Date.now());

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];

    // Add nodes
    const ADD_GROUPS: { kind: NodeKind; label: string; icon: Cmd["icon"]; color: string }[] = [
      { kind: "chat", label: "Add agent", icon: Bot, color: "text-fuchsia-400" },
      { kind: "terminal", label: "Add terminal", icon: TerminalSquare, color: "text-emerald-400" },
      { kind: "screen", label: "Add screen", icon: MonitorSmartphone, color: "text-sky-400" },
      { kind: "sticky", label: "Add note", icon: StickyNote, color: "text-amber-400" },
      { kind: "analytics", label: "Add analytics", icon: BarChart3, color: "text-orange-400" },
      { kind: "youtube", label: "Add browser", icon: Globe, color: "text-violet-400" },
      { kind: "remotion", label: "Add remotion", icon: Clapperboard, color: "text-blue-400" },
    ];
    for (const a of ADD_GROUPS) {
      list.push({
        id: `add-${a.kind}`,
        label: a.label,
        icon: a.icon,
        color: a.color,
        group: "Add node",
        keywords: `new ${a.kind} create spawn`,
        run: () => {
          const id = addNode({ kind: a.kind });
          setSelectedNode(id);
          toast.success(`${a.label} added`);
        },
      });
    }

    // Canvas actions
    list.push({
      id: "save",
      label: "Save canvas",
      hint: "⌘S",
      icon: Save,
      color: "text-amber-300",
      group: "Canvas",
      run: () => {
        void saveCanvas().then(() => {
          const err = useAutumnStore.getState().saveError;
          if (err) toast.error(`Save failed: ${err}`);
          else toast.success("Canvas saved");
        });
      },
    });
    list.push({
      id: "open-switcher",
      label: "Open canvas switcher",
      icon: FolderOpen,
      group: "Canvas",
      run: () => setShowCanvasSwitcher(true),
    });
    list.push({
      id: "export",
      label: "Export canvas as JSON",
      icon: Download,
      group: "Canvas",
      run: () => setShowExportDialog(true),
    });
    list.push({
      id: "arrange",
      label: "Arrange nodes (auto-layout)",
      hint: "A",
      icon: LayoutGrid,
      color: "text-emerald-400",
      group: "Canvas",
      run: () => {
        arrangeNodes();
        toast.info("Nodes arranged");
      },
    });
    list.push({
      id: "fit",
      label: "Fit view to canvas",
      hint: "F",
      icon: Maximize2,
      color: "text-violet-400",
      group: "Canvas",
      run: () => {
        // Dispatch a custom event the CanvasView can listen to.
        window.dispatchEvent(new CustomEvent("autumn:fit-view"));
      },
    });
    list.push({
      id: "search",
      label: "Search canvas nodes",
      hint: "⌘F",
      icon: Search,
      color: "text-emerald-400",
      group: "Canvas",
      keywords: "find filter locate node agent",
      run: () => setShowNodeSearch(true),
    });
    list.push({
      id: "reset",
      label: "Reset to seed canvas",
      icon: RotateCcw,
      color: "text-rose-400",
      group: "Canvas",
      run: () => {
        if (window.confirm("Reset canvas to the seed layout? Unsaved changes will be lost.")) {
          resetCanvas();
          toast.info("Canvas reset to seed");
        }
      },
    });
    list.push({
      id: "clear",
      label: "Clear all nodes and edges",
      icon: Trash2,
      color: "text-rose-400",
      group: "Canvas",
      run: () => {
        if (window.confirm("Clear all nodes and edges? This cannot be undone.")) {
          clearCanvas();
          toast.info("Canvas cleared");
        }
      },
    });

    // Panel tabs
    list.push({
      id: "tab-commander",
      label: "Go to Commander panel",
      hint: "⌘1",
      icon: Sparkles,
      color: "text-amber-300",
      group: "Navigate",
      run: () => setRightPanelTab("commander"),
    });
    list.push({
      id: "tab-tasks",
      label: "Go to Task board",
      hint: "⌘2",
      icon: ListChecks,
      color: "text-orange-300",
      group: "Navigate",
      run: () => setRightPanelTab("tasks"),
    });
    list.push({
      id: "tab-bus",
      label: "Go to Bus traffic panel",
      hint: "⌘3",
      icon: Radio,
      color: "text-emerald-300",
      group: "Navigate",
      run: () => setRightPanelTab("bus"),
    });
    list.push({
      id: "help",
      label: "Show onboarding help",
      hint: "⌘/",
      icon: HelpCircle,
      group: "Navigate",
      run: () => setShowHelp(true),
    });

    // Selected agent actions
    if (selectedNodeId) {
      const n = nodes.find((x) => x.id === selectedNodeId);
      if (n && n.kind === "chat") {
        list.push({
          id: "run-agent",
          label: `Run ${n.name} now`,
          hint: "R",
          icon: Play,
          color: "text-emerald-400",
          group: "Selected agent",
          run: () => void runAgentForNode(n.id),
        });
        list.push({
          id: "connect-from",
          label: `Connect ${n.name} → (pick target)`,
          hint: "C",
          icon: Cable,
          color: "text-amber-300",
          group: "Selected agent",
          run: () => {
            setConnectMode({ from: n.id });
            toast.info(`Click another agent to connect ${n.name} → them`);
          },
        });
        list.push({
          id: "duplicate-agent",
          label: `Duplicate ${n.name}`,
          hint: "Shift+D",
          icon: Copy,
          color: "text-amber-300",
          group: "Selected agent",
          run: () => {
            const newId = duplicateNode(n.id);
            if (newId) {
              setSelectedNode(newId);
              toast.success(`Duplicated "${n.name}"`);
            }
          },
        });
        list.push({
          id: "settings-agent",
          label: `Edit ${n.name} settings`,
          icon: Settings2,
          group: "Selected agent",
          run: () => setSettingsNode(n.id),
        });
      }
    }

    // Per-agent quick actions (all chat nodes)
    for (const n of nodes) {
      if (n.kind !== "chat") continue;
      list.push({
        id: `run-${n.id}`,
        label: `Run ${n.name}`,
        icon: Play,
        color: "text-emerald-400",
        group: "Agents",
        keywords: `agent ${n.name} execute`,
        run: () => {
          setSelectedNode(n.id);
          void runAgentForNode(n.id);
        },
      });
    }

    // Example Commander commands
    const EXAMPLES = [
      "spawn Juno and connect her to Atlas, then have her write tests for the medical app",
      "open a phone screen and connect it to Apollo",
      "drop a sticky note saying ship it Friday",
      "spawn two Claude Code agents and connect them",
    ];
    for (const ex of EXAMPLES) {
      list.push({
        id: `example-${ex.slice(0, 20)}`,
        label: `Commander: "${ex.slice(0, 60)}${ex.length > 60 ? "…" : ""}"`,
        icon: Sparkles,
        color: "text-amber-300",
        group: "Commander examples",
        keywords: `commander example send spawn`,
        run: () => {
          useAutumnStore.getState().setRightPanelTab("commander");
          useAutumnStore.getState().setPendingCommand(ex);
        },
      });
    }

    return list;
  }, [
    addNode,
    arrangeNodes,
    clearCanvas,
    resetCanvas,
    saveCanvas,
    setShowCanvasSwitcher,
    setShowHelp,
    setShowExportDialog,
    setRightPanelTab,
    nodes,
    selectedNodeId,
    setSelectedNode,
    setSettingsNode,
    setConnectMode,
    duplicateNode,
    setShowNodeSearch,
    exportCanvas,
    seed,
  ]);

  // Group items
  const groups = useMemo(() => {
    const m = new Map<string, Cmd[]>();
    for (const c of cmds) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return Array.from(m.entries());
  }, [cmds]);

  // Auto-close on open change false
  useEffect(() => {
    if (!open) return;
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {groups.map(([group, items]) => (
          <CommandGroup
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:font-medium"
          >
            {items.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.label} ${c.keywords ?? ""}`}
                onSelect={() => {
                  setOpen(false);
                  // Defer to allow the dialog to close first.
                  setTimeout(() => c.run(), 30);
                }}
                className="gap-2.5"
              >
                <c.icon className={`size-4 ${c.color ?? "text-muted-foreground"}`} />
                <span className="flex-1 text-sm">{c.label}</span>
                {c.hint && (
                  <kbd className="text-[9px] font-mono text-muted-foreground bg-muted/40 border border-border/40 rounded px-1 py-0.5">
                    {c.hint}
                  </kbd>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Tips">
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Plus className="size-3 text-amber-400" />
              <span>Try saying "spawn Juno and connect her to Atlas, then have her write tests" in the Commander.</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Cable className="size-3 text-emerald-400" />
              <span>Press C with a chat node selected to enter connect mode.</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Copy className="size-3 text-violet-400" />
              <span>Press Shift+D to duplicate a selected node. ⌘F opens node search.</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Search className="size-3 text-sky-400" />
              <span>Shift+click nodes to multi-select, then use bulk actions in the toolbar.</span>
            </div>
          </div>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
