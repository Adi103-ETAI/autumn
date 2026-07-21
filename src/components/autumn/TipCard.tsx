// Autumn — TipCard.
// The "Three ways to start" onboarding card overlay. Redesigned to match the
// reference image: warm cream/ivory card + real maple-leaf brand mark +
// golden-yellow circular icon badges + dark-brown text + footer action links.
// Dismissible (persists dismissal in localStorage).

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MessageSquare, MousePointerClick } from "lucide-react";
import { useAutumnStore } from "@/lib/autumn/store";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";

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
          // Warm cream/ivory card matching the reference image (#FFFDF5).
          className="absolute top-4 left-4 z-30 w-72 rounded-2xl border border-amber-200/70 bg-[#FFFDF5] backdrop-blur-sm p-4"
          role="complementary"
          aria-label="Getting started tips"
          style={{
            boxShadow:
              "0 12px 32px -8px rgb(120 80 30 / 0.22), 0 2px 8px -2px rgb(120 80 30 / 0.10), inset 0 1px 0 0 rgb(255 255 255 / 0.7)",
          }}
        >
          {/* Close button — muted gray, top-right */}
          <button
            type="button"
            onClick={dismiss}
            className="absolute top-3 right-3 size-6 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-amber-100/80 transition-colors"
            aria-label="Dismiss tips"
          >
            <X className="size-4" />
          </button>

          {/* Header — maple-leaf brand mark + title */}
          <div className="flex items-center gap-2 mb-3 pr-6">
            <AutumnLogo size={20} priority />
            <h3 className="text-[13px] font-bold text-stone-800 tracking-tight">
              Three ways to start
            </h3>
          </div>

          {/* Tips list — each with a golden-yellow circular icon badge */}
          <ul className="space-y-2.5">
            {TIPS.map((tip, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="shrink-0 mt-0.5 size-6 rounded-full flex items-center justify-center bg-amber-300 shadow-sm shadow-amber-500/30"
                  style={{
                    boxShadow:
                      "0 1px 3px rgb(180 130 30 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.4)",
                  }}
                >
                  <tip.icon className="size-3.5 text-amber-900" />
                </span>
                <span className="text-[11.5px] leading-relaxed text-stone-700">
                  {tip.text}
                </span>
              </li>
            ))}
          </ul>

          {/* Footer — divider + two action links */}
          <div className="mt-3.5 pt-3 border-t border-amber-200/70 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setVoiceSetupOpen(true);
                dismiss();
              }}
              className="text-[10.5px] font-semibold text-stone-500 hover:text-stone-800 transition-colors"
            >
              Set up voice →
            </button>
            <button
              type="button"
              onClick={() => {
                setRightPanelTab("commander");
                dismiss();
              }}
              className="text-[10.5px] font-semibold text-stone-500 hover:text-stone-800 transition-colors"
            >
              Go Home → Open
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
