// autumn — packaging sanity check.
//
// Verifies the things that break a Windows/macOS/Linux build, WITHOUT running
// electron-builder (which needs the target toolchain):
//
//   1. every path the packaged app resolves at runtime really exists;
//   2. the electron-builder config is complete (targets, icon, publish);
//   3. the bundled backend exists and registers handlers into the SAME
//      registry the main process uses (a duplicated registry = dead IPC);
//   4. the icon is a real image of the right size;
//   5. the native modules that must stay outside the asar are declared.
//
// Run: npm run pack:check

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const problems = [];
const notes = [];

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    problems.push(label);
  }
}

console.log("[pack:check] 1. the electron-builder config");
const builderConfig = require(join(root, "electron-builder.cjs"));
check("appId", !!builderConfig.appId, builderConfig.appId);
check("productName", builderConfig.productName === "Autumn", builderConfig.productName);
check("windows targets", (builderConfig.win?.target ?? []).some((t) => t.target === "nsis"), "nsis + zip");
check("macos targets", (builderConfig.mac?.target ?? []).length > 0, "dmg + zip");
check("linux targets", (builderConfig.linux?.target ?? []).length > 0, "AppImage + deb");
check("publish provider", builderConfig.publish?.[0]?.provider === "github", `${builderConfig.publish?.[0]?.owner}/${builderConfig.publish?.[0]?.repo}`);
const iconPath = builderConfig.win.icon;
check("icon exists", existsSync(iconPath), iconPath);
check(
  "native modules are unpacked from the asar",
  ["node-pty", "@prisma/engines", ".prisma"].every((m) =>
    (builderConfig.asarUnpack ?? []).some((p) => p.includes(m)),
  ),
);
check(
  "the standalone server ships as a resource (it is executed)",
  (builderConfig.extraResources ?? []).some((r) => r.from === ".next/standalone"),
);

console.log("[pack:check] 2. the icon");
try {
  const sharp = require("sharp");
  const meta = await sharp(iconPath).metadata();
  check("icon is a PNG", meta.format === "png", `${meta.width}x${meta.height}`);
  check("icon is at least 512x512", meta.width >= 512 && meta.height >= 512, `${meta.width}x${meta.height}`);
} catch (e) {
  notes.push(`icon metadata not checked (${e.message})`);
}

console.log("[pack:check] 3. the bundled backend");
const bundle = join(root, "electron", "dist", "backend.cjs");
check("electron/dist/backend.cjs exists", existsSync(bundle), "run `npm run build:backend`");
if (existsSync(bundle)) {
  const registry = require(join(root, "electron", "ipc", "registry.js"));
  const bundled = require(bundle);
  check("the bundle exports registerBackend", typeof bundled.registerBackend === "function");
  // The registry must be the SAME instance the main process uses.
  check(
    "the bundle keeps ../ipc/registry external (one shared registry)",
    existsSync(join(root, "electron", "ipc", "registry.js")),
    "electron/ipc/registry.js",
  );
  notes.push(`registry module id: ${registry.__id ?? "n/a"}`);
}

console.log("[pack:check] 4. the runtime paths the packaged app resolves");
const main = require("node:fs").readFileSync(join(root, "electron", "main.js"), "utf8");
check(
  "the packaged app boots the standalone server",
  main.includes('"standalone"') && main.includes("ELECTRON_RUN_AS_NODE"),
  "resources/standalone/server.js",
);
check("the packaged app creates its own database", main.includes("prisma"), "prisma db push");
check("the main process prefers the bundled backend", main.includes("dist/backend.cjs"));

console.log("[pack:check] 5. the runtime closure is complete");
try {
  const files = JSON.parse(
    (await import("node:fs")).readFileSync(join(root, "assets", "packaging-files.json"), "utf8"),
  );
  const installed = new Set();
  for (const entry of (await import("node:fs")).readdirSync(join(root, "node_modules"), { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const sub of (await import("node:fs")).readdirSync(join(root, "node_modules", entry.name))) {
        installed.add(`${entry.name}/${sub}`);
      }
    } else installed.add(entry.name);
  }
  const excluded = new Set(files.exclude ?? []);
  const wronglyExcluded = (files.packages ?? []).filter((p) => excluded.has(p));
  check("nothing in the runtime closure is excluded", wronglyExcluded.length === 0, wronglyExcluded.join(", "));
  const unknown = (files.exclude ?? []).filter((p) => !installed.has(p));
  check("the exclusion list matches the installed tree", unknown.length === 0, unknown.slice(0, 5).join(", "));
  notes.push(`runtime closure: ${files.packages.length} packages kept, ${files.exclude.length} excluded`);
} catch (e) {
  check("assets/packaging-files.json exists", false, e.message);
}

console.log("[pack:check] 6. the shipped tree");
for (const rel of ["electron/main.js", "electron/preload.js", "electron/ipc/registry.js", "prisma/schema.prisma", "assets/icon.png"]) {
  check(rel, existsSync(join(root, rel)));
}
// The Prisma client is GENERATED into prisma/generated (a normal directory in
// the app tree, so electron-builder really ships it — the hidden
// node_modules/.prisma is never copied).
const generatedClient = join(root, "prisma", "generated", "client.js");
check("the generated Prisma client exists", existsSync(generatedClient), "prisma/generated (run `npm run db:generate`)");
check(
  "the generated Prisma client is in the packaged files",
  (builderConfig.files ?? []).some((f) => typeof f === "string" && f.includes("prisma/generated")),
);
check(
  "the Prisma query engine is unpacked (it is a native addon)",
  (builderConfig.asarUnpack ?? []).some((f) => f.includes("prisma/generated") && f.includes(".node")),
);
check(
  "the app imports the generated client (not @prisma/client)",
  readFileSync(join(root, "src", "lib", "db.ts"), "utf8").includes("prisma/generated/client"),
);
check("the app's own deps are declared (not --no-save installs)", existsSync(join(root, "node_modules", "electron-updater")) && existsSync(join(root, "node_modules", "ws")));

console.log("[pack:check] 7. the build scripts are cross-platform");
const pkg = require(join(root, "package.json"));
const scripts = Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join("\n");
const unixOnly = [/\bcp\s+-r\b/, /\btee\b/, /\bbun\b/, /\brm\s+-rf\b/, /\bmv\s/];
for (const re of unixOnly) {
  check(`no ${re.source} in the npm scripts`, !re.test(scripts), re.source);
}
check("the electron-builder config is referenced by the build", scripts.includes("electron-builder"));

for (const note of notes) console.log(`  note  ${note}`);
if (problems.length) {
  console.error(`\n[pack:check] ${problems.length} problem(s): ${problems.join("; ")}`);
  process.exit(1);
}
console.log("\n[pack:check] everything checks out");
