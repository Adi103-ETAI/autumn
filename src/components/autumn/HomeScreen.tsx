// Autumn — Home / Workspace launcher screen.
// Full-screen view shown when `appStage === "home"`. Clones October's home
// screen (NOTES.md §3, image 12): 4 entry-point cards + Recent grid.
//
// Visibility rule: renders ONLY when appStage === "home", returns null otherwise.

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import { useAutumnStore, type Workspace, type WorkspaceKind } from "@/lib/autumn/store";
import { decodeCanvasFromHash } from "@/lib/autumn/share-canvas";
import { toast } from "sonner";
import {
  Plus,
  Sparkles,
  FolderOpen,
  Github,
  GitBranch,
  Link as LinkIcon,
  Settings,
  User,
  X,
} from "lucide-react";

// ---------- helpers ----------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function basename(path: string): string {
  // Strip trailing slashes, then take the last segment.
  const cleaned = path.replace(/[\/\\]+$/, "");
  const seg = cleaned.split(/[\/\\]/).filter(Boolean).pop();
  return seg || cleaned || "Untitled folder";
}

function repoNameFromUrl(url: string): string {
  // Try to extract "<repo>" from common Git URL shapes:
  //   https://github.com/owner/repo(.git)
  //   git@github.com:owner/repo(.git)
  try {
    const m = url.match(/[:/]([^/]+?)(?:\.git)?(?:[?#].*)?$/);
    if (m && m[1]) return m[1];
  } catch {
    /* ignore */
  }
  return basename(url).replace(/\.git$/, "") || "cloned-repo";
}

function frameworkFromUrl(url: string): string | undefined {
  const u = url.toLowerCase();
  if (u.includes("next.js") || u.includes("nextjs") || u.includes("next-")) return "Next.js";
  if (u.includes("vite")) return "Vite";
  if (u.includes("astro")) return "Astro";
  if (u.includes("remix")) return "Remix";
  if (u.includes("svelte")) return "SvelteKit";
  if (u.includes("nuxt")) return "Nuxt";
  return undefined;
}

// Static lookup (avoids "component created during render" lint error).
const KIND_ICONS: Record<WorkspaceKind, typeof Plus> = {
  blank: Sparkles,
  folder: FolderOpen,
  repo: Github,
  link: LinkIcon,
};

// ---------- entry-point card model ----------

interface EntryPoint {
  key: "new" | "folder" | "repo" | "link";
  title: string;
  description: string;
  icon: typeof Plus;
}

const ENTRY_POINTS: EntryPoint[] = [
  {
    key: "new",
    title: "New workspace",
    description: "Start with a blank canvas",
    icon: Plus,
  },
  {
    key: "folder",
    title: "Open folder",
    description: "Open a local project directory",
    icon: FolderOpen,
  },
  {
    key: "repo",
    title: "Clone repo",
    description: "Clone a Git repository",
    icon: Github,
  },
  {
    key: "link",
    title: "Open from link",
    description: "Open a shared canvas URL",
    icon: LinkIcon,
  },
];

// ---------- main component ----------

export function HomeScreen() {
  const appStage = useAutumnStore((s) => s.appStage);
  const workspaces = useAutumnStore((s) => s.workspaces);
  const setAppStage = useAutumnStore((s) => s.setAppStage);
  const createBlankWorkspace = useAutumnStore((s) => s.createBlankWorkspace);
  const addWorkspace = useAutumnStore((s) => s.addWorkspace);
  const removeWorkspace = useAutumnStore((s) => s.removeWorkspace);
  const openWorkspace = useAutumnStore((s) => s.openWorkspace);
  const setShowAgentSetup = useAutumnStore((s) => s.setShowAgentSetup);
  const importCanvasState = useAutumnStore((s) => s.importCanvasState);

  // Dialog state — which dialog is open (null when none).
  const [openDialog, setOpenDialog] = useState<null | "folder" | "repo" | "link">(null);
  const [inputValue, setInputValue] = useState("");

  // Visibility rule: render ONLY when appStage === "home".
  if (appStage !== "home") return null;

  // ---- handlers ----

  const handleEntryClick = (key: EntryPoint["key"]) => {
    if (key === "new") {
      createBlankWorkspace();
      return;
    }
    // Reset input + open the corresponding dialog.
    setInputValue("");
    setOpenDialog(key);
  };

  const closeDialog = () => {
    setOpenDialog(null);
    setInputValue("");
  };

  const submitFolder = () => {
    const path = inputValue.trim();
    if (!path) {
      toast.error("Please enter a folder path");
      return;
    }
    const name = basename(path);
    const id = addWorkspace({
      name,
      kind: "folder",
      source: path,
      framework: undefined,
    });
    toast.success(`Opened folder: ${name}`, {
      description: "Folder access is simulated in the web demo.",
    });
    closeDialog();
    openWorkspace(id);
  };

  const submitRepo = () => {
    const url = inputValue.trim();
    if (!url) {
      toast.error("Please enter a Git URL");
      return;
    }
    const name = repoNameFromUrl(url);
    const framework = frameworkFromUrl(url);
    const id = addWorkspace({
      name,
      kind: "repo",
      source: url,
      framework,
    });
    toast.success(`Cloned repository: ${name}`, {
      description: "Cloning is simulated in the web demo.",
    });
    closeDialog();
    openWorkspace(id);
  };

  const submitLink = () => {
    const raw = inputValue.trim();
    if (!raw) {
      toast.error("Please enter a shared canvas URL");
      return;
    }
    // Extract the #canvas=... portion whether the user pasted a full URL
    // or just the hash fragment.
    let hash = raw;
    const hashIdx = raw.indexOf("#canvas=");
    if (hashIdx >= 0) hash = raw.slice(hashIdx);

    const state = decodeCanvasFromHash(hash);
    if (!state) {
      toast.error("Could not decode shared canvas", {
        description: "Make sure the URL contains a valid #canvas=… fragment.",
      });
      return;
    }
    importCanvasState(state);
    addWorkspace({
      name: state.canvasName || "Shared canvas",
      kind: "link",
      source: raw,
      framework: undefined,
      nodeCount: state.nodes.length,
    });
    toast.success(`Opened shared canvas: ${state.canvasName}`);
    closeDialog();
    setAppStage("workspace");
  };

  const handleRemove = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    removeWorkspace(id);
    toast(`Removed "${name}" from recent`, {
      description: "The workspace entry was removed from this list.",
    });
  };

  // ---- render ----

  return (
    <div className="relative min-h-screen flex flex-col bg-black">
      {/* Header bar */}
      <header className="relative z-10 h-14 shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-white/5 bg-black">
        <div className="flex items-center gap-2">
          <AutumnLogo size={28} priority />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Autumn
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 h-8"
            onClick={() =>
              toast("Sign in is not available in the web demo", {
                description: "Authentication is local-only in this build.",
              })
            }
          >
            <User className="size-3.5" />
            <span className="hidden sm:inline">Sign in</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground hover:bg-accent/60"
            title="Agent setup"
            aria-label="Agent setup"
            onClick={() => setShowAgentSetup(true)}
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* "Open or create" section */}
        <section aria-labelledby="open-or-create-heading">
          <h2
            id="open-or-create-heading"
            className="text-xl font-semibold text-foreground mb-4"
          >
            Open or create
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ENTRY_POINTS.map((entry, i) => (
              <motion.button
                key={entry.key}
                type="button"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.08, duration: 0.4, ease: "easeOut" }}
                onClick={() => handleEntryClick(entry.key)}
                className="group text-left rounded-xl border border-white/5 bg-[#1a202c] hover:border-violet-500/40 hover:bg-violet-500/5 p-5 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center size-10 shrink-0 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 transition-colors group-hover:bg-violet-500/15 group-hover:text-violet-300">
                    <entry.icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {entry.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {entry.description}
                    </div>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        {/* "Recent" section */}
        <section aria-labelledby="recent-heading" className="mt-10">
          <div className="mb-4">
            <h2
              id="recent-heading"
              className="text-xl font-semibold text-foreground"
            >
              Recent
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Workspaces, local projects, and shared canvases you&apos;ve opened
              appear in this grid.
            </p>
          </div>

          {workspaces.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 sm:p-10 flex flex-col items-center text-center"
            >
              <p className="text-sm text-muted-foreground mb-6">
                Your work will show up here
              </p>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <Button
                  size="sm"
                  className="gap-1.5 bg-violet-600 hover:bg-violet-500 text-white border-0"
                  onClick={() => createBlankWorkspace()}
                >
                  <Plus className="size-4" />
                  New workspace
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border border-white/10 bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => handleEntryClick("folder")}
                >
                  <FolderOpen className="size-4" />
                  Open folder
                </Button>
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {workspaces.map((ws, i) => (
                <WorkspaceCard
                  key={ws.id}
                  workspace={ws}
                  index={i}
                  onOpen={() => openWorkspace(ws.id)}
                  onRemove={(e) => handleRemove(e, ws.id, ws.name)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer (sticky to bottom) */}
      <footer className="relative z-10 mt-auto shrink-0 border-t border-white/5 bg-black/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-between text-[11px] text-muted-foreground/70">
          <span>Autumn v0.1</span>
          <span className="hidden sm:inline">Built for whoever ships.</span>
        </div>
      </footer>

      {/* ---------- dialogs ---------- */}

      {/* Open folder */}
      <Dialog open={openDialog === "folder"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="size-4 text-violet-400" />
              Open folder
            </DialogTitle>
            <DialogDescription>
              Enter the absolute path of a local project directory. Folder access
              is simulated in the web demo.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="/home/you/projects/my-app"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitFolder();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              className="gap-1.5 bg-violet-600 hover:bg-violet-500 text-white border-0"
              onClick={submitFolder}
            >
              <FolderOpen className="size-4" />
              Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone repo */}
      <Dialog open={openDialog === "repo"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="size-4 text-violet-400" />
              Clone repository
            </DialogTitle>
            <DialogDescription>
              Paste a Git URL. Cloning is simulated in the web demo.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="https://github.com/owner/repo.git"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRepo();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              className="gap-1.5 bg-violet-600 hover:bg-violet-500 text-white border-0"
              onClick={submitRepo}
            >
              <GitBranch className="size-4" />
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open from link */}
      <Dialog open={openDialog === "link"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="size-4 text-violet-400" />
              Open from link
            </DialogTitle>
            <DialogDescription>
              Paste a shared Autumn canvas URL. The{" "}
              <code className="text-[11px] bg-muted/40 px-1 py-0.5 rounded">
                #canvas=…
              </code>{" "}
              fragment will be decoded.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="https://autumn.app/#canvas=…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitLink();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              className="gap-1.5 bg-violet-600 hover:bg-violet-500 text-white border-0"
              onClick={submitLink}
            >
              <LinkIcon className="size-4" />
              Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- workspace card (recent grid) ----------

function WorkspaceCard({
  workspace,
  index,
  onOpen,
  onRemove,
}: {
  workspace: Workspace;
  index: number;
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  const Icon = KIND_ICONS[workspace.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.05, duration: 0.35, ease: "easeOut" }}
      onClick={onOpen}
      className="group relative rounded-lg border border-white/5 bg-[#1a202c] hover:border-violet-500/40 hover:bg-violet-500/5 p-4 transition-all cursor-pointer"
    >
      {/* Remove (X) button on hover */}
      <button
        type="button"
        onClick={onRemove}
        title="Remove from recent"
        aria-label={`Remove ${workspace.name} from recent`}
        className="absolute top-2.5 right-2.5 size-6 rounded-md flex items-center justify-center bg-background/80 border border-border/50 text-muted-foreground hover:text-rose-400 hover:border-rose-500/40 opacity-0 group-hover:opacity-100 transition-all"
      >
        <X className="size-3.5" />
      </button>

      {/* Top row: kind icon + name */}
      <div className="flex items-center gap-2.5 pr-6">
        <div className="flex items-center justify-center size-7 shrink-0 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 text-sm font-medium text-foreground truncate">
          {workspace.name}
        </div>
      </div>

      {/* Second row: framework badge + relative time */}
      <div className="flex items-center gap-2 mt-3 pl-9">
        {workspace.framework ? (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-border/60 text-muted-foreground">
            {workspace.framework}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-border/60 text-muted-foreground capitalize">
            {workspace.kind}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground/70">
          {timeAgo(workspace.lastOpenedAt)}
        </span>
      </div>
    </motion.div>
  );
}
