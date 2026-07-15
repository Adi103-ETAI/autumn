// Autumn — Commander panel (right side).
// The universal chat + voice agent. Sends commands to /api/commander,
// receives a DO_ACTIONS plan, and executes it against the canvas store.

"use client";

import { useEffect, useRef, useState } from "react";
import { useAutumnStore } from "@/lib/autumn/store";
import { runAgentForNode } from "@/lib/autumn/agent-runner";
import type { CanvasSnapshot, CommanderResult } from "@/lib/autumn/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Mic,
  MicOff,
  Sparkles,
  ChevronRight,
  Volume2,
  Bot,
  Cable,
  StickyNote,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_TEMPLATES: { label: string; cmd: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { label: "Spawn agent", cmd: "Spawn a new agent on Claude Code and have them stand by for tasks.", icon: Bot, color: "text-amber-300" },
  { label: "Connect two", cmd: "Connect Atlas to Apollo with a bus edge so they can coordinate.", icon: Cable, color: "text-sky-300" },
  { label: "Drop a note", cmd: 'Drop a sticky note saying "remember to ship on Friday".', icon: StickyNote, color: "text-amber-400" },
  { label: "Auto-arrange", cmd: "Arrange all nodes on the canvas into a clean tiered layout.", icon: Workflow, color: "text-violet-300" },
  { label: "Run all idle", cmd: "Have every idle agent pick up an open task from the board and start work.", icon: Zap, color: "text-emerald-300" },
];

