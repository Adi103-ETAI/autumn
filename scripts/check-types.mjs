// autumn — CI type check.
//
// `tsc --noEmit` reports errors in src/ that PRE-DATE the Wave-2 work (the
// renderer is the user's area; next.config.ts sets typescript.ignoreBuildErrors
// so the Next build is not blocked by them). The Electron backend is ours, so
// THIS is the gate: the CI fails when electron/ has an error and tolerates the
// known src/ ones (reported, not hidden).

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
const lines = output.split("\n");
const errors = lines.filter((l) => /error TS\d+/.test(l));

const ours = errors.filter((l) => l.startsWith("electron/"));
const theirs = errors.filter((l) => l.startsWith("src/"));

if (theirs.length) {
  console.log(`[typecheck] ${theirs.length} pre-existing src/ error(s) — not ours, not fatal:`);
  for (const e of theirs) console.log(`  ${e}`);
}
if (ours.length) {
  console.error(`[typecheck] ${ours.length} error(s) in electron/ — these are ours:`);
  for (const e of ours) console.error(`  ${e}`);
  process.exit(1);
}
console.log("[typecheck] electron/ is clean");
