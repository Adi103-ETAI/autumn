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
  // external so node-pty / @prisma/client load at runtime inside Electron.
  serverExternalPackages: ["node-pty", "@prisma/client", "prisma"],
};

export default nextConfig;
