// autumn — Wave-2 handlers: diagnostics (2 dispatchable; doc 32 §W2-1).
//
// RE: the renderer calls `window.october.diagnostics.report(note?)` expecting `{code}`.
// The target's remote log-report service does not exist for a local-first clone, and
// faking a remote issue code would be fabrication. Honest analogue: build the
// diagnostics bundle locally, write it to <userData>/logs/diagnostics-<ts>.json, and
// return a deterministic LOCAL code (`autumn-<hash>`) of that payload. `save` is the
// plain-disk sibling (explicit payload or default bundle), returning path + bytes.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { saveJson, userDataDir } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/** Write target for the bundle: <userData>/logs/diagnostics-<ts>.json (created lazily). */
function diagnosticsPath(): string {
  const dir = join(userDataDir(), "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `diagnostics-${Date.now()}.json`);
}

/** Read app version from the repo's package.json (best effort). */
function appVersion(): string {
  try {
    return require("../../package.json")?.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Build the diagnostics bundle — everything useful, nothing fabricated. */
export function buildDiagnosticsReport(note?: string): Record<string, unknown> {
  const mem = process.memoryUsage();
  let gitSha: string | null = null;
  let gitBranch: string | null = null;
  try {
    const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 3000 });
    if (sha.status === 0) gitSha = sha.stdout.trim();
    const br = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 3000 });
    if (br.status === 0) gitBranch = br.stdout.trim();
  } catch {
    /* git absent — report nulls, never invented values */
  }
  const os = require("node:os");
  return {
    app: { name: "autumn", version: appVersion() },
    host: {
      platform: process.platform,
      arch: process.arch,
      release: typeof os.release === "function" ? os.release() : "unknown",
      cpus: os.cpus().length,
      loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      uptimeSeconds: Math.round(os.uptime()),
    },
    process: {
      pid: process.pid,
      versions: {
        node: process.versions.node,
        electron: (process.versions as Record<string, string>).electron ?? "n/a",
        chrome: (process.versions as Record<string, string>).chrome ?? "n/a",
      },
      memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external },
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    git: { sha: gitSha, branch: gitBranch },
    ...(typeof note === "string" && note.length > 0 ? { note: note.slice(0, 500) } : {}),
    capturedAt: new Date().toISOString(),
  };
}

/** Deterministic local code: hash the STABLE identity of the report (app build,
 *  git sha, note) — volatile host metrics and timestamps must not feed the hash. */
export function localCode(report: Record<string, any>): string {
  const stable = { app: report.app, git: report.git, note: report.note ?? null };
  return `autumn-${createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 12)}`;
}

export function makeDiagnosticsHandlers(deps: W1Deps): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "diagnostics.report",
      description:
        "build + save a diagnostics bundle (RE shape, local code); params: { note?: string } -> { code }",
      schema: (p) =>
        p?.note === undefined || typeof p.note === "string"
          ? { ok: true }
          : { ok: false, message: "note must be a string when given" },
      handler: (p = {}) => {
        if (p?.note !== undefined && typeof p.note !== "string") return badParams("note must be a string when given");
        const report = buildDiagnosticsReport(p.note);
        saveJson(diagnosticsPath(), report);
        return { code: localCode(report) };
      },
    },
    {
      kind: "bridge",
      id: "diagnostics.save",
      description:
        "persist a diagnostics payload to disk; params: { payload?: object } -> { saved: true, path, bytes }",
      schema: (p) =>
        p?.payload === undefined || (typeof p.payload === "object" && p.payload !== null && !Array.isArray(p.payload))
          ? { ok: true }
          : { ok: false, message: "payload must be an object when given" },
      handler: (p = {}) => {
        if (
          p?.payload !== undefined &&
          (typeof p.payload !== "object" || p.payload === null || Array.isArray(p.payload))
        ) {
          return badParams("payload must be an object when given");
        }
        const payload = p?.payload ?? buildDiagnosticsReport();
        const file = diagnosticsPath();
        const serialized = JSON.stringify(payload, null, 2);
        saveJson(file, payload);
        return { saved: true, path: file, bytes: Buffer.byteLength(serialized, "utf8") };
      },
    },
  ];

  return handlers;
}
