// Autumn — AiFinderOverlay.
// A natural-language file finder overlay (October's "AI Finder"). Searches
// across project files, canvas nodes, skills, and tasks via the store's
// `runAiFinder` action. Clicking a node result centers it on the canvas via
// the `autumn:center-node` custom event; other kinds just close the overlay.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAutumnStore, type AiFinderResult } from "@/lib/autumn/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Search,
  File,
  Bot,
  Sparkles,
  ListChecks,
  CornerDownLeft,
  ArrowDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FinderKind = AiFinderResult["kind"];

const KIND_META: Record<
  FinderKind,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string; // text color
    bg: string; // icon tile bg + border
    label: string;
  }
> = {
  file: {
    icon: File,
    color: "text-violet-300",
    bg: "bg-violet-500/10 border-violet-500/30",
    label: "file",
  },
  node: {
    icon: Bot,
    color: "text-emerald-300",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    label: "agent",
  },
  skill: {
    icon: Sparkles,
    color: "text-violet-300",
    bg: "bg-violet-500/10 border-violet-500/30",
    label: "skill",
  },
  task: {
    icon: ListChecks,
    color: "text-sky-300",
    bg: "bg-sky-500/10 border-sky-500/30",
    label: "task",
  },
};

const SUGGESTED_SEARCHES = ["brand", "agent", "skill", "design"];

export function AiFinderOverlay() {
  const open = useAutumnStore((s) => s.aiFinderOpen);
  const setOpen = useAutumnStore((s) => s.setAiFinderOpen);
  const runAiFinder = useAutumnStore((s) => s.runAiFinder);
  const results = useAutumnStore((s) => s.aiFinderResults);
  const storeQuery = useAutumnStore((s) => s.aiFinderQuery);

  const inputRef = useRef<HTMLInputElement>(null);
  const [localQ, setLocalQ] = useState(storeQuery);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the overlay opens, seed the input from the store and focus it.
  useEffect(() => {
    if (open) {
      setLocalQ(storeQuery);
      setActiveIdx(0);
      // Defer focus so the input is mounted before we focus it.
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, storeQuery]);

  // Debounced search: 250ms after the user stops typing, run the finder.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Show a tiny spinner as soon as the query changes (non-empty) so the
    // user knows the search is pending.
    setIsSearching(localQ.trim().length > 0);
    debounceRef.current = setTimeout(() => {
      runAiFinder(localQ);
      setIsSearching(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localQ, open, runAiFinder]);

  // Reset the active index whenever the result set changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  const trimmed = localQ.trim();
  const hasQuery = trimmed.length > 0;
  const hasResults = results.length > 0;

  const selectResult = (r: AiFinderResult) => {
    if (r.kind === "node") {
      window.dispatchEvent(
        new CustomEvent("autumn:center-node", { detail: { id: r.id } }),
      );
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results[0];
      if (first) selectResult(first);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    }
  };

  const suggestions = useMemo(() => SUGGESTED_SEARCHES, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton
        className={cn(
          "max-w-2xl p-0 gap-0 overflow-hidden",
          "border-violet-500/30 bg-card/95 backdrop-blur-xl",
          "shadow-2xl shadow-violet-500/10",
        )}
        onKeyDown={(e) => {
          // Let Escape bubble to the Dialog (handled by Radix).
          if (e.key === "Escape") return;
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>AI Finder</DialogTitle>
          <DialogDescription>
            Search files, agents, skills, and tasks across the workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 pr-12">
          <Search className="size-4 text-violet-400 shrink-0" />
          <Input
            ref={inputRef}
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find files, agents, skills, tasks... (e.g. 'brand logo', 'Atlas', 'website cloner')"
            className={cn(
              "h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0",
              "text-sm placeholder:text-muted-foreground/70",
            )}
            aria-label="AI Finder query"
            spellCheck={false}
            autoComplete="off"
          />
          {isSearching ? (
            <Loader2 className="size-4 animate-spin text-violet-400/70 shrink-0" />
          ) : (
            hasResults && (
              <Badge
                variant="outline"
                className="text-[9px] h-5 px-1.5 font-mono shrink-0 badge-gradient-outline"
              >
                {results.length}
              </Badge>
            )
          )}
        </div>

        {/* Body: results / empty states */}
        <div className="max-h-96 overflow-y-auto autumn-scroll">
          {!hasQuery ? (
            /* No query yet — show suggested searches */
            <div className="px-4 py-6 flex flex-col items-center text-center gap-3">
              <div className="size-10 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
                <Search className="size-4 text-violet-300" />
              </div>
              <div className="text-sm text-muted-foreground">
                Ask anything — files, agents, skills, tasks.
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mt-1">
                Suggested searches
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {suggestions.map((s) => (
                  <motion.button
                    key={s}
                    whileHover={{ y: -1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    onClick={() => setLocalQ(s)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      "border border-violet-500/30 bg-violet-500/5",
                      "text-violet-200 hover:text-violet-100",
                      "hover:bg-violet-500/10 hover:border-violet-500/50",
                      "transition-colors",
                    )}
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : !hasResults ? (
            /* Query but no results */
            <div className="px-4 py-10 flex flex-col items-center text-center gap-2">
              <div className="size-9 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center">
                <Search className="size-4 text-muted-foreground/50" />
              </div>
              <div className="text-sm text-muted-foreground">
                No matches. Try a different term.
              </div>
              <div className="text-[10px] text-muted-foreground/60 font-mono">
                “{trimmed}”
              </div>
            </div>
          ) : (
            /* Results list */
            <ul className="py-1">
              {results.map((r, i) => {
                const meta = KIND_META[r.kind];
                const Icon = meta.icon;
                const pct = Math.max(4, Math.round(r.score * 100));
                const isActive = i === activeIdx;
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <motion.button
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.15,
                        delay: Math.min(i * 0.02, 0.2),
                      }}
                      whileHover={{ y: -1 }}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => selectResult(r)}
                      className={cn(
                        "w-full text-left flex items-start gap-3 px-4 py-2.5 transition-colors",
                        isActive
                          ? "bg-violet-500/12 ring-1 ring-inset ring-violet-500/25"
                          : "hover:bg-accent/30",
                      )}
                    >
                      {/* Kind icon tile */}
                      <div
                        className={cn(
                          "size-7 shrink-0 rounded-md flex items-center justify-center border",
                          meta.bg,
                        )}
                      >
                        <Icon className={cn("size-3.5", meta.color)} />
                      </div>

                      {/* Path + snippet + relevance bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-mono text-[11px] truncate",
                              isActive ? "text-violet-100" : "text-foreground/90",
                            )}
                          >
                            {r.path}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[8px] h-3.5 px-1 uppercase tracking-wide shrink-0",
                              meta.color,
                              "border-current/30",
                            )}
                          >
                            {meta.label}
                          </Badge>
                        </div>
                        {r.snippet && (
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {r.snippet}
                          </div>
                        )}
                        {/* Relevance bar */}
                        <div className="mt-1.5 h-1 w-full rounded-full bg-border/40 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-violet-500 to-orange-400 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Active-row affordance */}
                      {isActive && (
                        <CornerDownLeft className="size-3 text-violet-400 shrink-0 mt-1" />
                      )}
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-3 text-[9px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <ArrowDown className="size-2.5" />
            navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-2.5" />
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono">esc</kbd>
            close
          </span>
          <div className="flex-1" />
          <span className="font-mono text-violet-400/70">AI Finder</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
