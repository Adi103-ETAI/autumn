// Autumn — VoiceMicButton.
// Floating mic button bottom-right of the canvas area. Uses the browser's
// Web Speech API for on-device speech recognition (mirrors October's voice
// mic, which uses NVIDIA Parakeet natively — we use the browser fallback).
// Routes the final transcript to the Commander via `setPendingCommand`.

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import { useAutumnStore } from "@/lib/autumn/store";
import { cn } from "@/lib/utils";

// ---- Web Speech API minimal type shims (the global types may not exist) ----
// We declare only the surface area we use, and cast `window` through
// `unknown` so this is fully SSR-safe (the access only happens inside
// effects / event handlers).
type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
};
type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceMicButton() {
  const voiceEnabled = useAutumnStore((s) => s.voiceEnabled);
  const setVoiceSetupOpen = useAutumnStore((s) => s.setVoiceSetupOpen);
  const voiceTranscript = useAutumnStore((s) => s.voiceTranscript);
  const setVoiceTranscript = useAutumnStore((s) => s.setVoiceTranscript);
  const isListening = useAutumnStore((s) => s.isListening);
  const setListening = useAutumnStore((s) => s.setListening);
  const setPendingCommand = useAutumnStore((s) => s.setPendingCommand);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef<string>("");
  // Local copy of the live transcript so the bubble updates instantly even
  // if the store render path is debounced. Kept in sync via setVoiceTranscript.
  const [liveText, setLiveText] = useState<string>("");

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.onresult = null;
          rec.onend = null;
          rec.onerror = null;
          rec.onstart = null;
          rec.abort();
        } catch {
          /* ignore */
        }
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, []);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // 3s of silence ends recognition.
  const scheduleSilenceTimeout = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
    }, 3000);
  };

  const handleEnd = () => {
    clearSilenceTimer();
    setListening(false);
    const finalTranscript = finalTranscriptRef.current.trim();
    if (finalTranscript) {
      // Route to Commander — it auto-sends when `pendingCommand` is set.
      setPendingCommand(finalTranscript);
      setRightPanelTab("commander");
    }
    setVoiceTranscript("");
    setLiveText("");
    finalTranscriptRef.current = "";
    recognitionRef.current = null;
  };

  const startListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }

    // Tear down any previous recognition instance first.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    finalTranscriptRef.current = "";
    setLiveText("");
    setVoiceTranscript("");

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (event) => {
      let interim = "";
      let final = finalTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final = (final + " " + transcript).trim();
        } else {
          interim += transcript;
        }
      }
      finalTranscriptRef.current = final;
      const live = (final ? final + " " : "") + interim;
      setLiveText(live);
      setVoiceTranscript(live);
      // Every new chunk resets the silence timer.
      scheduleSilenceTimeout();
    };

    rec.onstart = () => {
      scheduleSilenceTimeout();
    };

    rec.onend = handleEnd;

    rec.onerror = (e) => {
      clearSilenceTimer();
      setListening(false);
      const err = e?.error;
      if (err && err !== "aborted" && err !== "no-speech") {
        toast.error("Voice input error: " + err);
      }
      recognitionRef.current = null;
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
      toast.error("Could not start the microphone. Try again.");
    }
  };

  const stopListening = () => {
    clearSilenceTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    } else {
      setListening(false);
    }
  };

  const handleClick = () => {
    if (!voiceEnabled) {
      setVoiceSetupOpen(true);
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const showListeningUI = isListening;
  const tooltip = !voiceEnabled
    ? "Set up voice"
    : isListening
      ? "Listening…"
      : "Click to speak";

  const displayText = liveText || voiceTranscript;

  return (
    <div className="absolute bottom-6 right-4 z-20 flex flex-col items-end gap-2 pointer-events-none">
      {/* Live transcript bubble (above the button) */}
      <AnimatePresence>
        {showListeningUI && (
          <motion.div
            key="voice-bubble"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-auto mb-1 max-w-xs rounded-xl border border-violet-500/30 bg-zinc-900/95 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-violet-300">
              <span className="size-1.5 rounded-full bg-violet-400 animate-pulse" />
              Listening…
            </div>
            <p className="mt-1 max-h-24 overflow-y-auto text-sm leading-snug text-zinc-100 autumn-scroll">
              {displayText || (
                <span className="text-muted-foreground/70 italic">…</span>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Button + concentric rings */}
      <div className="relative pointer-events-auto">
        {/* Concentric expanding rings (3, staggered) */}
        {showListeningUI &&
          [0, 0.6, 1.2].map((delay, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute inset-0 rounded-full border border-violet-400/40"
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{
                opacity: [0.6, 0, 0.6],
                scale: [1, 1.9, 1],
              }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                delay,
                ease: "easeInOut",
              }}
            />
          ))}

        {/* Breathing halo (Framer Motion) */}
        {showListeningUI && (
          <motion.span
            aria-hidden
            className="absolute -inset-1 rounded-full bg-violet-500/20"
            animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {/* The mic button — size-12 = 48px ≥ 44px touch target */}
        <button
          type="button"
          onClick={handleClick}
          aria-label={tooltip}
          aria-pressed={showListeningUI}
          title={tooltip}
          className={cn(
            "relative flex size-12 items-center justify-center rounded-full border backdrop-blur transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
            showListeningUI
              ? "border-violet-400/60 bg-violet-500/20 text-violet-300 shadow-lg "
              : voiceEnabled
                ? "border-border/70 bg-zinc-900/80 text-zinc-200 hover:border-violet-400/50 hover:text-violet-300 shadow-lg shadow-black/30"
                : "border-border/70 bg-zinc-900/80 text-zinc-300 hover:text-violet-300 hover:border-violet-400/50 shadow-lg shadow-black/30",
          )}
        >
          <Mic
            className={cn(
              "size-5",
              showListeningUI && "animate-pulse text-violet-300",
            )}
          />

          {/* Amber notification badge "1" — shown until the user finishes setup */}
          {!voiceEnabled && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-black shadow-md shadow-violet-500/40 ring-2 ring-zinc-950"
            >
              1
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
