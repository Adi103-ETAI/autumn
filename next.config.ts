import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
