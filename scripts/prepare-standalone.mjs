// autumn — cross-platform packaging preparation.
//
// The old build script used Unix `cp -r`, which fails on Windows. This script
// does the same job with Node's fs APIs so ONE build works on every OS:
//
//   1. `next build` (output: "standalone" — see next.config.ts)
//   2. copy `.next/static` → `.next/standalone/.next/static`
//   3. copy `public/`      → `.next/standalone/public`
//   4. copy `prisma/`       → `.next/standalone/prisma` (the CLI needs the
//      schema at runtime to create the DB in the user's data dir)
//   5. `prisma generate`    (the query engine for THIS platform)
//
// The standalone output is what the packaged app runs as its Next server
// (electron/main.js boots it with ELECTRON_RUN_AS_NODE=1).

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) {
    console.error(`[prepare-standalone] ${cmd} ${args.join(" ")} failed (${res.status})`);
    process.exit(res.status ?? 1);
  }
}

/** Copy a file or directory tree, creating the parent when needed. */
function copy(from, to) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`[prepare-standalone] skip (missing): ${from}`);
    return;
  }
  mkdirSync(dirname(join(root, to)), { recursive: true });
  rmSync(join(root, to), { recursive: true, force: true });
  cpSync(src, join(root, to), { recursive: true });
  console.log(`[prepare-standalone] ${from} → ${to}`);
}

// 1. the Next build itself
if (!process.env.AUTUMN_SKIP_NEXT_BUILD) {
  run("npx", ["next", "build"]);
}

// 2-4. the pieces the standalone server needs at runtime
copy(".next/static", ".next/standalone/.next/static");
copy("public", ".next/standalone/public");
copy("prisma", ".next/standalone/prisma");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("[prepare-standalone] .next/standalone/server.js is missing — did `next build` run?");
  process.exit(1);
}

// 5. the Prisma client + the query engine for this platform
if (!process.env.AUTUMN_SKIP_PRISMA_GENERATE) {
  run("npx", ["prisma", "generate"]);
}

// 6. Prisma is an EXTERNAL package (next.config.ts: serverExternalPackages), so
// Next does not trace it into the standalone output. The standalone server
// does not need it (the backend runs in the Electron main process, which gets
// Prisma from the asar), so nothing is copied here — but the schema IS
// shipped (step 4) because the main process creates the user's DB from it.

console.log("[prepare-standalone] ready — .next/standalone/server.js");
