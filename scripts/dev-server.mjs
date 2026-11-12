// autumn — dev server runner (cross-platform).
//
// The old script was `next dev -p 3000 2>&1 | tee dev.log` — `tee` does not
// exist on Windows, so the dev command was Unix-only. This runner does the
// same thing everywhere: it starts Next, mirrors the output to dev.log, and
// forwards Ctrl-C.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logFile = join(root, "dev.log");
mkdirSync(dirname(logFile), { recursive: true });
const log = createWriteStream(logFile, { flags: "a" });

const port = process.env.AUTUMN_PORT || "3000";
const child = spawn("npx", ["next", "dev", "-p", port], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

const mirror = (stream, prefix) => {
  stream.on("data", (chunk) => {
    const text = String(chunk);
    log.write(text);
    process[prefix].write(text);
  });
};
mirror(child.stdout, "stdout");
mirror(child.stderr, "stderr");

child.on("exit", (code) => {
  log.end();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
