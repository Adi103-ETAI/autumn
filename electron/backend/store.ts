// autumn — flat-JSON persistence helper (Wave 2 platform layer, doc 32).
//
// Shared by Wave-2 handler modules: settings, auth, cues, skills, phone,
// agentAccounts, backends registry, ... Everything lives under ONE data
// directory so the app keeps zero hidden state:
//   $AUTUMN_USER_DATA_DIR  (if set)
//   else  <os.homedir()>/.autumn
//   db files → <dir>/db/<name>.json
// Env override makes headless tests trivial and avoids touching real user data.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Root of autumn's on-disk state (created on first write). */
export function userDataDir(): string {
  return process.env.AUTUMN_USER_DATA_DIR || join(require("node:os").homedir(), ".autumn");
}

/** Directory for JSON databases; created recursively. */
export function dbDir(): string {
  const d = join(userDataDir(), "db");
  mkdirSync(d, { recursive: true });
  return d;
}

/** Load a JSON file, or `fallback` when missing/corrupt (never throws). */
export function loadJson<T>(file: string, fallback: T): T {
  try {
    const raw = readFileSync(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Atomically write JSON (tmp file + rename) so a crash can never leave a
 * half-written file for the next app start to trip over.
 */
export function saveJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

export function dbPath(name: string): string {
  if (!/^[a-z0-9._-]+$/.test(name)) throw new Error(`invalid db name: ${name}`);
  return join(dbDir(), name);
}

/** Test helper: point AUTUMN_USER_DATA_DIR at a fresh temp dir. */
export function useTempUserData(t?: { after?: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "autumn-userdata-"));
  const prev = process.env.AUTUMN_USER_DATA_DIR;
  process.env.AUTUMN_USER_DATA_DIR = dir;
  if (t?.after) {
    t.after(() => {
      if (prev === undefined) delete process.env.AUTUMN_USER_DATA_DIR;
      else process.env.AUTUMN_USER_DATA_DIR = prev;
    });
  }
  return dir;
}

export function exists(p: string): boolean {
  return existsSync(p);
}
