// Autumn — TipCard.
// A small yellow onboarding tip card overlay, matching October Desktop's
// "Three ways to start" tooltip that appears on the left edge of the canvas.
// Dismissible (persists dismissal in localStorage).

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MessageSquare, MousePointerClick } from "lucide-react";
import { useAutumnStore } from "@/lib/autumn/store";

const STORAGE_KEY = "autumn-tip-card-dismissed";

interface Tip {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}

const TIPS: Tip[] = [
  {
    icon: Mic,
    text: "Use the mic on the dock to talk to chat",
  },
  {
    icon: MessageSquare,
    text: "Type below the canvas to create agents and the layout",
  },
  {
    icon: MousePointerClick,
    text: "Drag screens, chats, terminals, files onto the canvas",
  },
];

export function TipCard() {
  const setVoiceSetupOpen = useAutumnStore((s) => s.setVoiceSetupOpen);
  const setRightPanelTab = useAutumnStore((s) => s.setRightPanelTab);
  const [visible, setVisible] = useState(false);

  // Check localStorage on mount — only show if not previously dismissed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      // Small delay so it animates in after the canvas settles.
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -24, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -24, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="absolute top-4 left-4 z-30 w-64 rounded-xl border border-amber-300/50 bg-amber-50/95 backdrop-blur-sm shadow-2xl shadow-amber-900/20 p-3.5"
          role="complementary"
          aria-label="Getting started tips"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={dismiss}
            className="absolute top-2 right-2 size-5 rounded-md flex items-center justify-center text-amber-900/50 hover:text-amber-900 hover:bg-amber-200/60 transition-colors"
            aria-label="Dismiss tips"
          >
            <X className="size-3.5" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-1.5 mb-2.5 pr-5">
            <span className="text-base">🍂</span>
            <h3 className="text-[12px] font-bold text-amber-900 tracking-tight">
              Three ways to start
            </h3>
          </div>

          {/* Tips list */}
          <ul className="space-y-2">
            {TIPS.map((tip, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 size-5 rounded-md bg-amber-200/80 flex items-center justify-center">
                  <tip.icon className="size-3 text-amber-800" />
                </span>
                <span className="text-[11px] leading-relaxed text-amber-900/90">
                  {tip.text}
                </span>
              </li>
            ))}
          </ul>

          {/* Footer actions */}
          <div className="mt-3 pt-2.5 border-t border-amber-300/40 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setVoiceSetupOpen(true);
                dismiss();
              }}
              className="text-[10px] font-semibold text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline transition-colors"
            >
              Set up voice →
            </button>
            <span className="text-amber-400/60">·</span>
            <button
              type="button"
              onClick={() => {
                setRightPanelTab("commander");
                dismiss();
              }}
              className="text-[10px] font-semibold text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline transition-colors"
            >
              Go Home → Open
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
