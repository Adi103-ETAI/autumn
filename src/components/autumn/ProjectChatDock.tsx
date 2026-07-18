// Autumn — Floating "Project chat" launcher + panel above the dock.
// Mirrors the October Desktop layout: a pill button above the dock that
// opens a centered chat panel (header + message area + input bar).
// Reuses the commander chat store + /api/commander send flow.

"use client";

import { useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import type { CanvasSnapshot, CommanderResult } from "@/lib/autumn/types";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import { renderPlanText } from "@/components/autumn/CommanderPanel";
import {
  Send,
  Pencil,
  ChevronDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function ProjectChatDock() {
  const open = useAutumnStore((s) => s.projectChatOpen);
  const minimized = useAutumnStore((s) => s.projectChatMinimized);
  const toggle = useAutumnStore((s) => s.toggleProjectChat);
  const setOpen = useAutumnStore((s) => s.setProjectChatOpen);
  const setMinimized = useAutumnStore((s) => s.setProjectChatMinimized);

  // Collapsed launcher pill (shown when fully closed OR minimized).
  const collapsed = !open || minimized;

  return (
    <div className="pointer-events-none absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2">
      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-500/40 bg-card/80 px-3.5 py-2 text-sm shadow-lg backdrop-blur-xl transition-colors hover:bg-card"
          style={{
            boxShadow:
              "0 8px 24px -8px oklch(0.78 0.18 55 / 0.18), 0 0 0 1px oklch(0.78 0.18 55 / 0.08)",
          }}
          title="Open Project chat"
        >
          <AutumnLogo size={18} />
          <span className="font-medium text-foreground">Project chat</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_oklch(0.7_0.2_150/0.8)]" />
            whole workspace
          </span>
        </button>
      ) : (
        <ProjectChatPanel
          onClose={() => setOpen(false)}
          onMinimize={() => setMinimized(true)}
        />
      )}
    </div>
  );
}

function ProjectChatPanel({
  onClose,
  onMinimize,
}: {
  onClose: () => void;
  onMinimize: () => void;
}) {
  const messages = useAutumnStore((s) => s.commanderMessages);
  const isThinking = useAutumnStore((s) => s.isCommanderThinking);
  const pushMessage = useAutumnStore((s) => s.pushCommanderMessage);
  const updateMessage = useAutumnStore((s) => s.updateCommanderMessage);
  const setThinking = useAutumnStore((s) => s.setCommanderThinking);
  const applyPlan = useAutumnStore((s) => s.applyCommanderPlan);
  const recentActions = useAutumnStore((s) => s.recentActions);
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, isThinking]);

  const buildSnapshot = (): CanvasSnapshot => ({
    nodes: nodes
      .filter((n) => n.kind === "chat")
      .map((n) => {
        const d = n.data as {
          status?: string;
          harness?: string;
          doing?: string;
          personaId?: string;
        };
        return {
          id: n.id,
          name: n.name,
          status: d.status ?? "idle",
          harness: d.harness ?? "claude-code",
          doing: d.doing ?? "",
          personaId: d.personaId ?? "",
        };
      }),
    connections: edges
      .filter((e) => e.kind === "bus")
      .map((e) => ({ from: e.source, to: e.target })),
  });

  const send = async (overrideCmd?: string) => {
    const cmd = (overrideCmd ?? input).trim();
    if (!cmd || isThinking) return;
    setInput("");
    pushMessage({ role: "user", text: cmd });
    const pendingId = pushMessage({
      role: "commander",
      text: "",
      pending: true,
    });
    setThinking(true);

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch("/api/commander", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          canvas: buildSnapshot(),
          lastTurn:
            messages.length > 0
              ? messages[messages.length - 1].text
              : undefined,
          recentActions,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`commander ${r.status}`);
      const plan = (await r.json()) as CommanderResult;
      updateMessage(pendingId, {
        text: renderPlanText(plan),
        plan,
        pending: false,
      });
      if (plan.kind === "steps") {
        applyPlan(plan);
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      updateMessage(pendingId, {
        text: aborted
          ? "⚠️ The Commander took too long to respond. Please try again."
          : `⚠️ Couldn't reach the Commander. ${err instanceof Error ? err.message : ""}`,
        pending: false,
        error: String(err),
      });
    } finally {
      clearTimeout(timeout);
      setThinking(false);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div
      className="pointer-events-auto flex w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/85 shadow-2xl backdrop-blur-2xl"
      style={{
        maxHeight: "min(70vh, 560px)",
        boxShadow:
          "0 24px 64px -16px oklch(0.05 0.02 55 / 0.6), 0 0 0 1px oklch(0.78 0.18 55 / 0.08)",
      }}
    >
      {/* ---- Header bar ---- */}
      <div className="flex items-center gap-2.5 border-b border-border/40 px-4 py-2.5">
        <AutumnLogo size={22} />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">
            Project chat
          </span>
          <span className="text-xs text-muted-foreground">· Autumn</span>
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_oklch(0.7_0.2_150/0.8)]" />
          <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
            whole workspace · remembers context
          </span>
        </div>
        <button
          type="button"
          onClick={onMinimize}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Minimize"
          aria-label="Minimize"
        >
          <ChevronDown className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Close"
          aria-label="Close"
        >
          <Minus className="size-4" />
        </button>
      </div>

      {/* ---- Body ---- */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {!hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <AutumnLogo size={48} glow />
            <h3 className="text-lg font-semibold text-foreground">
              What do you want to build?
            </h3>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Not connected to a screen — messages run a project-wide edit.
              Drag a line to a screen for focused edits.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {isThinking && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
                Commander is thinking…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Footer / input bar ---- */}
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-2 py-1.5 focus-within:border-amber-500/50">
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Format"
            aria-label="Format"
          >
            <Pencil className="size-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask anything… (@ to reference a resource or design.md)"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || isThinking}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white shadow-sm transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Send"
            aria-label="Send"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
}: {
  message: {
    id: string;
    role: "user" | "commander";
    text: string;
    pending?: boolean;
    error?: string;
    ts: number;
  };
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          isUser
            ? "rounded-br-sm bg-amber-500/15 text-amber-50"
            : message.error
              ? "rounded-bl-sm bg-rose-500/10 text-rose-200"
              : "rounded-bl-sm bg-muted/40 text-foreground/90",
        )}
      >
        {message.pending ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
            Working…
          </span>
        ) : (
          <span className="whitespace-pre-wrap break-words">{message.text}</span>
        )}
      </div>
    </div>
  );
}
