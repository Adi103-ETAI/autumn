// Autumn — Background Picker.
// Compact popover for choosing the canvas scenic background.
// Shows a swatch trigger (icon + current label) and a 3-column grid of
// background swatches — either a thumbnail of the photographic image or a
// gradient fallback (from the `swatch` field). The active background is
// highlighted with an amber ring.

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mountain, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutumnStore, CANVAS_BACKGROUNDS } from "@/lib/autumn/store";
import { cn } from "@/lib/utils";

export function BackgroundPicker() {
  const canvasBackgroundId = useAutumnStore((s) => s.canvasBackgroundId);
  const setCanvasBackgroundId = useAutumnStore((s) => s.setCanvasBackgroundId);
  const [open, setOpen] = useState(false);

  const current =
    CANVAS_BACKGROUNDS.find((b) => b.id === canvasBackgroundId) ??
    CANVAS_BACKGROUNDS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pick canvas background"
          className={cn(
            "group inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5",
            "text-xs text-muted-foreground transition-all",
            "hover:bg-muted/50 hover:border-amber-500/40 hover:text-foreground",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60",
          )}
        >
          {/* Swatch icon — uses the current background's gradient or a fallback */}
          <span
            className={cn(
              "size-5 rounded-[4px] border border-white/10 bg-cover bg-center shadow-sm",
              current.swatch,
            )}
            style={
              current.imageUrl
                ? { backgroundImage: `url("${current.imageUrl}")` }
                : undefined
            }
          />
          <Mountain className="size-3.5 text-amber-400 transition-transform group-hover:scale-110" />
          <span className="hidden sm:inline font-medium">{current.label}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 p-3 bg-popover/95 backdrop-blur border-border/60"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Canvas background
          </div>
          <Mountain className="size-3.5 text-amber-400/70" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {CANVAS_BACKGROUNDS.map((bg) => {
            const active = bg.id === canvasBackgroundId;
            return (
              <motion.button
                key={bg.id}
                type="button"
                onClick={() => {
                  setCanvasBackgroundId(bg.id);
                  setOpen(false);
                }}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                aria-pressed={active}
                aria-label={`Use ${bg.label} background`}
                className={cn(
                  "relative flex flex-col gap-1 rounded-lg p-1.5 text-left transition-colors",
                  "hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60",
                  active && "bg-accent/30",
                )}
              >
                {/* Swatch: image thumbnail or gradient fallback */}
                <span
                  className={cn(
                    "block aspect-[4/3] w-full rounded-md border border-white/10 bg-cover bg-center shadow-sm",
                    bg.swatch,
                    active && "ring-2 ring-violet-500 ring-offset-1 ring-offset-popover",
                  )}
                  style={
                    bg.imageUrl
                      ? { backgroundImage: `url("${bg.imageUrl}")` }
                      : undefined
                  }
                >
                  {/* Dark overlay preview mirroring the real layer's darken */}
                  {bg.imageUrl && (
                    <span
                      className="block size-full rounded-md"
                      style={{
                        backgroundColor: `rgba(0,0,0,${bg.darken ?? 0})`,
                      }}
                    />
                  )}
                </span>

                {/* Active checkmark badge */}
                {active && (
                  <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-black shadow">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}

                {/* Label */}
                <span
                  className={cn(
                    "truncate text-[10px] font-medium leading-tight",
                    active ? "text-amber-400" : "text-muted-foreground",
                  )}
                >
                  {bg.label}
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-border/40 pt-2 text-[10px] text-muted-foreground/60">
          {current.imageUrl
            ? "Photographic scene — darkened for legibility."
            : "Default dotted canvas background."}
        </div>
      </PopoverContent>
    </Popover>
  );
}
