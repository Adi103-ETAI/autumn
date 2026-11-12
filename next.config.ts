import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1:3000", "127.0.0.1", "localhost"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Native modules must NOT be bundled into the server build — keep them
  // external so node-pty loads at runtime inside Electron.
  //
  // The Prisma client is generated into prisma/generated (a normal directory
  // inside the repo, so electron-builder actually ships it) — it is bundled
  // with the app and carries its own query engine.
  serverExternalPackages: ["node-pty", "prisma"],
};

export default nextConfig;
