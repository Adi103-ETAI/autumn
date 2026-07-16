// Autumn — VoiceSetupModal.
// 3-step setup wizard for voice input:
//   1. Permission  — requests mic via `navigator.mediaDevices.getUserMedia`
//   2. Test it     — live Web Speech API recognition with interim transcript
//   3. Done        — enables voice (store.voiceEnabled) and closes the modal
// Uses shadcn/ui `Dialog`, Framer Motion step transitions, amber accents.
// "Powered by on-device speech recognition" (October uses NVIDIA Parakeet —
// we use the browser's built-in Web Speech API).

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Check, Volume2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAutumnStore } from "@/lib/autumn/store";
import { cn } from "@/lib/utils";

// ---- Web Speech API minimal type shims (see VoiceMicButton for rationale) ----
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

type Step = 1 | 2 | 3;

export function VoiceSetupModal() {
  const open = useAutumnStore((s) => s.voiceSetupOpen);
  const setOpen = useAutumnStore((s) => s.setVoiceSetupOpen);
  const setVoiceEnabled = useAutumnStore((s) => s.setVoiceEnabled);

  const [step, setStep] = useState<Step>(1);
  const [permError, setPermError] = useState<string | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permGranted, setPermGranted] = useState(false);
  const [interim, setInterim] = useState<string>("");
  const [testActive, setTestActive] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stopTestRecognition = () => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onend = null;
        rec.onerror = null;
        rec.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    setTestActive(false);
  };

  // Reset step state when modal closes; stop any active recognition.
  useEffect(() => {
    if (!open) {
      stopTestRecognition();
      const t = setTimeout(() => {
        setStep(1);
        setPermError(null);
        setPermLoading(false);
        setPermGranted(false);
        setInterim("");
      }, 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopTestRecognition();
    };
  }, []);

  // ---- Step 1: request mic permission ----
  const handleRequestMic = async () => {
    setPermLoading(true);
    setPermError(null);
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        throw new Error("unsupported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      // Stop the tracks immediately — we just needed the permission grant.
      stream.getTracks().forEach((t) => t.stop());
      setPermGranted(true);
      setStep(2);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setPermError(
          "Microphone access was blocked. Allow it in your browser settings and try again.",
        );
      } else if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
        setPermError("No microphone device was found. Plug one in and try again.");
      } else if (e?.message === "unsupported") {
        setPermError(
          "Your browser doesn't support microphone access. Try Chrome.",
        );
      } else {
        setPermError(
          "Could not access the microphone. " + (e?.message ?? "Unknown error."),
        );
      }
    } finally {
      setPermLoading(false);
    }
  };

  // ---- Step 2: start a test recognition session ----
  const startTest = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setInterim(
        "(Voice input isn't supported in this browser. Try Chrome.)",
      );
      return;
    }

    // Abort any previous instance.
    stopTestRecognition();

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = "";
    rec.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText = (finalText + " " + transcript).trim();
        } else {
          interimText += transcript;
        }
      }
      setInterim((finalText ? finalText + " " : "") + interimText);
    };

    rec.onend = () => {
      setTestActive(false);
    };
    rec.onerror = () => {
      setTestActive(false);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setTestActive(true);
      setInterim("");
    } catch {
      setTestActive(false);
    }
  };

  // Auto-start test recognition when entering step 2.
  useEffect(() => {
    if (open && step === 2) {
      const t = setTimeout(() => startTest(), 250);
      return () => clearTimeout(t);
    }
    if (step !== 2) {
      // If user navigates away from step 2, stop any active test session.
      stopTestRecognition();
    }
  }, [open, step]);

  const handleSkip = () => setOpen(false);

  const handleDone = () => {
    stopTestRecognition();
    setVoiceEnabled(true);
    setOpen(false);
  };

  const handleOpenChange = (v: boolean) => setOpen(v);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden border-violet-500/20 bg-zinc-950/95 p-0 sm:max-w-md"
        showCloseButton
      >
        {/* Header */}
        <DialogHeader className="space-y-0 px-6 pt-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-full bg-violet-500/15 ring-1 ring-violet-500/30">
              <Mic className="size-4 text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground">
                Set up voice
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                Powered by on-device speech recognition
              </DialogDescription>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Talk to your agents. Autumn listens and routes your voice to the
            Project chat — hands-free orchestration.
          </p>
        </DialogHeader>

        {/* Step indicator (3 amber bars) */}
        <div className="flex items-center gap-1.5 px-6 pb-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                step >= n ? "bg-violet-500" : "bg-zinc-700/60",
              )}
            />
          ))}
        </div>

        {/* Step body */}
        <div className="px-6 pb-4 min-h-[200px]">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-violet-500/40 bg-violet-500/10 text-violet-300"
                  >
                    Step 1
                  </Badge>
                  <h3 className="text-sm font-medium text-foreground">
                    Permission
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your browser will ask for microphone permission. Audio is
                  transcribed on-device — nothing is sent to a server.
                </p>
                {permError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {permError}
                  </div>
                )}
                {permGranted && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    <Check className="size-3.5 shrink-0" />
                    Microphone ready.
                  </div>
                )}
                <Button
                  type="button"
                  onClick={handleRequestMic}
                  disabled={permLoading}
                  className={cn(
                    "w-full gap-2 border-0 bg-gradient-to-r from-violet-500 to-orange-500 text-white hover:from-violet-600 hover:to-orange-600",
                    permLoading && "opacity-80",
                  )}
                >
                  <Volume2 className="size-4" />
                  {permLoading
                    ? "Requesting…"
                    : permGranted
                      ? "Request again"
                      : "Enable microphone"}
                </Button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-violet-500/40 bg-violet-500/10 text-violet-300"
                  >
                    Step 2
                  </Badge>
                  <h3 className="text-sm font-medium text-foreground">
                    Test it
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Say something. You should see the words appear below in
                  real-time.
                </p>

                <div className="relative flex min-h-[72px] items-center gap-3 rounded-xl border border-violet-500/20 bg-zinc-900/80 px-4 py-3">
                  <span className="relative flex size-2.5 shrink-0">
                    {testActive && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400/60" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex size-2.5 rounded-full",
                        testActive ? "bg-violet-400" : "bg-zinc-600",
                      )}
                    />
                  </span>
                  <p className="flex-1 text-sm text-zinc-100 leading-snug">
                    {interim || (
                      <span className="text-muted-foreground/70 italic">
                        Say something…
                      </span>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={startTest}
                    className="shrink-0 text-xs text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
                  >
                    Retry
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Back
                  </button>
                  <Button
                    type="button"
                    onClick={() => setStep(3)}
                    className="gap-2 border-0 bg-gradient-to-r from-violet-500 to-orange-500 text-white hover:from-violet-600 hover:to-orange-600"
                  >
                    <Check className="size-4" />
                    Looks good
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="space-y-4"
              >
                <div className="flex flex-col items-center text-center pt-2">
                  <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 200,
                      damping: 14,
                    }}
                    className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40"
                  >
                    <Check className="size-6 text-emerald-400" />
                  </motion.div>
                  <h3 className="mt-3 text-base font-semibold text-foreground">
                    Voice is on
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    Click the mic anytime to talk to your agents.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleDone}
                  className="w-full gap-2 border-0 bg-gradient-to-r from-violet-500 to-orange-500 text-white hover:from-violet-600 hover:to-orange-600"
                >
                  Done
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/50 bg-zinc-950/60 px-6 py-3">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip for now
          </button>
          <span className="text-[10px] text-muted-foreground/60">
            Powered by on-device speech recognition
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
