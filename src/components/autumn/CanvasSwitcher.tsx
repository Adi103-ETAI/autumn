// Autumn — Canvas Switcher dialog.
// Lists all saved canvases from the DB, lets the user load or delete them,
// and shows the current canvas's save status.

"use client";

import { useEffect, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderOpen,
  Trash2,
  Clock,
  FileBox,
  Loader2,
  Plus,
  Copy,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SavedCanvas {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
}

export function CanvasSwitcher({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const loadCanvas = useAutumnStore((s) => s.loadCanvas);
  const resetCanvas = useAutumnStore((s) => s.resetCanvas);
  const duplicateCanvas = useAutumnStore((s) => s.duplicateCanvas);
  const currentId = useAutumnStore((s) => s.canvasId);

  const [list, setList] = useState<SavedCanvas[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/canvas", { method: "GET" });
      if (!r.ok) throw new Error(`list ${r.status}`);
      const j = await r.json();
      setList(j.canvases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const handleLoad = async (id: string) => {
    await loadCanvas(id);
    onOpenChange(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/canvas?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      void refresh();
    } catch {
      /* ignore */
    }
  };

  const handleDuplicate = async (id: string, name: string) => {
    await duplicateCanvas(id);
    void refresh();
  };

  const handleNew = () => {
    resetCanvas();
    useAutumnStore.setState({
      canvasId: `canvas-${Date.now()}`,
      canvasName: "Untitled Canvas",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="size-4 text-amber-400" />
            Canvases
          </DialogTitle>
          <DialogDescription className="text-xs">
            Load a saved canvas, start a new one, or delete old ones. Canvases
            are persisted in the local Autumn database.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleNew}
          >
            <Plus className="size-3.5" />
            New canvas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Clock className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-2 py-1.5">
            {error}
          </div>
        )}

        <ScrollArea className="h-[320px] rounded-md border border-border/40">
          {list.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <FileBox className="size-8 text-muted-foreground/30 mb-2" />
              <div className="text-sm text-muted-foreground">
                No saved canvases yet.
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-1">
                Click <strong>Save</strong> in the top bar to persist the
                current canvas.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent/30 transition-colors group"
                >
                  <div className="size-8 rounded-md bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                    <FileBox className="size-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      updated{" "}
                      {formatDistanceToNow(new Date(c.updatedAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                  {c.id === currentId && (
                    <Badge
                      variant="outline"
                      className="text-[9px] h-5 px-1.5 border-emerald-500/30 text-emerald-400"
                    >
                      current
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => void handleLoad(c.id)}
                    aria-label="Load canvas"
                  >
                    <FolderOpen className="size-3.5 text-amber-400" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => void handleDuplicate(c.id, c.name)}
                    aria-label="Duplicate canvas"
                  >
                    <Copy className="size-3.5 text-sky-400" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-rose-400"
                    onClick={() => void handleDelete(c.id)}
                    aria-label="Delete canvas"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