export function CommanderPanel() {
  const messages = useAutumnStore((s) => s.commanderMessages);
  const isThinking = useAutumnStore((s) => s.isCommanderThinking);
  const isListening = useAutumnStore((s) => s.isListening);
  const setListening = useAutumnStore((s) => s.setListening);
  const pushMessage = useAutumnStore((s) => s.pushCommanderMessage);
  const updateMessage = useAutumnStore((s) => s.updateCommanderMessage);
  const setThinking = useAutumnStore((s) => s.setCommanderThinking);
  const applyPlan = useAutumnStore((s) => s.applyCommanderPlan);
  const recentActions = useAutumnStore((s) => s.recentActions);
  const nodes = useAutumnStore((s) => s.nodes);
  const edges = useAutumnStore((s) => s.edges);
  const commandHistory = useAutumnStore((s) => s.commandHistory);
  const pushCommandHistory = useAutumnStore((s) => s.pushCommandHistory);
  const pendingCommand = useAutumnStore((s) => s.pendingCommand);
  const setPendingCommand = useAutumnStore((s) => s.setPendingCommand);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Web Speech API for voice input (Chrome/Edge).
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, isThinking]);

  // Watch for pending commands (from Help dialog examples, command palette, etc.).
  useEffect(() => {
    if (pendingCommand && !isThinking) {
      const cmd = pendingCommand;
      setPendingCommand(null);
      void send(cmd);
    }
  }, [pendingCommand, isThinking, setPendingCommand]);

  const buildSnapshot = (): CanvasSnapshot => ({
    nodes: nodes
      .filter((n) => n.kind === "chat")
      .map((n) => {
        const d = n.data as {
          status?: string;
          harness?: string;
          doing?: string;
          personaId?: string;
          route?: string;
        };
        return {
          id: n.id,
          kind: n.kind,
          name: n.name,
          status: d.status,
          harness: d.harness,
          doing: d.doing,
          route: d.route,
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
    pushCommandHistory(cmd);
    pushMessage({ role: "user", text: cmd });
    const pendingId = pushMessage({
      role: "commander",
      text: "",
      pending: true,
    });
    setThinking(true);

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
      });
      if (!r.ok) throw new Error(`commander ${r.status}`);
      const plan = (await r.json()) as CommanderResult;
      updateMessage(pendingId, { text: renderPlanText(plan), plan, pending: false });

      if (plan.kind === "steps") {
        applyPlan(plan);
        speak(plan.say);
        // After applying the plan, run any agents that just received a task.
        setTimeout(() => {
          void runPendingAgents();
        }, 600);
      }
    } catch (err) {
      console.error(err);
      updateMessage(pendingId, {
        text: `⚠️ Couldn't reach the Commander. ${err instanceof Error ? err.message : ""}`,
        pending: false,
        error: String(err),
      });
    } finally {
      setThinking(false);
    }
  };

  const runPendingAgents = async () => {
    const store = useAutumnStore.getState();
    for (const n of store.nodes) {
      if (n.kind !== "chat") continue;
      // Skip if already running.
      if (store.isAgentRunning[n.id]) continue;
      const d = n.data as { messages: { role: string; ts: number }[]; status: string };
      const lastUser = [...d.messages].reverse().find((m) => m.role === "user");
      const lastAssistant = [...d.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastUser && (!lastAssistant || lastUser.ts > lastAssistant.ts)) {
        await runAgentForNode(n.id);
      }
    }
  };

  const toggleVoice = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    const SR =
      typeof window !== "undefined"
        ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
            .SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: unknown })
            .webkitSpeechRecognition
        : undefined;
    if (!SR) {
      alert("Voice input not supported in this browser. Try Chrome or Edge.");
      return;
    }
    const rec = new (SR as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
      onend: () => void;
      onerror: (e: { error: string }) => void;
      start: () => void;
      stop: () => void;
    })();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  const stopListening = () => {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    rec?.stop?.();
    setListening(false);
  };

  const speak = (text: string) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !text
    )
      return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto autumn-scroll p-3 space-y-3"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex gap-2.5",
              m.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={cn(
                "size-7 shrink-0 rounded-md flex items-center justify-center text-xs font-bold shadow",
                m.role === "user"
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-gradient-to-br from-amber-500 to-orange-500 text-white",
              )}
            >
              {m.role === "user" ? "You" : <Sparkles className="size-3.5" />}
            </div>
            <div
              className={cn(
                "rounded-xl px-3 py-2 max-w-[80%] text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-zinc-700/60 text-zinc-100 border border-zinc-600/40"
                  : "bg-muted/40 border border-border/40",
                m.error && "border-rose-500/40 bg-rose-500/5",
              )}
            >
              {m.pending ? (
                <div className="space-y-2 min-w-[220px]">
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-300/80 uppercase tracking-wider">
                    <Sparkles className="size-2.5 animate-pulse" />
                    <span>planning</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="commander-skeleton-line w-[85%]" />
                    <div className="commander-skeleton-line w-[65%]" />
                    <div className="commander-skeleton-line w-[75%]" />
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground/60 pt-0.5">
                    <span className="size-1 rounded-full bg-amber-400/70 animate-pulse" />
                    <span>routing via autumn-bus…</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.plan && m.plan.kind === "steps" && (
                    <div className="mt-2 space-y-1">
                      {m.plan.steps.map((s, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                        >
                          <ChevronRight className="size-3 text-amber-400" />
                          <code className="text-amber-300/90">{s.action}</code>
                          <span className="text-muted-foreground/60">
                            {summarizeArgs(s.args)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.plan && m.plan.kind === "ask" && m.plan.options && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.plan.options.map((opt, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => setInput(opt)}
                        >
                          {opt}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {isThinking && messages[messages.length - 1]?.pending && (
          <div className="text-[10px] text-muted-foreground/60 text-center flex items-center justify-center gap-1.5">
            <span className="size-1 rounded-full bg-amber-400/70 animate-pulse" />
            <span>commander is composing a DO_ACTIONS plan</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-3 space-y-2">
        {/* Command history quick-chips */}
        {commandHistory.length > 0 && !input && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mr-1">
              recent
            </span>
            {commandHistory.slice(0, 4).map((cmd, i) => (
              <button
                key={i}
                onClick={() => setInput(cmd)}
                disabled={isThinking}
                className="max-w-[140px] truncate text-[10px] rounded-full bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-border px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                title={cmd}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
        {/* Quick prompt template chips (only when input is empty and not thinking) */}
        {input === "" && !isThinking && messages.length <= 2 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mr-1">
              try
            </span>
            {QUICK_TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => void send(t.cmd)}
                className="flex items-center gap-1 text-[10px] rounded-full bg-muted/30 hover:bg-amber-500/10 border border-border/40 hover:border-amber-500/40 px-2 py-0.5 text-muted-foreground hover:text-amber-200 transition-all disabled:opacity-40 group"
                title={t.cmd}
              >
                <t.icon className={cn("size-2.5", t.color, "group-hover:scale-110 transition-transform")} />
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Tell the Commander what to build or orchestrate…"
            className="min-h-[60px] max-h-[160px] resize-none bg-muted/30 border-border/50 text-sm pr-12"
            disabled={isThinking}
          />
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "size-7",
                isListening && "text-rose-400 bg-rose-500/10",
              )}
              onClick={toggleVoice}
              disabled={isThinking}
              aria-label="Voice input"
            >
              {isListening ? (
                <MicOff className="size-3.5" />
              ) : (
                <Mic className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isListening && (
            <div className="flex items-center gap-1 text-[10px] text-rose-400">
              <Volume2 className="size-3" />
              <span>listening…</span>
              <div className="flex items-end gap-0.5 h-3">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="wave-bar w-0.5 bg-rose-400 rounded-full"
                    style={{
                      height: "100%",
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex-1" />
          <Badge variant="outline" className="text-[9px] h-5 px-1.5">
            ⏎ send · ⇧⏎ newline
          </Badge>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => void send()}
            disabled={isThinking || !input.trim()}
          >
            <Send className="size-3" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function renderPlanText(plan: CommanderResult): string {
  if (plan.kind === "ask") return plan.ask;
  return plan.say;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length > 40) continue;
    parts.push(`${k}=${s}`);
  }
  return parts.slice(0, 3).join(" ");
}
