// Autumn video-editor template — three starter compositions.
//
// The agent registers more <Composition> entries here as the user describes
// videos; these three give a fresh project something real to render.
//
// Autumn starts the project with no user footage. For real video/audio prefer
// <Video>/<Audio> from "@remotion/media" (fast, WebCodecs-based) over
// <OffthreadVideo>, which is not optimized; it falls back automatically for
// unsupported codecs. Files the user uploads to the canvas Resources panel are
// auto-mirrored into public/assets — reference them with staticFile('assets/<name>').

import { Composition } from "remotion";
import { Caption } from "./Caption";
import { PromoCard } from "./PromoCard";
import { EndCard } from "./EndCard";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Caption"
        component={Caption}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ title: "Autumn", subtitle: "Your words, in motion" }}
      />
      <Composition
        id="PromoCard"
        component={PromoCard}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ headline: "Ship it with Autumn", accent: "#ff5c39" }}
      />
      <Composition
        id="EndCard"
        component={EndCard}
        durationInFrames={60}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ note: "Made with Autumn" }}
      />
    </>
  );
};
