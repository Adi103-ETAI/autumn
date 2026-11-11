import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import React from "react";

/** A landscape promo card — the second starter video. */
export const PromoCard: React.FC<{ headline: string; accent: string }> = ({ headline, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 200 } });
  const x = interpolate(frame, [0, fps * 2], [-80, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#121218", color: "#f4f4f8", fontFamily: "system-ui, sans-serif", justifyContent: "center", padding: "0 8vw" }}>
      <div style={{ transform: `translateX(${x}px) scale(${0.94 + scale * 0.06})` }}>
        <div style={{ width: 96, height: 8, background: accent, borderRadius: 4, marginBottom: 32 }} />
        <h1 style={{ fontSize: 120, margin: 0, letterSpacing: "-0.03em", maxWidth: "16ch" }}>{headline}</h1>
      </div>
    </AbsoluteFill>
  );
};
