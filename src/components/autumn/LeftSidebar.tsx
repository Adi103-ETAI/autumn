// Autumn — Left Sidebar (mirrors October Desktop's left sidebar).
// Sits to the right of the existing left Dock. Layout:
//   - 48px vertical icon rail (always visible) with 4 tabs + collapse toggle
//   - 280px expandable content panel (Framer Motion width/opacity transition)
//
// Tabs: Resources / Skills / Backends / Design
// A Conversations sub-panel (collapsible) lives at the bottom of the content panel,
// showing inter-agent bus traffic grouped by edge.

"use client";

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  FolderOpen,
  Sparkles,
  Database,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
  Upload,
  FolderPlus,
  Cloud,
  Clipboard,
  Plus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Trash2,
  ArrowRight,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileType,
  File as FileIcon,
  Download,
  Cable,
} from "lucide-react";

import { useAutumnStore } from "@/lib/autumn/store";
import type {
  ProjectFile,
  ProjectFileCategory,
  Skill,
} from "@/lib/autumn/store";
import type { BusPulse } from "@/lib/autumn/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---- Tab metadata -----------------------------------------------------------

type TabId = "resources" | "skills" | "backends" | "design";

const TABS: {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  ring: string;
  bg: string;
  description: string;
}[] = [
  {
    id: "resources",
    label: "Resources",
    icon: FolderOpen,
    color: "text-amber-400",
    ring: "ring-amber-500/40",
    bg: "bg-amber-500/15",
    description: "Project context",
  },
  {
    id: "skills",
    label: "Skills",
    icon: Sparkles,
    color: "text-fuchsia-400",
    ring: "ring-fuchsia-500/40",
    bg: "bg-fuchsia-500/15",
    description: "Installable agent skills",
  },
  {
    id: "backends",
    label: "Backends",
    icon: Database,
    color: "text-emerald-400",
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500/15",
    description: "Website, data & AI integrations",
  },
  {
    id: "design",
    label: "Design",
    icon: Palette,
    color: "text-sky-400",
    ring: "ring-sky-500/40",
    bg: "bg-sky-500/15",
    description: "One design.md for the canvas",
  },
];

// ---- File category helpers --------------------------------------------------

const CATEGORY_ICON: Record<
  ProjectFileCategory,
  React.ComponentType<{ className?: string }>
> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  font: FileType,
  doc: FileText,
  other: FileIcon,
};

const CATEGORY_COLOR: Record<ProjectFileCategory, string> = {
  image: "text-sky-400",
  video: "text-fuchsia-400",
  audio: "text-amber-400",
  font: "text-amber-400",
  doc: "text-emerald-400",
  other: "text-muted-foreground",
};

const CATEGORY_LABEL: Record<ProjectFileCategory, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  font: "Fonts",
  doc: "Docs",
  other: "Other",
};

function categoryFromExt(name: string): ProjectFileCategory {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["ttf", "otf", "woff", "woff2"].includes(ext)) return "font";
  if (["pdf", "md", "txt", "doc", "docx", "rtf"].includes(ext)) return "doc";
  return "other";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---- Main component ---------------------------------------------------------

