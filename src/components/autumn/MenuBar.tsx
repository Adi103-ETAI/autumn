// Autumn — MenuBar.
// A macOS-style global application menu bar, rendered above ALL app stages
// (onboarding / home / workspace). Mirrors the October Desktop reference:
//   [Autumn logo]  File  Edit  Selection  View  Go  Run  Terminal  Help
//                                        …   [accent] [settings] [Sign in]
//
// Each menu is a shadcn DropdownMenu. Menu items are wired to real Zustand
// store actions so the bar is fully functional, not decorative. Items that
// only make sense in the workspace stage degrade gracefully (no-op / hidden)
// when viewed from onboarding or home.

"use client";

import { Fragment } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import {
  Settings,
  User,
  Plus,
  FolderOpen,
  Github,
  Link as LinkIcon,
  Save,
  Download,
  Upload,
  Trash2,
  Pencil,
  Copy,
  Layers,
  Square,
  Grid3x3,
  Sparkles,
  PanelLeft,
  Map,
  Command as CommandIcon,
  Search,
  GanttChartSquare,
  History,
  LayoutGrid,
  Home,
  FolderTree,
  Play,
  Bot,
  TerminalSquare,
  Network,
  Keyboard,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// A single menu definition: its label + the items it contains.
interface MenuEntry {
  type: "item" | "separator" | "label";
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

interface MenuDef {
  label: string;
  entries: MenuEntry[];
}

export function MenuBar() {
  // ---- store hooks ----
  const appStage = useAutumnStore((s) => s.appStage);
  const setAppStage = useAutumnStore((s) => s.setAppStage);

  // File actions
  const addWorkspace = useAutumnStore((s) => s.addWorkspace);
  const saveCanvas = useAutumnStore((s) => s.saveCanvas);
  const canvasName = useAutumnStore((s) => s.canvasName);
  const setShowExportDialog = useAutumnStore((s) => s.setShowExportDialog);
  const clearCanvas = useAutumnStore((s) => s.clearCanvas);
  const resetOnboarding = useAutumnStore((s) => s.resetOnboarding);

  // Edit actions
  const setCanvasName = useAutumnStore((s) => s.setCanvasName);
  const duplicateNode = useAutumnStore((s) => s.duplicateNode);
  const removeNode = useAutumnStore((s) => s.removeNode);
  const selectedNodeId = useAutumnStore((s) => s.selectedNodeId);

  // Selection actions
  const addToSelection = useAutumnStore((s) => s.addToSelection);
  const clearSelection = useAutumnStore((s) => s.clearSelection);
  const arrangeNodes = useAutumnStore((s) => s.arrangeNodes);
  const nodes = useAutumnStore((s) => s.nodes);

  // View actions
  const setLeftSidebarOpen = useAutumnStore((s) => s.setLeftSidebarOpen);
  const leftSidebarOpen = useAutumnStore((s) => s.leftSidebarOpen);
  const setShowMinimap = useAutumnStore((s) => s.setShowMinimap);
  const showMinimap = useAutumnStore((s) => s.showMinimap);
  const setShowCommandPalette = useAutumnStore((s) => s.setShowCommandPalette);
  const setShowNodeSearch = useAutumnStore((s) => s.setShowNodeSearch);
  const setAiFinderOpen = useAutumnStore((s) => s.setAiFinderOpen);
  const setShowActivityLog = useAutumnStore((s) => s.setShowActivityLog);
  const setShowCanvasSwitcher = useAutumnStore((s) => s.setShowCanvasSwitcher);

  // Run actions
  const setShowAgentSetup = useAutumnStore((s) => s.setShowAgentSetup);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);

  // Terminal actions
  const addNode = useAutumnStore((s) => s.addNode);

  // Help actions
  const setShowHelp = useAutumnStore((s) => s.setShowHelp);
  const setShortcutHelpOpen = useAutumnStore((s) => s.setShortcutHelpOpen);

  // ---- helpers ----
  const inWorkspace = appStage === "workspace";
  const hasCanvas = nodes.length > 0;

  const handleNewWorkspace = () => {
    addWorkspace({
      name: `Workspace ${nodes.length + 1}`,
      kind: "blank",
    } as Parameters<typeof addWorkspace>[0]);
    setAppStage("workspace");
    toast.success("New workspace created");
  };

  const handleRename = () => {
    const next = window.prompt("Rename canvas", canvasName);
    if (next && next.trim()) setCanvasName(next.trim());
  };

  const handleSave = async () => {
    await saveCanvas();
    const err = useAutumnStore.getState().saveError;
    if (err) toast.error(`Save failed: ${err}`);
    else toast.success("Canvas saved");
  };

  const handleClear = () => {
    if (
      window.confirm(
        "Clear the entire canvas? This removes all nodes and edges.",
      )
    ) {
      clearCanvas();
      toast.success("Canvas cleared");
    }
  };

  // ---- menu definitions ----
  const menus: MenuDef[] = [
    {
      label: "File",
      entries: [
        {
          type: "item",
          label: "New workspace",
          icon: Plus,
          shortcut: "⌘N",
          onSelect: handleNewWorkspace,
        },
        {
          type: "item",
          label: "Open folder…",
          icon: FolderOpen,
          onSelect: () => {
            setAppStage("home");
            toast.message("Open a folder from the home screen");
          },
        },
        {
          type: "item",
          label: "Clone repo…",
          icon: Github,
          onSelect: () => {
            setAppStage("home");
            toast.message("Clone a repo from the home screen");
          },
        },
        {
          type: "item",
          label: "Open from link…",
          icon: LinkIcon,
          onSelect: () => {
            setAppStage("home");
            toast.message("Open a shared canvas from the home screen");
          },
        },
        { type: "separator" },
        {
          type: "item",
          label: "Save canvas",
          icon: Save,
          shortcut: "⌘S",
          disabled: !inWorkspace,
          onSelect: handleSave,
        },
        {
          type: "item",
          label: "Export…",
          icon: Download,
          shortcut: "⌘E",
          disabled: !inWorkspace,
          onSelect: () => setShowExportDialog(true),
        },
        {
          type: "item",
          label: "Import…",
          icon: Upload,
          disabled: !inWorkspace,
          onSelect: () => setShowExportDialog(true),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Clear canvas",
          icon: Trash2,
          disabled: !inWorkspace || !hasCanvas,
          onSelect: handleClear,
        },
      ],
    },
    {
      label: "Edit",
      entries: [
        {
          type: "item",
          label: "Rename canvas",
          icon: Pencil,
          disabled: !inWorkspace,
          onSelect: handleRename,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Duplicate node",
          icon: Copy,
          shortcut: "⌘D",
          disabled: !inWorkspace || !selectedNodeId,
          onSelect: () => selectedNodeId && duplicateNode(selectedNodeId),
        },
        {
          type: "item",
          label: "Delete node",
          icon: Trash2,
          shortcut: "⌫",
          disabled: !inWorkspace || !selectedNodeId,
          onSelect: () => selectedNodeId && removeNode(selectedNodeId),
        },
      ],
    },
    {
      label: "Selection",
      entries: [
        {
          type: "item",
          label: "Select all nodes",
          icon: Layers,
          shortcut: "⌘A",
          disabled: !inWorkspace || !hasCanvas,
          onSelect: () => nodes.forEach((n) => addToSelection(n.id)),
        },
        {
          type: "item",
          label: "Clear selection",
          icon: Square,
          shortcut: "⇧⌘A",
          disabled: !inWorkspace,
          onSelect: clearSelection,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Arrange nodes",
          icon: Grid3x3,
          disabled: !inWorkspace || !hasCanvas,
          onSelect: () => {
            arrangeNodes();
            toast.success("Nodes arranged");
          },
        },
      ],
    },
    {
      label: "View",
      entries: [
        {
          type: "item",
          label: leftSidebarOpen ? "Hide left sidebar" : "Show left sidebar",
          icon: PanelLeft,
          shortcut: "⌘B",
          disabled: !inWorkspace,
          onSelect: () => setLeftSidebarOpen(!leftSidebarOpen),
        },
        {
          type: "item",
          label: showMinimap ? "Hide minimap" : "Show minimap",
          icon: Map,
          disabled: !inWorkspace,
          onSelect: () => setShowMinimap(!showMinimap),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Command palette",
          icon: CommandIcon,
          shortcut: "⌘K",
          onSelect: () => setShowCommandPalette(true),
        },
        {
          type: "item",
          label: "Node search",
          icon: Search,
          shortcut: "⌘F",
          disabled: !inWorkspace,
          onSelect: () => setShowNodeSearch(true),
        },
        {
          type: "item",
          label: "AI Finder",
          icon: Sparkles,
          onSelect: () => setAiFinderOpen(true),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Activity log",
          icon: History,
          disabled: !inWorkspace,
          onSelect: () => setShowActivityLog(true),
        },
        {
          type: "item",
          label: "Canvas switcher",
          icon: LayoutGrid,
          shortcut: "⌘⇧O",
          disabled: !inWorkspace,
          onSelect: () => setShowCanvasSwitcher(true),
        },
      ],
    },
    {
      label: "Go",
      entries: [
        {
          type: "item",
          label: "Home",
          icon: Home,
          onSelect: () => setAppStage("home"),
        },
        {
          type: "item",
          label: "Workspace",
          icon: FolderTree,
          disabled: appStage === "workspace",
          onSelect: () => setAppStage("workspace"),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Switch canvas…",
          icon: LayoutGrid,
          shortcut: "⌘⇧O",
          disabled: !inWorkspace,
          onSelect: () => setShowCanvasSwitcher(true),
        },
      ],
    },
    {
      label: "Run",
      entries: [
        {
          type: "item",
          label: "Connect agents…",
          icon: Bot,
          onSelect: () => setShowAgentSetup(true),
        },
        {
          type: "item",
          label: "Open Commander",
          icon: Play,
          shortcut: "⌘L",
          disabled: !inWorkspace,
          onSelect: () => setRightPanelTab("commander"),
        },
        {
          type: "item",
          label: "Task board",
          icon: GanttChartSquare,
          disabled: !inWorkspace,
          onSelect: () => setRightPanelTab("tasks"),
        },
      ],
    },
    {
      label: "Terminal",
      entries: [
        {
          type: "item",
          label: "New terminal node",
          icon: TerminalSquare,
          disabled: !inWorkspace,
          onSelect: () => {
            addNode({ kind: "terminal" });
            toast.success("Terminal node added");
          },
        },
        { type: "separator" },
        {
          type: "item",
          label: "Bus traffic",
          icon: Network,
          disabled: !inWorkspace,
          onSelect: () => setRightPanelTab("bus"),
        },
      ],
    },
    {
      label: "Help",
      entries: [
        {
          type: "item",
          label: "Autumn help",
          icon: HelpCircle,
          onSelect: () => setShowHelp(true),
        },
        {
          type: "item",
          label: "Keyboard shortcuts",
          icon: Keyboard,
          shortcut: "⌘/",
          onSelect: () => setShortcutHelpOpen(true),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Connect agents…",
          icon: Bot,
          onSelect: () => setShowAgentSetup(true),
        },
        {
          type: "item",
          label: "Restart onboarding",
          icon: RefreshCw,
          onSelect: () => {
            if (window.confirm("Restart the onboarding wizard?")) {
              resetOnboarding();
            }
          },
        },
      ],
    },
  ];

  return (
    <nav
      aria-label="Application menu bar"
      className="autumn-menubar relative z-[300] h-8 shrink-0 flex items-center gap-0.5 px-2 border-b border-border/40 bg-zinc-950/80 backdrop-blur-md select-none"
      data-autumn-menubar
    >
      {/* ---- Brand ---- */}
      <button
        type="button"
        onClick={() => setAppStage("home")}
        className="flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-white/5 transition-colors group"
        aria-label="Autumn — go to home"
      >
        <AutumnLogo size={16} priority />
        <span className="text-[13px] font-semibold tracking-tight text-foreground">
          Autumn
        </span>
      </button>

      <span className="mx-1 h-4 w-px bg-border/40" aria-hidden />

      {/* ---- Menus ---- */}
      {menus.map((menu) => (
        <DropdownMenu key={menu.label}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "px-2.5 h-6 rounded-md text-[13px] text-muted-foreground",
                "hover:bg-white/10 hover:text-foreground transition-colors",
                "focus-visible:outline-none focus-visible:bg-white/10 focus-visible:text-foreground",
                "data-[state=open]:bg-white/10 data-[state=open]:text-foreground",
              )}
            >
              {menu.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[220px] bg-zinc-950/95 border-border/50 backdrop-blur-md"
            // Keep the dropdown above the menu bar (z-300) and other chrome.
            style={{ zIndex: 301 }}
          >
            {menu.entries.map((entry, i) => {
              if (entry.type === "separator")
                return <DropdownMenuSeparator key={`sep-${i}`} />;
              if (entry.type === "label")
                return (
                  <DropdownMenuLabel key={`lbl-${i}`}>
                    {entry.label}
                  </DropdownMenuLabel>
                );
              const Icon = entry.icon;
              return (
                <DropdownMenuItem
                  key={`item-${i}`}
                  disabled={entry.disabled}
                  onSelect={(e) => {
                    e.preventDefault();
                    entry.onSelect?.();
                  }}
                  className="gap-2.5 text-[13px] text-muted-foreground focus:text-foreground focus:bg-white/10"
                >
                  {Icon ? (
                    <Icon className="size-3.5 shrink-0 text-muted-foreground/80" />
                  ) : (
                    <span className="size-3.5 shrink-0" />
                  )}
                  <span className="flex-1">{entry.label}</span>
                  {entry.shortcut ? (
                    <DropdownMenuShortcut className="text-[11px] text-muted-foreground/60">
                      {entry.shortcut}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}

      {/* ---- Spacer ---- */}
      <div className="flex-1" />

      {/* ---- Right cluster: accent + settings + sign in ---- */}
      <div className="flex items-center gap-1">
        {/* Accent status dot — echoes October's purple square */}
        <span
          aria-hidden
          className="size-2 rounded-[3px] bg-violet-500/80 shadow-[0_0_6px] shadow-violet-500/40"
          title="Autumn"
        />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-white/10"
          onClick={() => setShowHelp(true)}
          aria-label="Settings"
        >
          <Settings className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-white/10"
          onClick={() => setShowAgentSetup(true)}
        >
          <User className="size-3.5" />
          <span>Sign in</span>
        </Button>
      </div>
    </nav>
  );
}
