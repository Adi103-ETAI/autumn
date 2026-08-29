// Autumn — tiny `which` helper (resolve a command on PATH).
// Returns the absolute path if found, throws otherwise. Used by the spawner to
// probe whether a real agent CLI is installed before spawning it.

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, delimiter } from "node:path";
import { homedir } from "node:os";

export async function which(cmd: string): Promise<string> {
  // Already an absolute / relative path with a separator → check directly.
  if (cmd.includes("/") || cmd.includes("\\")) {
    const p = resolve(cmd);
    await access(p, constants.X_OK);
    return p;
  }

  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  // Also peek in common global install locations.
  paths.push(
    `${homedir()}/.npm-global/bin`,
    "/usr/local/bin",
    "/opt/homebrew/bin",
  );

  for (const dir of paths) {
    try {
      const p = resolve(dir, cmd);
      await access(p, constants.X_OK);
      return p;
    } catch {
      // not here, try next
    }
  }
  throw new Error(`command not found: ${cmd}`);
}
