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
  open: { icon: Circle, color: "text-zinc-400", label: "Open", accent: "oklch(0.7 0.02 55)" },
  blocked: { icon: Lock, color: "text-rose-400", label: "Blocked", accent: "oklch(0.65 0.22 16)" },
  in_progress: { icon: Clock, color: "text-amber-400", label: "In progress", accent: "oklch(0.78 0.18 55)" },
  done: { icon: CheckCircle2, color: "text-emerald-400", label: "Done", accent: "oklch(0.72 0.19 150)" },
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
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      {total > 0 && (
        <div className="px-3 pt-2.5 pb-1.5 border-b border-border/50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Board progress
            </span>
            <span className="text-[10px] font-mono text-emerald-400">
              {pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500/70 to-emerald-400 task-progress-fill rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              {done} done
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-400" />
              {inProgress} active
            </span>
            {blocked > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-rose-400" />
                {blocked} blocked
              </span>
            )}
            <span className="ml-auto text-muted-foreground/60">
              {done}/{total}
            </span>
          </div>
        </div>
      )}

      {/* Stats (legacy — kept for visual density when board is empty) */}
      {total === 0 && (
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
      )}

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
                "rounded-lg border bg-card/60 p-2.5 pl-3 space-y-1.5 transition-colors task-card-accent",
                t.status === "done"
                  ? "border-emerald-500/20 opacity-70"
                  : "border-border/50 hover:border-border",
              )}
              style={{ "--task-accent": meta.accent } as React.CSSProperties}
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
          <div className="text-center text-xs text-muted-foreground py-12 empty-cta rounded-lg">
            <div className="size-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <Plus className="size-5 text-amber-400/70" />
            </div>
            <div className="font-medium text-foreground/80 mb-1">No tasks on the board</div>
            <div className="text-[10px] text-muted-foreground/70 leading-relaxed max-w-[220px] mx-auto">
              Add a task below, or ask the Commander to{" "}
              <span className="text-amber-300/80">"add a task to the board"</span>.
            </div>
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
