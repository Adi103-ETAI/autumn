"use client";

/**
 * AutumnWordmark — the AUTURN wordmark in ASCII.
 *
 * The same artwork as `brand/autumn-ascii.txt` (drawn with `figlet -f big`),
 * rendered in the app so the brand reads the same in a terminal and on screen.
 *
 * Usage:
 *   <AutumnWordmark />              // the default size
 *   <AutumnWordmark size="sm" />    // a tighter variant
 */

const WORDMARK = [
  "         _    _ _______ _    _ __  __ _   _ ",
  "    /\\  | |  | |__   __| |  | |  \\/  | \\ | |",
  "   /  \\ | |  | |  | |  | |  | | \\  / |  \\| |",
  "  / /\\ \\| |  | |  | |  | |  | | |\\/| | . ` |",
  " / ____ \\ |__| |  | |  | |__| | |  | | |\\  |",
  "/_/    \\_\\____/   |_|   \\____/|_|  |_|_| \\_|",
].join("\n");

export function AutumnWordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <pre
      aria-label="AUTUMN"
      className={`select-none overflow-hidden font-mono leading-[1.05] tracking-tight text-amber-400/90 ${
        size === "sm" ? "text-[6px]" : "text-[8px] sm:text-[9px]"
      } ${className}`}
    >
      {WORDMARK}
    </pre>
  );
}
