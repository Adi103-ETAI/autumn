// Autumn — Export / Import canvas as JSON.
// Lets the user download the current canvas as a .json file, or paste/upload
// a previously exported JSON to restore it.

"use client";

import { useState, useRef } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Upload, Copy, Check, FileJson } from "lucide-react";
import { toast } from "sonner";

export function ExportImportDialog() {
  const open = useAutumnStore((s) => s.showExportDialog);
  const setOpen = useAutumnStore((s) => s.setShowExportDialog);
  const exportCanvas = useAutumnStore((s) => s.exportCanvas);
  const importCanvas = useAutumnStore((s) => s.importCanvas);
  const canvasName = useAutumnStore((s) => s.canvasName);
  const nodeCount = useAutumnStore((s) => s.nodes.length);
  const edgeCount = useAutumnStore((s) => s.edges.length);

  const [tab, setTab] = useState<"export" | "import">("export");
  const [json, setJson] = useState("");
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const generate = () => {
    setJson(exportCanvas());
  };

  const handleDownload = () => {
    if (!json) generate();
    const blob = new Blob([json || exportCanvas()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${canvasName.toLowerCase().replace(/\s+/g, "-") || "canvas"}.autumn.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Canvas exported", {
      description: `Downloaded ${nodeCount} nodes and ${edgeCount} edges as JSON.`,
    });
  };

  const handleCopy = async () => {
    if (!json) generate();
    try {
      await navigator.clipboard.writeText(json || exportCanvas());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard not available");
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      setImportText(text);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!importText.trim()) {
      toast.error("Paste or upload a JSON file first");
      return;
    }
    const ok = importCanvas(importText);
    if (ok) {
      toast.success("Canvas imported", {
        description: "The canvas has been loaded into the workshop.",
      });
      setOpen(false);
      setImportText("");
    } else {
      toast.error("Import failed", {
        description: "The JSON doesn't look like an Autumn canvas export.",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setJson("");
          setImportText("");
        }
      }}
    >
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="size-4 text-violet-400" />
            Export / Import canvas
          </DialogTitle>
          <DialogDescription className="text-xs">
            Download the current canvas as a portable JSON file, or load one
            you've saved. The format is open and human-readable.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "export" | "import")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export" className="gap-1.5 text-xs">
              <Download className="size-3" />
              Export
            </TabsTrigger>
            <TabsTrigger value="import" className="gap-1.5 text-xs">
              <Upload className="size-3" />
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="space-y-2 mt-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge2 label="nodes" value={nodeCount} />
              <Badge2 label="edges" value={edgeCount} />
              <Badge2 label="format" value="autumn.v1" />
            </div>
            {!json ? (
              <Button size="sm" onClick={generate} className="gap-1.5">
                <FileJson className="size-3.5" />
                Generate JSON preview
              </Button>
            ) : (
              <>
                <Textarea
                  value={json}
                  readOnly
                  className="font-mono text-[10px] h-[280px] resize-none bg-muted/30"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleDownload} className="gap-1.5">
                    <Download className="size-3.5" />
                    Download .json
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopy}
                    className="gap-1.5"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={generate}
                    className="ml-auto"
                  >
                    Regenerate
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="import" className="space-y-2 mt-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="size-3.5" />
                Choose file…
              </Button>
              <span className="text-[10px] text-muted-foreground">
                or paste JSON below
              </span>
            </div>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{ "app": "autumn", "canvas": { "nodes": [...], "edges": [...] } }'
              className="font-mono text-[10px] h-[280px] resize-none bg-muted/30"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleImport}
                disabled={!importText.trim()}
                className="gap-1.5"
              >
                <Upload className="size-3.5" />
                Import into workshop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setImportText("")}
                disabled={!importText}
              >
                Clear
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Badge2({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}
