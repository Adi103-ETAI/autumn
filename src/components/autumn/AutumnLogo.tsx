"use client";

import Image from "next/image";

/**
 * AutumnLogo — the maple-leaf brand mark.
 *
 * Renders the maple-leaf PNG (`/maple-leaf.png`) as the Autumn logo.
 * The leaf itself carries the autumn colour palette (amber/orange), so no
 * gradient container is needed — just a subtle glow for depth.
 *
 * Usage:
 *   <AutumnLogo size={32} />           // top bar / headers
 *   <AutumnLogo size={64} glow />      // empty states
 *   <AutumnLogo size={80} priority />  // above-the-fold hero
 */
export function AutumnLogo({
  size = 32,
  className = "",
  glow = false,
  priority = false,
}: {
  size?: number;
  className?: string;
  /** Add a warm amber drop-shadow glow (for large / hero usage). */
  glow?: boolean;
  /** Prioritise loading (for above-the-fold logos). */
  priority?: boolean;
}) {
  return (
    <Image
      src="/maple-leaf.png"
      alt="Autumn"
      width={size}
      height={size}
      priority={priority}
      className={`select-none ${glow ? "drop-shadow-[0_4px_16px_rgba(245,158,11,0.45)]" : "drop-shadow-[0_1px_3px_rgba(0,0,0,0.25)]"} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