export function LeftSidebar() {
  const leftSidebarOpen = useAutumnStore((s) => s.leftSidebarOpen);
  const leftSidebarTab = useAutumnStore((s) => s.leftSidebarTab);
  const setLeftSidebarTab = useAutumnStore((s) => s.setLeftSidebarTab);
  const toggleLeftSidebar = useAutumnStore((s) => s.toggleLeftSidebar);
  const designMd = useAutumnStore((s) => s.designMd);

  const activeTab = TABS.find((t) => t.id === leftSidebarTab) ?? TABS[0];

  const handleTabClick = (tabId: TabId) => {
    if (leftSidebarTab === tabId && leftSidebarOpen) {
      // Same tab clicked while open → toggle closed (mirrors October behaviour)
      toggleLeftSidebar();
    } else {
      setLeftSidebarTab(tabId);
    }
  };

  return (
    <div className="flex h-full shrink-0 bg-sidebar/60 backdrop-blur-md border-r border-border/50">
      {/* ---- Icon rail (48px, always visible) ---- */}
      <div className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border/40 bg-sidebar/40 py-2">
        <div className="flex flex-col items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = leftSidebarTab === tab.id && leftSidebarOpen;
            const showDesignBadge =
              tab.id === "design" && designMd.trim().length === 0;
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleTabClick(tab.id)}
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-lg transition-all duration-200",
                      "hover:bg-accent/50",
                      isActive &&
                        cn("ring-1 ring-inset", tab.ring, tab.bg),
                    )}
                    aria-label={tab.label}
                    aria-pressed={isActive}
                  >
                    <Icon
                      className={cn(
                        "size-4 transition-colors",
                        isActive ? tab.color : "text-muted-foreground",
                      )}
                    />
                    {showDesignBadge && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white shadow-sm">
                        1
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  {tab.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Collapse / expand toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleLeftSidebar}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground"
              aria-label={leftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {leftSidebarOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            {leftSidebarOpen ? "Collapse" : "Expand"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ---- Content panel (280px, animated) ---- */}
      <AnimatePresence initial={false}>
        {leftSidebarOpen && (
          <motion.div
            key="left-sidebar-content"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex h-full flex-col overflow-hidden"
          >
            <div className="flex h-full w-[280px] flex-col">
              {/* Header */}
              <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5">
                <activeTab.icon className={cn("size-4", activeTab.color)} />
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold">{activeTab.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {activeTab.description}
                  </span>
                </div>
              </div>

              {/* Tab body (scrollable) */}
              <div className="flex-1 overflow-y-auto autumn-scroll">
                {leftSidebarTab === "resources" && <ResourcesTab />}
                {leftSidebarTab === "skills" && <SkillsTab />}
                {leftSidebarTab === "backends" && <BackendsTab />}
                {leftSidebarTab === "design" && <DesignTab />}
              </div>

              {/* Conversations sub-panel (collapsible bottom) */}
              <ConversationsPanel />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Tab 1: Resources -------------------------------------------------------

function ResourcesTab() {
  const projectFiles = useAutumnStore((s) => s.projectFiles);
  const removeProjectFile = useAutumnStore((s) => s.removeProjectFile);
  const addProjectFile = useAutumnStore((s) => s.addProjectFile);

  const [search, setSearch] = useState("");
  const [activeCats, setActiveCats] = useState<Set<ProjectFileCategory>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleCat = (cat: ProjectFileCategory) => {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const filtered = projectFiles.filter((f) => {
    if (activeCats.size > 0 && !activeCats.has(f.category)) return false;
    if (search.trim() && !f.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const handleFilesPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      addProjectFile({
        name: file.name,
        category: categoryFromExt(file.name),
        size: file.size,
        source: "upload",
      });
    }
    toast.success(`Added ${files.length} file${files.length === 1 ? "" : "s"}`);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast("Clipboard is empty");
        return;
      }
      addProjectFile({
        name: `pasted-${Date.now()}.txt`,
        category: "doc",
        size: new Blob([text]).size,
        source: "paste",
      });
      toast.success("Pasted text added as a file");
    } catch {
      toast.error("Couldn't read clipboard — browsers may block this.");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Files you add here are shared with Autumn&apos;s agents — Claude Code and
        the canvas terminals can read and use them. Drop in research, PDFs, brand
        assets or references.
      </p>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-7 text-xs"
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(CATEGORY_LABEL) as ProjectFileCategory[]).map((cat) => {
          const active = activeCats.has(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                active
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                  : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              {CATEGORY_LABEL[cat]}
            </button>
          );
        })}
      </div>

      {/* File list */}
      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/40 px-3 py-6 text-center text-[11px] text-muted-foreground">
            No files match.
          </div>
        ) : (
          filtered.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onRemove={() => removeProjectFile(file.id)}
            />
          ))
        )}
      </div>

      {/* Bottom upload actions */}
      <div className="mt-1 grid grid-cols-2 gap-1.5 border-t border-border/40 pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3" />
          Upload files
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => toast("Folder upload coming soon")}
        >
          <FolderPlus className="size-3" />
          Folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => toast("Cloud import coming soon")}
        >
          <Cloud className="size-3" />
          Cloud
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={handlePaste}
        >
          <Clipboard className="size-3" />
          Paste
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function FileRow({ file, onRemove }: { file: ProjectFile; onRemove: () => void }) {
  const Icon = CATEGORY_ICON[file.category];
  return (
    <div className="group flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5 transition-colors hover:bg-muted/40">
      <Icon className={cn("size-3.5 shrink-0", CATEGORY_COLOR[file.category])} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[11px] font-medium">{file.name}</span>
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <span>{humanSize(file.size)}</span>
          <span className="rounded-sm bg-muted/60 px-1 capitalize">{file.source}</span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Remove ${file.name}`}
      >
        <X className="size-3.5 text-muted-foreground hover:text-rose-400" />
      </button>
    </div>
  );
}

// ---- Tab 2: Skills ----------------------------------------------------------

function SkillsTab() {
  const skills = useAutumnStore((s) => s.skills);
  const toggleSkillInstall = useAutumnStore((s) => s.toggleSkillInstall);
  const addSkill = useAutumnStore((s) => s.addSkill);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const handleAddCustom = () => {
    if (!name.trim()) {
      toast("Skill name is required");
      return;
    }
    // addSkill expects Omit<Skill, "id" | "installed" | "installedAt">.
    // The store runtime generates an id if missing — we just pass name/desc/icon/color.
    addSkill({
      name: name.trim(),
      description: desc.trim() || "Custom skill.",
      icon: "✨",
      color: "text-amber-400",
    });
    setName("");
    setDesc("");
    setShowForm(false);
    toast.success(`Added skill "${name.trim()}"`);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Add a skill and every agent on this canvas can use it — mention it in a
        chat, or just name it in a terminal. It installs into your project so all
        agents pick it up.
      </p>

      <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto autumn-scroll -mx-1 px-1">
        {skills.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/40 px-3 py-6 text-center text-[11px] text-muted-foreground">
            No skills yet.
          </div>
        ) : (
          skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggle={() => toggleSkillInstall(skill.id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-border/40 pt-2">
        {showForm ? (
          <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/20 p-2">
            <Input
              placeholder="Skill name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-xs"
            />
            <Input
              placeholder="Short description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="h-7 text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => {
                  setShowForm(false);
                  setName("");
                  setDesc("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[11px] bg-amber-500 text-white hover:bg-amber-500"
                onClick={handleAddCustom}
              >
                Add skill
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowForm(true)}
          >
            <Plus className="size-3" />
            Add custom skill
          </Button>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, onToggle }: { skill: Skill; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 p-2 transition-colors hover:bg-muted/30">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-base",
          skill.color,
        )}
      >
        {skill.icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12px] font-medium leading-tight">{skill.name}</span>
        <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {skill.description}
        </p>
        <Button
          variant={skill.installed ? "outline" : "ghost"}
          size="sm"
          onClick={onToggle}
          className={cn(
            "mt-1 h-6 w-fit gap-1 text-[10px]",
            skill.installed &&
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
          )}
        >
          {skill.installed ? (
            <>
              <Check className="size-3" />
              Added
            </>
          ) : (
            <>
              <Plus className="size-3" />
              Add
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---- Tab 3: Backends --------------------------------------------------------

function BackendsTab() {
  const backends = useAutumnStore((s) => s.backends);
  const setWebsiteBackend = useAutumnStore((s) => s.setWebsiteBackend);
  const addBackend = useAutumnStore((s) => s.addBackend);
  const removeBackend = useAutumnStore((s) => s.removeBackend);

  const [websiteDraft, setWebsiteDraft] = useState(backends.website);
  const [websiteSaved, setWebsiteSaved] = useState(true);

  const dataOptions = ["Supabase", "Convex"];
  const aiOptions = ["Concur"];

  const handleWebsiteChange = (v: string) => {
    setWebsiteDraft(v);
    setWebsiteSaved(false);
  };

  const handleSaveWebsite = () => {
    setWebsiteBackend(websiteDraft.trim() || "localhost:3000");
    setWebsiteSaved(true);
    toast.success("Website backend saved");
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Connect backends so every agent can reach the same data, AI, and live
        website.
      </p>

      {/* Website */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Globe /> Website
        </div>
        <div className="flex gap-1.5">
          <Input
            value={websiteDraft}
            onChange={(e) => handleWebsiteChange(e.target.value)}
            placeholder="localhost:3000"
            className="h-7 flex-1 font-mono text-[11px]"
          />
          <Button
            variant="default"
            size="sm"
            className="h-7 bg-amber-500 px-2 text-[10px] text-white hover:bg-amber-500"
            onClick={handleSaveWebsite}
            disabled={websiteSaved}
          >
            {websiteSaved ? (
              <>
                <Check className="size-3" />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </section>

      {/* DATA */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Database className="size-3" /> Data
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dataOptions.map((name) => {
            const connected = backends.data.includes(name);
            return (
              <Button
                key={name}
                variant="outline"
                size="sm"
                disabled={connected}
                onClick={() => {
                  addBackend("data", name);
                  toast.success(`${name} connected`);
                }}
                className={cn(
                  "h-7 gap-1 text-[11px]",
                  connected && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                )}
              >
                {connected ? <Check className="size-3" /> : <Plus className="size-3" />}
                {name}
              </Button>
            );
          })}
        </div>
        {backends.data.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {backends.data.map((name) => (
              <ConnectedChip
                key={name}
                label={name}
                onRemove={() => {
                  removeBackend("data", name);
                  toast(`${name} removed`);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* AI */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3" /> AI
        </div>
        <div className="flex flex-wrap gap-1.5">
          {aiOptions.map((name) => {
            const connected = backends.ai.includes(name);
            return (
              <Button
                key={name}
                variant="outline"
                size="sm"
                disabled={connected}
                onClick={() => {
                  addBackend("ai", name);
                  toast.success(`${name} connected`);
                }}
                className={cn(
                  "h-7 gap-1 text-[11px]",
                  connected && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                )}
              >
                {connected ? <Check className="size-3" /> : <Plus className="size-3" />}
                {name}
              </Button>
            );
          })}
        </div>
        {backends.ai.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {backends.ai.map((name) => (
              <ConnectedChip
                key={name}
                label={name}
                onRemove={() => {
                  removeBackend("ai", name);
                  toast(`${name} removed`);
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Globe({ className }: { className?: string }) {
  // Local copy so we don't need an extra lucide import in the top bar list.
  return <Cloud className={cn("size-3", className)} />;
}

function ConnectedChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
      <span className="size-1 rounded-full bg-emerald-400" />
      {label}
      <button
        onClick={onRemove}
        className="text-emerald-300/60 hover:text-rose-400"
        aria-label={`Remove ${label}`}
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

// ---- Tab 4: Design ----------------------------------------------------------

function DesignTab() {
  const designMd = useAutumnStore((s) => s.designMd);
  const setDesignMd = useAutumnStore((s) => s.setDesignMd);
  const createStarterDesignMd = useAutumnStore((s) => s.createStarterDesignMd);

  const handleDownload = () => {
    const blob = new Blob([designMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "design.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded design.md");
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-sky-300">design.md</span>
        {designMd.trim().length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] text-emerald-300">
              <CheckCircle2 className="size-2.5" />
              Saved
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3" />
              .md
            </Button>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        One design.md for the whole canvas. Autumn reads it before building any UI
        — web, mobile or video — and conforms to it.
      </p>

      {designMd.trim().length === 0 ? (
        <div className="rounded-md border border-dashed border-border/50 bg-muted/10 p-4 text-center">
          <Palette className="mx-auto mb-2 size-5 text-sky-400/60" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            No design.md yet — and that&apos;s fine. We&apos;re reworking how the
            design system is set up, so for now builds run without one and each
            project picks its own theme.
          </p>
          <Button
            variant="default"
            size="sm"
            onClick={createStarterDesignMd}
            className="mt-3 h-7 gap-1 bg-amber-500 text-[11px] text-white hover:bg-amber-500"
          >
            <Plus className="size-3" />
            Create starter design.md
          </Button>
        </div>
      ) : (
        <Textarea
          value={designMd}
          onChange={(e) => setDesignMd(e.target.value)}
          spellCheck={false}
          className="min-h-[300px] resize-y bg-input/30 font-mono text-xs leading-relaxed"
        />
      )}
    </div>
  );
}

// ---- Conversations sub-panel ------------------------------------------------

interface ConversationGroup {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  messages: BusPulse[];
  last: BusPulse;
}

function ConversationsPanel() {
  const busHistory = useAutumnStore((s) => s.busHistory);
  const nodes = useAutumnStore((s) => s.nodes);
  const clearBusHistory = useAutumnStore((s) => s.clearBusHistory);

  const [open, setOpen] = useState(true);
  const [expandedEdge, setExpandedEdge] = useState<string | null>(null);
  const [hiddenEdges, setHiddenEdges] = useState<Set<string>>(new Set());

  const nodeName = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n?.name ?? id.slice(0, 8);
  };

  const groups: ConversationGroup[] = useMemo(() => {
    const map = new Map<string, ConversationGroup>();
    for (const p of busHistory) {
      if (hiddenEdges.has(p.edgeId)) continue;
      const existing = map.get(p.edgeId);
      if (existing) {
        existing.messages.push(p);
        if (p.ts > existing.last.ts) existing.last = p;
      } else {
        map.set(p.edgeId, {
          edgeId: p.edgeId,
          fromNodeId: p.fromNodeId,
          toNodeId: p.toNodeId,
          messages: [p],
          last: p,
        });
      }
    }
    // Sort by most recent
    return Array.from(map.values()).sort((a, b) => b.last.ts - a.last.ts);
  }, [busHistory, hiddenEdges]);

  const totalShown = groups.reduce((n, g) => n + g.messages.length, 0);

  const handleClearAll = () => {
    if (clearBusHistory) {
      clearBusHistory();
      setHiddenEdges(new Set());
      toast("Conversations cleared");
    } else {
      // Fallback: hide all locally
      const all = new Set<string>();
      for (const p of busHistory) all.add(p.edgeId);
      setHiddenEdges(all);
      toast("Cleared local view");
    }
  };

  return (
    <div className="border-t border-border/40 bg-sidebar/30">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
        <Cable className="size-3 text-amber-400" />
        <span className="text-[11px] font-medium">Conversations</span>
        {totalShown > 0 && (
          <Badge
            variant="outline"
            className="ml-auto h-4 px-1 text-[9px] border-amber-500/40 text-amber-300"
          >
            {totalShown}
          </Badge>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              {groups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-3 text-[10px] leading-relaxed text-muted-foreground">
                  No conversations yet. Connect two agents (chat or terminal) with
                  a line, and what they say to each other shows up here.
                </p>
              ) : (
                <>
                  <div className="mb-1 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearAll}
                      className="h-5 gap-1 px-1.5 text-[9px] text-muted-foreground hover:text-rose-400"
                    >
                      <Trash2 className="size-2.5" />
                      Clear all
                    </Button>
                  </div>
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto autumn-scroll">
                    {groups.map((g) => (
                      <ConversationRow
                        key={g.edgeId}
                        group={g}
                        nodeName={nodeName}
                        expanded={expandedEdge === g.edgeId}
                        onToggle={() =>
                          setExpandedEdge((cur) =>
                            cur === g.edgeId ? null : g.edgeId,
                          )
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConversationRow({
  group,
  nodeName,
  expanded,
  onToggle,
}: {
  group: ConversationGroup;
  nodeName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const fromName = nodeName(group.fromNodeId);
  const toName = nodeName(group.toNodeId);
  const preview =
    group.last.text.length > 60
      ? group.last.text.slice(0, 60) + "…"
      : group.last.text;

  return (
    <div className="rounded-md border border-border/40 bg-muted/20">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-muted/30"
      >
        {expanded ? (
          <ChevronDown className="size-2.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-2.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-[10px] font-medium text-amber-300/90">
          {fromName}
        </span>
        <ArrowRight className="size-2.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[10px] font-medium text-amber-300/90">
          {toName}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1 text-[9px] text-amber-300">
          {group.messages.length}
        </span>
      </button>
      {!expanded && (
        <div className="truncate px-2 pb-1.5 text-[9px] italic text-muted-foreground">
          {preview}
        </div>
      )}
      {expanded && (
        <div className="flex flex-col gap-1 border-t border-border/30 p-2">
          {group.messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="font-mono">
                  {new Date(m.ts).toLocaleTimeString()}
                </span>
                <Badge
                  variant="outline"
                  className="h-3 px-1 text-[8px] text-muted-foreground"
                >
                  {m.kind}
                </Badge>
              </div>
              <div className="whitespace-pre-wrap rounded bg-muted/30 px-1.5 py-1 text-[10px] leading-snug text-foreground/90">
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Tiny presentational bits ----------------------------------------------

