// Autumn — Welcome Splash Screen.
// Full-screen modal overlay shown on first visit (localStorage "autumn-welcome-seen").
// Features: gradient background, Autumn leaf logo, 3 feature cards, "Get Started" button.

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { MapPin, Terminal, Cable, Leaf } from "lucide-react";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";

const WELCOME_KEY = "autumn-welcome-seen";

const FEATURES = [
  {
    icon: MapPin,
    title: "Spatial Canvas",
    description: "Arrange agents on an infinite canvas — drag, connect, and orchestrate visually.",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Terminal,
    title: "AI Commander",
    description: "Speak naturally to the Commander — it spawns, wires, and dispatches agents for you.",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
  },
  {
    icon: Cable,
    title: "Agent Bus",
    description: "Agents communicate via bus edges, sending message_peer handoffs to coordinate work.",
    color: "text-violet-400",
    border: "border-violet-500/30",
    bg: "bg-violet-500/10",
  },
];

export function WelcomeSplash() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if localStorage key is not set
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(WELCOME_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(WELCOME_KEY, "1");
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Gradient backdrop */}
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.08)_0%,transparent_70%)]" />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
            {/* Maple-leaf logo */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="mb-6"
            >
              <AutumnLogo size={72} glow priority />
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="text-4xl font-bold mb-2 bg-gradient-to-r from-amber-300 via-orange-300 to-amber-400 bg-clip-text text-transparent"
            >
              Welcome to Autumn
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="text-sm text-zinc-400 mb-10 text-center max-w-md"
            >
              An open-source spatial canvas for orchestrating AI coding agents. Spawn, connect, and coordinate — all on one infinite workspace.
            </motion.p>

            {/* Feature cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mb-10">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.12, duration: 0.5 }}
                  className={`rounded-xl border ${f.border} ${f.bg} backdrop-blur-sm p-5 flex flex-col items-center text-center`}
                >
                  <f.icon className={`size-8 ${f.color} mb-3`} />
                  <h3 className="text-sm font-semibold text-foreground mb-1.5">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                </motion.div>
              ))}
            </div>

            {/* Get Started button */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.5 }}
            >
              <Button
                size="lg"
                className="gap-2 px-8 text-base font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg shadow-amber-500/20"
                onClick={dismiss}
              >
                <Leaf className="size-4" />
                Get Started
              </Button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
