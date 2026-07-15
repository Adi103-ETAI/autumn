// Autumn — Task Board panel.
// Shows the shared task board (Octoplan / "the board") with dependency edges.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Circle,
  Clock,
  Lock,
  Plus,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";
import { runAgentForNode } from "@/lib/autumn/agent-runner";

const STATUS_META = {
  open: { icon: Circle, color: "text-zinc-400", label: "Open" },
  blocked: { icon: Lock, color: "text-rose-400", label: "Blocked" },
  in_progress: { icon: Clock, color: "text-amber-400", label: "In progress" },
  done: { icon: CheckCircle2, color: "text-emerald-400", label: "Done" },
} as const;

export function TaskBoard() {
  const tasks = useAutumnStore((s) => s.tasks);
  const nodes = useAutumnStore((s) => s.nodes);
  const addTask = useAutumnStore((s) => s.addTask);
  const completeTask = useAutumnStore((s) => s.completeTask);
  const claimTask = useAutumnStore((s) => s.claimTask);

  const [newTask, setNewTask] = useState("");
  const [showInput, setShowInput] = useState(false);

  const sorted = [...tasks].sort((a, b) => a.seq - b.seq);
  const done = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;

  return (
    <div className="flex flex-col h-full">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 p-3 border-b border-border/50">
        <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 px-2 py-1.5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            Done
          </div>
          <div className="text-base font-semibold text-emerald-400">{done}</div>
        </div>
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 px-2 py-1.5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            Active
          </div>
          <div className="text-base font-semibold text-amber-400">{inProgress}</div>
        </div>
        <div className="rounded-md bg-rose-500/5 border border-rose-500/20 px-2 py-1.5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            Blocked
          </div>
          <div className="text-base font-semibold text-rose-400">{blocked}</div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto autumn-scroll p-3 space-y-2">
        {sorted.map((t) => {
          const meta = STATUS_META[t.status as keyof typeof STATUS_META] ?? STATUS_META.open;
          const Icon = meta.icon;
          const assignee = t.assigneeId
            ? nodes.find((n) => n.id === t.assigneeId)
            : null;
          const persona = assignee
            ? PERSONA_BY_ID[
                (assignee.data as { personaId?: string }).personaId ?? ""
              ]
            : null;
          return (
            <div
              key={t.id}
              className={cn(
                "rounded-lg border bg-card/60 p-2.5 space-y-1.5 transition-colors",
                t.status === "done"
                  ? "border-emerald-500/20 opacity-70"
                  : "border-border/50 hover:border-border",
              )}
            >
              <div className="flex items-start gap-2">
                <Icon className={cn("size-4 mt-0.5 shrink-0", meta.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      t{t.seq}
                    </span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {meta.label}
                    </Badge>
                    {t.afterIds.length > 0 && (
                      <span className="text-[9px] text-muted-foreground">
                        after t{t.afterIds.join(", t")}
                      </span>
                    )}
                  </div>
                  <div
                    className={cn(
                      "text-xs mt-0.5",
                      t.status === "done" && "line-through text-muted-foreground",
                    )}
                  >
                    {t.description}
                  </div>
                  {assignee && persona && (
                    <div className="flex items-center gap-1 mt-1">
                      <div
                        className="size-3 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ background: persona.color }}
                      >
                        {persona.glyph}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        claimed by {assignee.name}
                      </span>
                    </div>
                  )}
                  {t.note && (
                    <div className="text-[10px] text-muted-foreground italic mt-1">
                      ↳ {t.note}
                    </div>
                  )}
                </div>
              </div>
              {t.status !== "done" && (
                <div className="flex items-center gap-1 pl-6">
                  {t.status === "open" && !assignee && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] gap-1"
                      onClick={() => {
                        // claim for the first idle chat node
                        const idle = nodes.find(
                          (n) =>
                            n.kind === "chat" &&
                            (n.data as { status?: string }).status === "idle",
                        );
                        if (idle) {
                          claimTask(t.id, idle.id);
                          void runAgentForNode(idle.id, t.description);
                        }
                      }}
                    >
                      <PlayCircle className="size-3" />
                      Claim & run
                    </Button>
                  )}
                  {t.status === "in_progress" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] gap-1 text-emerald-400"
                      onClick={() => completeTask(t.id, "Marked complete.")}
                    >
                      <CheckCircle2 className="size-3" />
                      Complete
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-12">
            No tasks on the board yet.
          </div>
        )}
      </div>

      {/* Add task */}
      <div className="border-t border-border/50 p-3">
        {showInput ? (
          <div className="space-y-2">
            <textarea
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Describe the task…"
              className="w-full min-h-[50px] max-h-[100px] resize-none rounded-md bg-muted/30 border border-border/50 px-2 py-1.5 text-xs"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (newTask.trim()) {
                    addTask(newTask.trim());
                    setNewTask("");
                    setShowInput(false);
                  }
                }}
              >
                Add task
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setShowInput(false);
                  setNewTask("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs gap-1.5 border-dashed"
            onClick={() => setShowInput(true)}
          >
            <Plus className="size-3.5" />
            Add task to the board
          </Button>
        )}
      </div>
    </div>
  );
}
