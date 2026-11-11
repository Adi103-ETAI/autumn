import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import React from "react";

/** A vertical caption card — the default first video. */
export const Caption: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [0, fps * 0.5, fps * 2.4, fps * 3], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f14", color: "#ececf1", fontFamily: "system-ui, sans-serif", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: fade, textAlign: "center", padding: "0 10vw" }}>
        <h1 style={{ fontSize: 96, margin: 0, letterSpacing: "-0.02em" }}>{title}</h1>
        <p style={{ fontSize: 42, opacity: 0.75, marginTop: 24 }}>{subtitle}</p>
      </div>
    </AbsoluteFill>
  );
};
