import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import React from "react";

/** The closing card — the third starter video. */
export const EndCard: React.FC<{ note: string }> = ({ note }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.6], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d12", color: "#ececf1", fontFamily: "system-ui, sans-serif", justifyContent: "center", alignItems: "center" }}>
      <p style={{ fontSize: 64, opacity, letterSpacing: "0.04em" }}>{note}</p>
    </AbsoluteFill>
  );
};
