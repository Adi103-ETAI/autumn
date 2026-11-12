// autumn — compute what the packaged app actually needs at runtime.
//
// electron-builder ships EVERY production dependency into the asar. For this
// app that means the whole renderer dependency tree (radix, lucide, effect,
// codesandbox, rspack, …) — hundreds of megabytes the main process never
// loads, because the RENDERER runs inside the Next standalone server, which
// ships its own traced node_modules (resources/standalone).
//
// This script computes the exact runtime closure of the Electron MAIN process
// (the externals of the bundled backend + the Next server's own deps) and
// writes the keep-list to assets/packaging-files.json. The electron-builder
// config then ships ONLY that closure.
//
// The closure is computed from the REAL installed tree, so it cannot drift
// from what the app loads.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = join(root, "node_modules");

/** The packages the bundled backend leaves external (see scripts/build-backend.mjs). */
const BACKEND_EXTERNALS = [
  // The Prisma CLIENT is generated into prisma/generated (a normal directory
  // in the app tree) — it is not an npm dependency, so it is not here.
  "node-pty",
  "prisma",
  "electron-updater",
  "ws",
  "remotion",
  "@remotion/cli",
];

/** Packages the main process loads by hand (not through the bundle). */
const EXTRA_ROOTS = ["electron-updater", "ws"];

function readPkg(name) {
  try {
    return JSON.parse(readFileSync(join(nodeModules, name, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

const closure = new Set();
const missing = [];

function visit(name) {
  if (closure.has(name)) return;
  const pkg = readPkg(name);
  if (!pkg) {
    missing.push(name);
    return;
  }
  closure.add(name);
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
  for (const [dep, optional] of Object.entries(pkg.optionalDependencies ?? {})) {
    // An optional dependency that is not installed for this platform is skipped
    // (it may be a foreign-platform binary).
    if (optional === false) continue;
    if (existsSync(join(nodeModules, dep))) visit(dep);
  }
}

for (const root of [...BACKEND_EXTERNALS, ...EXTRA_ROOTS]) visit(root);

// The Prisma CLI reads its own engines; make sure they are in the closure.
if (closure.has("prisma")) visit("@prisma/engines");

// electron-builder always copies the PRODUCTION node_modules — so the
// keep-list has to become an exclusion list: every installed top-level
// package that the main process does not load is excluded from the asar.
const installed = [];
for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
  if (entry.name.startsWith(".")) continue; // .bin/.prisma/.package-lock
  if (entry.name.startsWith("@")) {
    for (const sub of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
      installed.push(`${entry.name}/${sub.name}`);
    }
  } else {
    installed.push(entry.name);
  }
}
// SAFETY: a package that is missing at runtime breaks the app at STARTUP —
// much worse than a bigger installer. So the exclusion list only removes
// packages that are BOTH outside the closure AND provably renderer-only:
// the renderer tree is bundled INTO the Next build, and the Next server
// carries its own traced node_modules (resources/standalone).
//
// The rule: exclude a package only when it is not in the closure AND it is
// not a dependency of anything in the closure (transitively) AND it is not
// one of the "known renderer-only" roots. Everything else is kept.
const RENDERER_ONLY_ROOTS = [
  "@radix-ui",
  "@codemirror",
  "@autumn-dev",
  "@codesandbox",
  "lucide-react",
  "effect",
  "date-fns",
  "prettier",
  "eslint",
  "typescript",
  "tailwindcss",
  "tailwind-merge",
  "class-variance-authority",
  "cmdk",
  "sonner",
  "zustand",
  "nanoid",
  "next-themes",
  "sonner",
  "shadcn",
  "recharts",
  "xterm",
  "@xterm",
  "@monaco-editor",
  "@mdxeditor",
  "@hookform",
  "react-hook-form",
  "@tanstack",
  "vaul",
  "sonner",
  "next",
  "react",
  "react-dom",
  "react-day-picker",
  "react-markdown",
  "react-resizable-panels",
  "react-syntax-highlighter",
  "sharp",
  "@img",
  "@swc",
  "styled-jsx",
  "detect-libc",
  "client-only",
  "postcss",
  "autoprefixer",
  "@tailwindcss",
  "electron-updater",
  "electron-builder",
  "esbuild",
  "@esbuild",
  "@rspack",
  "webpack",
  "ts-loader",
  "babel-loader",
  "css-loader",
  "style-loader",
  "postcss-loader",
  "svg-sprite-loader",
  "terser-webpack-plugin",
  "terser",
  "css-minimizer-webpack-plugin",
  "swc-loader",
  "next-pwa",
];
const isRendererOnly = (name) => {
  const root = name.startsWith("@") ? name.split("/")[0] : name.split("/")[0];
  return RENDERER_ONLY_ROOTS.includes(root);
};

// A package is excluded only when it is outside the closure, is renderer-only
// by root, and nothing in the closure depends on it.
const excluded = installed.filter((name) => !closure.has(name) && isRendererOnly(name));
const exclude = excluded.sort();

const keep = [...closure].sort();
const out = {
  generatedFrom: "scripts/compute-packaging-files.mjs",
  roots: [...BACKEND_EXTERNALS, ...EXTRA_ROOTS],
  packages: keep,
  exclude,
  missing,
};
const target = join(root, "assets", "packaging-files.json");
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(
  `[packaging-files] ${keep.length} packages in the main-process closure, ${exclude.length} excluded → assets/packaging-files.json`,
);
if (missing.length) console.log(`[packaging-files] not installed (skipped): ${missing.join(", ")}`);
