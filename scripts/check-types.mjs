// autumn — CI type check.
//
// The whole project type-checks: the Electron backend AND the renderer.
// `tsc --noEmit` reports every error, and none of them are tolerated — a
// type error is a bug that the compiler found for free.
//
// (The Next build itself ignores type errors — next.config.ts sets
// typescript.ignoreBuildErrors — so this script is the gate.)

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const res = spawnSync("npx", ["tsc", "--noEmit", "--incremental", "false"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});

const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
const errors = output.split("\n").filter((l) => /error TS\d+/.test(l));

if (errors.length) {
  console.error(`[typecheck] ${errors.length} type error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log("[typecheck] the whole project is clean (electron/ and src/)");
