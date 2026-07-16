// Autumn — Canvas Background Layer.
// Renders the active scenic photographic background as a full-bleed layer
// behind the React Flow canvas. Reads `canvasBackgroundId` from the store
// and finds the matching CANVAS_BACKGROUNDS entry.
//
// For the `autumn-dots` background (no image), renders nothing — the React
// Flow <Background variant="dots" /> component handles that case.

"use client";

import { useMemo } from "react";
import { useAutumnStore, CANVAS_BACKGROUNDS } from "@/lib/autumn/store";

export function CanvasBackgroundLayer() {
  const canvasBackgroundId = useAutumnStore((s) => s.canvasBackgroundId);

  const bg = useMemo(
    () =>
      CANVAS_BACKGROUNDS.find((b) => b.id === canvasBackgroundId) ??
      CANVAS_BACKGROUNDS[0],
    [canvasBackgroundId],
  );

  // For the default "autumn-dots" background (no image), render nothing —
  // the React Flow Background dots component handles it.
  if (!bg?.imageUrl) return null;

  const darken = Math.max(0, Math.min(1, bg.darken ?? 0));

  return (
    <div
      // Sit behind the React Flow canvas (which uses z-10+ for nodes/edges).
      // `pointer-events-none` so the image never intercepts canvas drags.
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {/* Photographic wallpaper — fades in/out smoothly on switch */}
      <div
        key={bg.id}
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{
          backgroundImage: `url("${bg.imageUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Dark overlay (flat) — uses `darken` for node/text legibility */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: `rgba(0, 0, 0, ${darken})` }}
      />
      {/* Soft gradient vignette — deepens top + bottom edges, adds depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
      {/* Subtle warm amber tint to keep the Autumn brand mood on every scene */}
      <div className="absolute inset-0 bg-amber-950/10 mix-blend-multiply" />
    </div>
  );
}
