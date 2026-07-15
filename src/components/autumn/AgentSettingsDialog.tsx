// Autumn — Agent Settings dialog.
// Edit a chat node's name, harness, model, effort, and permission.
// Backed by the set_chat_option DO_ACTION.

"use client";

import { useState, useEffect } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { HARNESS_LIST, HARNESS_META } from "@/lib/autumn/harness-meta";
import type { AgentHarness, PermissionLevel } from "@/lib/autumn/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Settings2, Bot, Zap, Shield, Cpu } from "lucide-react";

interface AgentSettingsDialogProps {
  nodeId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AgentSettingsDialog({
  nodeId,
  open,
  onOpenChange,
}: AgentSettingsDialogProps) {
  const node = useAutumnStore((s) =>
    nodeId ? s.nodes.find((n) => n.id === nodeId) : null,
  );
  const updateNode = useAutumnStore((s) => s.updateNode);
  const updateNodeData = useAutumnStore((s) => s.updateNodeData);

  const [name, setName] = useState("");
  const [harness, setHarness] = useState<AgentHarness>("claude-code");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<"low" | "medium" | "high">("medium");
  const [permission, setPermission] =
    useState<PermissionLevel>("ask");

  useEffect(() => {
    if (!node || node.kind !== "chat") return;
    const d = node.data as {
      harness: AgentHarness;
      model?: string;
      effort?: "low" | "medium" | "high";
      permission?: PermissionLevel;
    };
    setName(node.name);
    setHarness(d.harness);
    setModel(d.model ?? HARNESS_META[d.harness].defaultModel);
    setEffort(d.effort ?? "medium");
    setPermission(d.permission ?? "ask");
  }, [node, open]);

  if (!node || node.kind !== "chat") {
    return null;
  }

  const persona = PERSONA_BY_ID[
    (node.data as { personaId: string }).personaId
  ];
  const harnessMeta = HARNESS_META[harness];

  const handleHarnessChange = (h: AgentHarness) => {
    setHarness(h);
    setModel(HARNESS_META[h].defaultModel);
  };

  const handleSave = () => {
    updateNode(node.id, { name });
    updateNodeData(node.id, { harness, model, effort, permission });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-amber-400" />
            Agent settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure {persona?.name ?? node.name}'s harness, model, effort, and
            permission level.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Persona preview */}
          <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 p-3">
            <div
              className="size-10 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow"
              style={{ background: persona?.color }}
            >
              {persona?.glyph ?? <Bot className="size-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{persona?.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {persona?.specialty}
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-name" className="text-xs">
              Display name
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Harness */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Cpu className="size-3" />
              Harness
            </Label>
            <Select
              value={harness}
              onValueChange={(v) => handleHarnessChange(v as AgentHarness)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HARNESS_LIST.map((h) => (
                  <SelectItem key={h.id} value={h.id} className="text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: h.color }}
                      />
                      {h.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {harnessMeta.models.map((m) => (
                  <SelectItem key={m} value={m} className="text-sm font-mono">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Effort */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Zap className="size-3" />
              Effort
            </Label>
            <ToggleGroup
              type="single"
              value={effort}
              onValueChange={(v) => v && setEffort(v as "low" | "medium" | "high")}
              className="justify-start"
            >
              <ToggleGroupItem value="low" className="text-xs h-7">
                Low
              </ToggleGroupItem>
              <ToggleGroupItem value="medium" className="text-xs h-7">
                Medium
              </ToggleGroupItem>
              <ToggleGroupItem value="high" className="text-xs h-7">
                High
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Permission */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Shield className="size-3" />
              Permission
            </Label>
            <ToggleGroup
              type="single"
              value={permission}
              onValueChange={(v) =>
                v && setPermission(v as PermissionLevel)
              }
              className="justify-start"
            >
              <ToggleGroupItem value="ask" className="text-xs h-7">
                Ask
              </ToggleGroupItem>
              <ToggleGroupItem value="auto" className="text-xs h-7">
                Auto
              </ToggleGroupItem>
              <ToggleGroupItem value="yolo" className="text-xs h-7">
                Yolo
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[10px] text-muted-foreground">
              {permission === "ask" && "Confirms each tool use before running."}
              {permission === "auto" && "Auto-approves safe file edits."}
              {permission === "yolo" && "No confirmation — runs everything."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Settings2 className="size-3.5" />
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
